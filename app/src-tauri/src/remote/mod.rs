//! CLI・ブラウザの拡張機能・ほかのアプリから、動いているアプリを操作する口。

pub(crate) mod clients;
pub(crate) mod ipc;
pub(crate) mod ops;
// CLI だけが使う項目もある
#[allow(dead_code)]
pub mod proto;
pub(crate) mod server;
pub(crate) mod setup;
