# TODO

## 同期サーバーと Web UI

- 実装予定。同期サーバーをデータソースとして Web UI から接続し、プラグインも同期サーバー上で動作させる

## ノート

- 書式メニューを `/` で開く仕様は日本語入力時に使いづらいため、呼び出し方法を検討する（現在は `/` のまま）

## 設定

- 「スタートアップで起動」の macOS（LaunchAgent）と Linux（`~/.config/autostart` の `.desktop`）対応。現在は Windows のレジストリ登録のみ対応

## プラグイン

### 未実装の機能

- ショートカットファイルの macOS（`.webloc`）と Linux（`.desktop` の `Type=Link`）対応。現在は Windows の `.url` のみ対応
- 内蔵ブラウザの戻る・進むボタンの macOS（WKWebView）と Linux（WebKitGTK）対応。現在は Windows の WebView2 のみ履歴状態を取得しており、他の OS では常時有効でページ内の `history.back()` を呼ぶ実装のため、SPA 遷移などで URL 表示が追従しない
- 内蔵ブラウザの前面に情報パネルやツールチップなどを重ねて表示する仕組みの macOS・Linux 対応。現在は Windows のみメインウィンドウにリージョンで穴を開けて子 WebView を背面に配置しており、他の OS では子 WebView が前面に出てオーバーレイ表示を隠してしまう

### サンプルプラグインとドキュメント

- より実践的なサンプルができた場合は `example/` を差し替え、`docs/plugins/` の例と表も更新する
- サンプルで未使用の機能：`excerpt`、`media`、スクリプトの `thumbnail`・`details`・`hover`・`embed`、`links` の `excerpt`・`hover`、`api.wasm()`、設定、外部コマンド、他プラグインへの依存、`clipboard`・`edit`・`assets`・`export`、`host::fetch`、メニュー結果の `overlay`、フックの `edited`

### 公式プラグイン

- インポーター：Eagle / Obsidian（完全互換は求めず、データの取り込みができればよい）
- リアルタイムの同時編集（Web UI 実装後に検討）
