//! 取り込みのフック。取り込んだものを 1 つずつ裏で、形式に合うプラグインのフックへ、プラグインの一覧の順に渡す。

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};

use serde::Serialize;
use tauri::{Emitter, Manager};

use crate::library::StoredItem;
use crate::plugin::ipc::menu::apply_ran;
use crate::plugin::ipc::{Target, env_of, info_of};
use crate::plugin::{Registry, Runner, TargetFile};
use crate::session::{Current, with_session};

struct Job {
    session: u64,
    id: String,
}

static QUEUE: Mutex<VecDeque<Job>> = Mutex::new(VecDeque::new());
/// いまフックに渡しているものの ID。
static RUNNING: Mutex<Option<String>> = Mutex::new(None);
static WORKING: AtomicBool = AtomicBool::new(false);
static STOP: LazyLock<Arc<AtomicBool>> = LazyLock::new(|| Arc::new(AtomicBool::new(false)));

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HookFailed<'a> {
    plugin: &'a str,
    item: &'a str,
    message: &'a str,
}

/// 取り込んだもののうち、フックのあるものを待ち行列に入れる。
pub fn queue(app: &tauri::AppHandle, items: &[StoredItem]) {
    let Ok((session, reg)) = with_session(&app.state::<Current>(), |s| {
        Ok((s.id, Arc::clone(&s.plugins)))
    }) else {
        return;
    };
    if !reg.has_hooks() {
        return;
    }
    let jobs: Vec<Job> = items
        .iter()
        .filter(|it| !reg.hooks_for(&it.ext, it.note).is_empty())
        .map(|it| Job {
            session,
            id: it.id.clone(),
        })
        .collect();
    if jobs.is_empty() {
        return;
    }
    STOP.store(false, Ordering::Relaxed);
    if let Ok(mut q) = QUEUE.lock() {
        q.extend(jobs);
    }
    if !WORKING.swap(true, Ordering::AcqRel) {
        let app = app.clone();
        std::thread::spawn(move || work(&app));
    }
}

/// 待っているものと、いま渡しているものの ID。
pub fn pending() -> Vec<String> {
    let mut out: Vec<String> = RUNNING
        .lock()
        .ok()
        .and_then(|r| r.clone())
        .into_iter()
        .collect();
    if let Ok(q) = QUEUE.lock() {
        out.extend(q.iter().map(|j| j.id.clone()));
    }
    out
}

/// 待っているものを捨て、動いているフックを止める。
pub fn stop() {
    if let Ok(mut q) = QUEUE.lock() {
        q.clear();
    }
    STOP.store(true, Ordering::Relaxed);
}

fn work(app: &tauri::AppHandle) {
    let mut runner: Option<Runner> = None;
    loop {
        let job = QUEUE.lock().ok().and_then(|mut q| q.pop_front());
        let Some(job) = job else {
            WORKING.store(false, Ordering::Release);
            // 止めたあとに入ったものは、ここで拾う
            let more = QUEUE.lock().is_ok_and(|q| !q.is_empty());
            if more && !WORKING.swap(true, Ordering::AcqRel) {
                continue;
            }
            return;
        };
        if let Ok(mut r) = RUNNING.lock() {
            *r = Some(job.id.clone());
        }
        run(app, &mut runner, &job);
        if let Ok(mut r) = RUNNING.lock() {
            *r = None;
        }
    }
}

fn run(app: &tauri::AppHandle, runner: &mut Option<Runner>, job: &Job) {
    let cur = app.state::<Current>();
    let Ok(Some((reg, thumbs))) = with_session(&cur, |s| {
        Ok((s.id == job.session).then(|| (Arc::clone(&s.plugins), s.thumbs.clone())))
    }) else {
        return;
    };
    // 形式を変えたあとも、取り込んだときの形式のフックだけを続ける
    let Ok(first) = Target::any(&cur, &job.id) else {
        return;
    };
    let hooks = reg.hooks_for(&first.ext, first.note);
    let r = match runner {
        Some(r) if Arc::ptr_eq(r.registry(), &reg) => r,
        _ => {
            let mut r = Runner::new(Arc::clone(&reg));
            r.set_stop(Arc::clone(&STOP));
            runner.insert(r)
        }
    };
    r.set_env(Some(env_of(app, &thumbs)));
    for i in hooks {
        if STOP.load(Ordering::Relaxed) {
            break;
        }
        let Ok(t) = Target::any(&cur, &job.id) else {
            break;
        };
        let info = with_session(&cur, |s| s.lib.stored(&job.id))
            .ok()
            .flatten()
            .map(info_of);
        let name = info.as_ref().map_or_else(String::new, |x| x.name.clone());
        let file = TargetFile {
            ext: &t.ext,
            note: t.note,
            path: &t.path,
            info,
        };
        let failed = match r.added(i, &file) {
            Ok(ran) => match apply_ran(app, &cur, std::slice::from_ref(&job.id), ran) {
                Ok(a) => a.failed,
                Err(e) => vec![e],
            },
            Err(_) if STOP.load(Ordering::Relaxed) => break,
            Err(e) => vec![e],
        };
        for e in failed {
            tell_failed(app, &reg, i, &name, &e);
        }
    }
    r.set_env(None);
}

fn tell_failed(app: &tauri::AppHandle, reg: &Registry, i: usize, item: &str, message: &str) {
    log::warn!(
        "取り込みのフックに失敗した（{}・{item}）: {message}",
        reg.plugin_name(i)
    );
    let _ = app.emit(
        "hook-failed",
        HookFailed {
            plugin: reg.plugin_name(i),
            item,
            message,
        },
    );
}
