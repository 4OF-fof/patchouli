# WASM

WASM は WIT（SDK の `wit/plugin.wit`）のコンポーネントであり、`wasm32-wasip2` ターゲットでビルドする。ファイルはアプリから渡されたもののみ読み取り可能で、ネットワーク通信は `host::fetch` により `plugin.json` の `fetch` に指定したホストへのみ行える。`commands` で実行する外部コマンドは WASM サンドボックスの外で、アプリ本体と同じ権限で動作する。

## world の定義方法

対応するロールの world を `include` でまとめた world を定義し、ロールごとに `Guest` トレイトを実装する。アプリは読み込み時に WASM の export を調べて対応機能を判定する。

```rust
wit_bindgen::generate!({
    inline: "
        package local:zip;

        world zip {
            include patchouli:plugin/thumbnail-role@0.13.0;
            include patchouli:plugin/call-role@0.13.0;
        }
    ",
    path: "patchouli/wit",
    world: "local:zip/zip",
    generate_all,
});

use exports::patchouli::plugin as role;

struct Zip;

impl role::thumbnail::Guest for Zip { /* ... */ }
impl role::call::Guest for Zip { /* ... */ }

export!(Zip);
```

- `@0.13.0` は `wit/plugin.wit` のバージョンと合わせる。アプリは同じマイナーバージョン（`1.0` 以降は同じメジャーバージョン）で、アプリのバージョン以下のプラグインを読み込む
- `Cargo.toml` の `crate-type` には `cdylib` を指定する。必須の依存クレートは `wit-bindgen` のみ

## ロール一覧

`thumbnail`・`view`・`details`・`excerpt` は `formats` の `parts` に指定され、`script` に含まれないものを処理する。`render` は `notes` の `code` に指定され、`script` に含まれないものを処理する。`plugin.json` で指定されているにもかかわらず WASM が対応関数を export していない場合は、プラグイン一覧にエラーとして表示される。

| world            | 実装する関数                                              | 呼び出しタイミング                                          | タイムアウト |
| ---------------- | --------------------------------------------------------- | ----------------------------------------------------------- | ------------ |
| `thumbnail-role` | `thumbnail(format, f, edge)`                              | サムネイル生成時                                            | 10 秒        |
| `view-role`      | `decode(format, f)`                                       | 詳細表示を開いたとき                                        | 30 秒        |
| `details-role`   | `details(format, f)`                                      | ファイルの詳細欄を開いたとき                                | 30 秒        |
| `excerpt-role`   | `excerpt(format, f, budget)`                              | AI 機能でファイル内容を解析するとき                         | 120 秒       |
| `menu-role`      | `menu(read, targets)`・`run-menu(read, run, targets, id)` | `menu` の対象形式の右クリックメニューを開いたとき・選択時   | 30 秒        |
| `hook-role`      | `hook(read, run, event, target)`                          | `hooks` に指定したイベントが発生したとき                    | 60 秒        |
| `code-role`      | `render(lang, source)`                                    | ノートのコードブロック描画時・スクリプトの `api.wasm()`     | 10 秒        |
| `settings-role`  | `settings()`                                              | ライブラリを開いたとき                                      | 2 秒         |
| `call-role`      | `call(format, f, method, args)`                           | スクリプトの `api.call` 呼び出し時                          | 30 秒        |

制限時間を超えると実行は強制終了される。`commands::run`・`embed`・`host::fetch` の待機時間は制限時間に含まれない。

### thumbnail

`thumbnail-image { png, size }` を返す。`png` は長辺が `edge` 以下の PNG データ、`size` は元素材のピクセルサイズ（不明なら `none`）。サムネイルを生成しない場合は `none` を返す。

### decode

詳細表示用の PNG データを元素材のサイズで返す。生成された PNG はアプリ側でキャッシュされる。

### details

`detail { label, value }` の配列を返す。ファイルの詳細欄の「種類」の後に表示される。

### excerpt

`excerpt-budget` の上限内で `excerpt-part` の配列を返す。区間の分割方法はプラグイン側で決定する。空配列を返した場合はアプリ本体がサムネイル画像を使用する。

| `excerpt-media` | 内容                                                       |
| --------------- | ---------------------------------------------------------- |
| `images`        | PNG または JPEG。複数ある場合はまとめて 1 つの区間として扱う |
| `audio`         | WAV                                                        |
| `text`          | テキスト                                                   |

`start` と `end` は区間の開始・終了秒数であり、ファイル全体を表す場合は `none` とする。

### menu と run-menu

`menu` はメニュー項目（`menu-item { id, label }`）の配列を返す。`targets` には選択中の全項目が渡されるため、件数に応じて単一選択時のみの項目などを出し分けられる。項目が選択されると、同じ `targets` と選択された項目の `id` が `run-menu` に渡される。

| `menu-output`              | 表示方法                                                             |
| -------------------------- | -------------------------------------------------------------------- |
| `none`                     | 何も表示しない                                                       |
| `toast({ text, level })`   | トースト通知を表示する。`level`（`toast-level`）に応じて色と表示時間が変わる |
| `overlay({ title, rows })` | ラベルと値の一覧をダイアログで表示する。各行の値をコピーできる       |
| `screen(id)`               | `screens` の画面をタブで開き、`targets` を渡す                       |

`toast-level` は `info`・`success`・`warning`・`error` の 4 種類。`info` と `success` は 4 秒後に自動で閉じ、`warning` と `error` は閉じるボタンを押すまで表示される。

