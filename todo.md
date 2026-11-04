# TODO

## 同期サーバーと Web UI

- 実装予定。同期サーバーをデータソースにして Web UI からつなぐ。プラグインも同期サーバーで動かす

## ノート

- 書式の一覧を `/` で出すと、日本語入力のときに使いづらい。出し方をあとで考え直す（今は `/` のまま）

## プラグイン

### まだ作っていないもの

- GitHub のリリースから入れる流れを、実際のリポジトリ（`patchouli-plugin-template`）で確かめる
- 組み込み UI のサムネイル作りに失敗したときの作り直し（今は失敗や時間切れのあと、次に開くまで作らない）
- ショートカットの macOS（.webloc）と Linux（.desktop の Type=Link）。今は Windows の .url だけ
- 内蔵ブラウザの戻る・進むの macOS（WKWebView）と Linux（WebKitGTK）。今は Windows の WebView2 だけが履歴を読み、ほかはいつも押せてページの中で history.back() を呼ぶ。ページを読み込み直さない移動では URL の表示も追いつかない
- 内蔵ブラウザのページの前に、情報やツールチップなどを出す仕組みの macOS と Linux。今は Windows だけが本体の画面に穴を開けてページを下に置き、ほかはページが本体の画面の上に出て重ねる表示を隠す

### 例のプラグインとドキュメント

- `example/` と `docs/plugins/` を直す。もっとよいサンプルができたら example を入れ替え、docs の例と表も合わせる
- 例がまだ使っていないもの：`content`、elevated の `thumbnail`・`details`・`hover`・`embed`・`waveform`・`link`、`extends`、`api.sandbox()`、設定、コマンド、ほかのプラグインへの依存、`clipboard`・`edit`・`assets`・`export`、メニューの結果の `overlay`・`save`

### 公式プラグイン

- importer：Eagle / Obsidian（完全互換は求めず、取り込めればよい）
- リアルタイムの同時編集。Web UI のあとに考える

## 設定

- 設定に入れるものと、設定を開いたときの見た目を整理する
- カラースキーマをカスタムできるようにする

## 多言語対応

- 画面の文言を多言語に対応させる
