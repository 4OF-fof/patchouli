use std::path::PathBuf;
use std::process::Command;
use std::{env, fs};

/// 組み込みのプラグイン（ディレクトリ名）。処理部分のないものは WASM を作らない。
const WASM_PLUGINS: [&str; 3] = ["image", "video", "audio"];

/// 組み込み UI（plugin.json の ui）のあるプラグイン。
const UI_PLUGINS: [&str; 1] = ["audio"];

/// 組み込み UI を plugins/sdk/cli.ts でビルドし、できたファイルを src/plugin/builtin.rs が埋め込めるように並べる。
fn build_ui() {
    let here = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let plugins = here.join("../plugins");
    let cli = plugins.join("sdk/cli.ts");
    println!("cargo:rerun-if-changed={}", plugins.join("sdk").display());
    let out = PathBuf::from(env::var("OUT_DIR").unwrap()).join("ui");
    let mut items = String::new();
    for p in UI_PLUGINS {
        let dir = plugins.join(p);
        println!("cargo:rerun-if-changed={}", dir.join("ui").display());
        println!(
            "cargo:rerun-if-changed={}",
            dir.join("plugin.json").display()
        );
        let dest = out.join(p);
        let status = Command::new("node")
            .arg(&cli)
            .args(["build", "--no-wasm", "--out"])
            .arg(&dest)
            .arg(&dir)
            .status()
            .expect("組み込み UI のビルドを始められない（Node が要る）");
        assert!(
            status.success(),
            "組み込み UI をビルドできない（app で pnpm install が要る）"
        );
        let mut stack = vec![dest.clone()];
        while let Some(d) = stack.pop() {
            for e in fs::read_dir(&d).unwrap().flatten() {
                let path = e.path();
                if path.is_dir() {
                    stack.push(path);
                    continue;
                }
                let rel = path
                    .strip_prefix(&dest)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                if rel == "plugin.json" {
                    continue;
                }
                items.push_str(&format!(
                    "    ({p:?}, {rel:?}, include_bytes!({:?})),\n",
                    path.to_string_lossy()
                ));
            }
        }
    }
    fs::write(
        PathBuf::from(env::var("OUT_DIR").unwrap()).join("ui_files.rs"),
        format!("&[\n{items}]\n"),
    )
    .unwrap();
}

/// 組み込みのプラグインの処理部分を WASM にして OUT_DIR に置く。src/plugin/builtin.rs が埋め込む。
fn build_plugins() {
    let here = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let plugins = here.join("../plugins");
    for p in ["sdk/wit", "shared", "Cargo.toml", "Cargo.lock"] {
        println!("cargo:rerun-if-changed={}", plugins.join(p).display());
    }
    for p in WASM_PLUGINS {
        println!(
            "cargo:rerun-if-changed={}",
            plugins.join(p).join("src").display()
        );
        println!(
            "cargo:rerun-if-changed={}",
            plugins.join(p).join("Cargo.toml").display()
        );
    }
    // 外側の cargo とロックがぶつからないよう、置き場所を分ける
    let target = here.join("target/plugins");
    let status = Command::new(env::var("CARGO").unwrap_or_else(|_| "cargo".into()))
        .args([
            "build",
            "--release",
            "--target",
            "wasm32-wasip2",
            "--manifest-path",
        ])
        .arg(plugins.join("Cargo.toml"))
        .arg("--target-dir")
        .arg(&target)
        // 外側のビルドの指定（ホスト向けのフラグなど）を持ち込まない
        .env_remove("CARGO_ENCODED_RUSTFLAGS")
        .env_remove("RUSTFLAGS")
        .env_remove("CARGO_BUILD_TARGET")
        .env_remove("CARGO_TARGET_DIR")
        // clippy で調べているときも、プラグインは普通にビルドする
        .env_remove("RUSTC_WORKSPACE_WRAPPER")
        .env_remove("CLIPPY_ARGS")
        .status()
        .expect("プラグインのビルドを始められない");
    assert!(
        status.success(),
        "プラグインをビルドできない（rustup target add wasm32-wasip2 が要る）"
    );
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    for p in WASM_PLUGINS {
        let wasm = target.join(format!("wasm32-wasip2/release/patchouli_plugin_{p}.wasm"));
        fs::copy(&wasm, out.join(format!("{p}.wasm")))
            .unwrap_or_else(|e| panic!("{}: {e}", wasm.display()));
    }
}

fn main() {
    build_plugins();
    build_ui();
    tauri_build::build()
}