### hook

`event`（`hook-event`）は `plugin.json` の `hooks` のキーに対応し、`added`・`changed`・`edited` のいずれかが渡される。`target` は 1 件ずつバックグラウンドで渡される。

- `Err` を返した場合はエラー通知が表示される
- 同じ形式に対応するフックが複数ある場合は、前のフックによる変更後の内容が次のフックに渡される
- フック内で行われた変更に対してはフックは再実行されない

### render

`lang` はコードブロックの言語名（小文字）、`source` は囲みの ```` ``` ```` の行を除いた中身であり、内容が変わるたびに呼ばれる。`code-image` を返し、本文の幅を超える場合は縮小表示される。`Err` を返した場合はコードブロックの下にエラーメッセージが表示される。

| `code-image` | 内容                                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `svg`        | SVG 文字列。`script`・アニメーション・イベント属性・外部参照はサニタイズされ、Shadow DOM 内に描画される。アプリ本体の CSS 変数（`--ink` など）を使用可能 |
| `png`        | PNG バイト列                                                                                                                       |

### settings

`setting { key, label, help, kind, default }` の配列を返す。設定 UI はアプリ本体が描画し、設定値はライブラリごとに保存される。現在値は WASM の `host::setting` またはスクリプトの `api.settings()` で取得する。

| `setting-kind`               | UI コントロール                                      |
| ---------------------------- | ---------------------------------------------------- |
| `toggle`                     | トグルスイッチ                                       |
| `number({ min, max, step })` | 数値入力                                             |
| `text`                       | テキスト入力                                         |
| `choice(choices)`            | ドロップダウン選択。選択された `value` を文字列で保持 |

### call

`method` と `args` の仕様はプラグインごとに定義する。スクリプトの `api.call(method, args)` は `args` を JSON 文字列に変換して渡し、戻り値の文字列を JSON としてパースする。

## ホスト関数

`file` ハンドルはその呼び出し内でのみ有効。`read` と `run` は `menu`・`run-menu`・`hook` に渡されるトークン（WIT resource）であり、権限が必要なホスト関数の第 1 引数に渡す。

| interface   | 関数                                                                                 | 必要な設定（`permissions` など）     | トークン |
| ----------- | ------------------------------------------------------------------------------------ | ------------------------------------ | -------- |
| `host`      | `read(f, offset, len)`：ファイル内容の読み取り                                       |                                      |          |
| `host`      | `image-size(f)`・`image-thumbnail(f, edge)`：アプリ標準対応画像のサイズ取得と縮小 PNG 生成 |                                      |          |
| `host`      | `setting(key)`：プラグイン設定値の取得                                               |                                      |          |
| `host`      | `get-data(key)`・`set-data(key, value)`：ライブラリごとに保存するデータの取得・更新  |                                      |          |
| `host`      | `fetch(url)`：HTTP GET リクエスト                                                    | `plugin.json` の `fetch`             |          |
| `host`      | `log(message)`：ログ出力                                                             |                                      |          |
| `commands`  | `available(name)`・`run(name, args, timeout-ms)`                                     | `required`・`optional` の `commands` |          |
| `library`   | `item(f)`：ID・名前・ノート判定・プロジェクト・タグ・メモの取得                      | `library`                            | `read`   |
| `embed`     | `available()`・`text(s)`・`similar(s, limit)`                                        | `embed`                              | `read`   |
| `clipboard` | `copy(text)`                                                                         | `clipboard`                          | `run`    |
| `notes`     | `create(name, body)`・`set-body(f, body)`                                            | `notes`                              | `run`    |
| `edit`      | `rename(f, name)`・`set-tags(f, tags)`                                               | `edit`                               | `run`    |
| `assets`    | `create(name)`・`write(f, data)`・`add(f, name)`・`replace(target, source)`          | `assets`                             | `run`    |
| `export`    | `create(name)`・`write(f, data)`                                                     | `export`                             | `run`    |

- `host::fetch` は `fetched { status, url, content-type, body }` を返す。`url` はリダイレクト解決後の URL であり、リダイレクト先も `fetch` に指定したホストに制限される。レスポンスボディは最大 16 MB。ステータスコードが 200 以外でも `Ok` として返る
- `commands::run` の引数に `file` を指定すると実ファイルパスに展開されてコマンドに渡される。標準入力は空で、`timeout-ms` 省略時は 30 秒でタイムアウトする
- `run` トークンを使う関数で行った操作は、`run-menu` または `hook` が `Ok` を返した後にアプリ本体側で反映される。`Err` を返した場合は破棄される
- `clipboard` と `export` は `run-menu` 内でのみ使用できる
- 作成したノートと追加した素材は、`targets` の先頭項目と同じ所属（プロジェクト・グループ）に配置される
- `assets::create`・`export::create` で作成した一時ファイルには、`write` でデータを書き込むか、`commands::run` の引数に渡して外部コマンドに出力させる
- `assets::replace` は `source` の拡張子に合わせて対象ファイルを置き換え、元のファイルは削除される。名前・タグ・メモは維持される
- `export::create` は 1 回の `run-menu` につき 1 ファイルのみ作成可能。保存先はファイル保存ダイアログでユーザーが選択する
- `embed` は AI 機能が有効かつモデルがインストールされている場合のみ使用できる。`similar` は AI 検索と同じベクトルインデックスを使用するため、インデックス未作成の項目は結果に含まれない
