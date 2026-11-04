//! ライブラリのキャッシュを読み書きする裏の仕事。キャッシュを消す前に止めて、終わるのを待てるよう数える。

use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

static RUNNING: AtomicUsize = AtomicUsize::new(0);

struct Running;

impl Drop for Running {
    fn drop(&mut self) {
        RUNNING.fetch_sub(1, Ordering::AcqRel);
    }
}

pub fn spawn(f: impl FnOnce() + Send + 'static) {
    RUNNING.fetch_add(1, Ordering::AcqRel);
    let running = Running;
    std::thread::spawn(move || {
        let _running = running;
        f();
    });
}

/// すべて終わったら true。limit を過ぎたら false。
pub fn wait(limit: Duration) -> bool {
    let until = Instant::now() + limit;
    while RUNNING.load(Ordering::Acquire) > 0 {
        if Instant::now() >= until {
            return false;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    true
}
