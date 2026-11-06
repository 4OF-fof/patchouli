# TODO

## 同期サーバーと Web UI

- 実装予定。同期サーバーをデータソースにして Web UI からつなぐ。プラグインも同期サーバーで動かす

## デスクトップ

- タスクトレイに常駐し、ウィンドウを閉じても動き続けられるようにする
  - CLI
  - skill
  - 外部アプリと連携するためのローカルサーバー

## 本体の構成

- 本体を 3 つの層に分ける
  - コア：ライブラリの保存と追跡、整理のしくみ、プラグインの基盤、画面の枠
  - 本体の中の部品：AI、内蔵ブラウザ、ノートの書式、概要カード。アプリの中の窓口でコアにつなぐ
  - プラグイン：形式ごとの読み取りと表示、メニュー、画面
- 進める順
  1. plugin.json の形を変える（下の「plugin.json の形」）
  2. 画像・動画・音声の基盤を本体に入れ、組み込みのプラグインはそれを使うだけにする
     - 音声の波形は本体が作る。作る時間の上限は本体の設定にする
     - decoded の PNG は、本体のキャッシュにいつも取っておく
  3. AI・ノートの書式・概要カードを、本体の中の部品として切り分ける。ノートの書式の窓口は、うまくいったらプラグインにも開く

### plugin.json の形

- `elevated` は `script` と呼び、スクリプトのパスを書く
- `formats` は配列にし、同じ扱いの拡張子を `ext` に並べる。`extends` はなくす
- 形式に書くもの
  - `ext`・`label`・`ratio`・`fit`
  - `media`：本体がそのまま出す種類（image・video・audio）。カーソルを合わせたときと埋め込みの本体の出し方もこれで決め、`hover`・`embed` のキーはなくす
  - `parts`：受け持つもの（thumbnail・view・details・excerpt・hover・embed）。`content` は `excerpt` と呼ぶ。`waveform`・`link` はなくす
  - `script`：`parts` のうちスクリプトで受け持つもの。ほかは WASM が受け持つ。`sandbox` のキーはなくす
- `keepDecoded` はなくす
- ショートカット（.url）は本体が読み、指す URL を `links` に渡す。組み込みの shortcut プラグインはなくす
- `links` は配列にし、同じ扱いのホストを `host` に並べる。`parts` は `formats` とそろえる（thumbnail・view・details・excerpt・hover・embed）。担当はスクリプトだけ
- `screens` の `window` はなくし、画面はすべてタブで開く。メニューの結果の `screen.window` もなくす
- `menu`・`hooks` は WASM だけが受け持つ。`by` はなくす。例の graph は、メニューを WASM で返すように直す
- `hooks` に、取り込んだとき（`added`）のほか、中身が変わったとき（`changed`）と、名前・タグ・置き場を変えたとき（`edited`）を足す
- WIT の `host` に `fetch` を足す。スクリプトの `api.fetch` と同じ本体の処理を使い、`fetch` に書いたホストへ GET だけできる
- スクリプトから同じ part の WASM を呼ぶ `api.sandbox()` は `api.wasm()` と呼ぶ

## ノート

- 書式の一覧を `/` で出すと、日本語入力のときに使いづらい。出し方をあとで考え直す（今は `/` のまま）
- ノートの描画をプラグインで拡張できるようにする

## プラグイン

### まだ作っていないもの

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
