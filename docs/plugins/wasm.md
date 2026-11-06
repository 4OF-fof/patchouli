# WASM

WASM は WIT（SDK の `wit/plugin.wit`）の component で、`wasm32-wasip2` でビルドする。ファイルはアプリが渡したものだけを読め、ネットワークは `host::fetch` で plugin.json の `fetch` に書いたホストにだけ行ける。`commands` で動かすコマンドは WASM の外で、アプリと同じ権限で動く。

## world の作り方

受け持つ役割の world を `include` でまとめた world を作り、役割ごとに `Guest` を実装する。アプリは読み込むときに export を調べて、受け持つものを決める。

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

- `@0.13.0` は `wit/plugin.wit` の版と合わせる。アプリは同じマイナー版（1.0 からは同じメジャー版）で、アプリの版以下のものを読む
- `Cargo.toml` の `crate-type` は `cdylib`。依存は `wit-bindgen` だけでよい

## 役割

`thumbnail`・`view`・`details`・`excerpt` は、`formats` の `parts` に書き、`script` に書いていないものを受け持つ。`render` は、`notes` の `code` に書き、`script` に書いていないものを受け持つ。書いたのに export していないものは、一覧の「問題」に出る。

| world            | 実装する関数                                              | 呼ばれるとき                                                 | 時間の上限 |
| ---------------- | --------------------------------------------------------- | ------------------------------------------------------------ | ---------- |
| `thumbnail-role` | `thumbnail(format, f, edge)`                              | サムネイルを作るとき                                         | 10 秒      |
| `view-role`      | `decode(format, f)`                                       | 詳細を開いたとき                                             | 30 秒      |
| `details-role`   | `details(format, f)`                                      | ファイルの詳細を開いたとき                                   | 30 秒      |
| `excerpt-role`   | `excerpt(format, f, budget)`                              | 内容を読むとき（AI 機能）                                    | 120 秒     |
| `menu-role`      | `menu(read, targets)`・`run-menu(read, run, targets, id)` | `menu` の `formats` に入るもののメニューを開いたとき・選んだとき | 30 秒      |
| `hook-role`      | `hook(read, run, event, target)`                          | `hooks` に書いたとき                                         | 60 秒      |
| `code-role`      | `render(lang, source)`                                    | ノートのコードブロックを描くとき・スクリプトの `api.wasm()`  | 10 秒      |
| `settings-role`  | `settings()`                                              | ライブラリを開いたとき                                       | 2 秒       |
| `call-role`      | `call(format, f, method, args)`                           | スクリプトの `api.call`                                      | 30 秒      |

上限を過ぎると止める。`commands::run`・`embed`・`host::fetch` を待っているあいだは数えない。

### thumbnail

`thumbnail-image { png, size }` を返す。`png` は長いほうの辺が `edge` 以下の PNG、`size` は素材そのものの大きさ（わからなければ `none`）。作らないときは `none`。

### decode

詳細に出す PNG を、素材そのものの大きさで返す。アプリが画像として出し、作った PNG を取っておく。

### details

`detail { label, value }` の並びを返す。ファイルの詳細の、種類のあとに入る。

### excerpt

`excerpt-budget` を超えないように `excerpt-part` を返す。区間の分け方はプラグインが決める。空なら、アプリがサムネイルを読む。

| `excerpt-media` | 中身                                                   |
| --------------- | ------------------------------------------------------ |
| `images`        | PNG か JPEG。複数あれば、まとめて 1 つの区間として読む |
| `audio`         | WAV                                                    |
| `text`          | 文章                                                   |

`start` と `end` は区間の秒で、素材全体なら `none`。

### menu と run-menu

`menu` は項目（`menu-item { id, label }`）を返す。`targets` は選んでいるものすべてで、数を見て、1 つのときだけの項目を返せる。選ばれると、同じ `targets` と項目の `id` で `run-menu` を呼ぶ。

| `menu-output`              | 出し方                                                             |
| -------------------------- | ------------------------------------------------------------------ |
| `none`                     | 何も出さない                                                       |
| `toast({ text, level })`   | 短い知らせ。`level`（`toast-level`）は重要度で、色と消え方が変わる |
| `overlay({ title, rows })` | 見出しと値の行を画面に重ねる。値は行ごとにコピーできる             |
| `screen(id)`               | `screens` の画面をタブで開き、`targets` を渡す                     |

`toast-level` は `info`（グレー）・`success`（緑）・`warning`（黄土色）・`error`（赤）。`info` と `success` は 4 秒で消え、`warning` と `error` は閉じるまで残る。

### hook

`event`（`hook-event`）は plugin.json の `hooks` のキーと同じで、`added`・`changed`・`edited` のどれか。`target` は 1 つで、1 つごとに裏で呼ぶ。

- `Err` を返すと、そのたびに知らせを出す
- 同じ形式のフックが複数あれば、前のフックが書き換えたあとのものを渡す
- フックの中で書き換えたものには、フックを呼ばない

### render

`lang` はコードブロックの言語（小文字）、`source` は囲みの ```` ``` ```` の行を除いた中身で、中身が変わるたびに呼ぶ。`code-image` を返し、本文の幅を超えるものは縮めて出す。`Err` を返すと、その文言を下に出す。

| `code-image` | 中身                                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `svg`        | SVG の文書。アプリが script・アニメーション・イベントの属性・外への参照を取り除き、本体の画面と切り離して出す。本体の CSS 変数（`--ink` など）を使える |
| `png`        | PNG                                                                                                                          |

### settings

`setting { key, label, help, kind, default }` の並びを返す。アプリの部品が描き、値はライブラリに残す。値は `host::setting`、スクリプトの `api.settings()` で読む。

| `setting-kind`               | 部品                                          |
| ---------------------------- | --------------------------------------------- |
| `toggle`                     | 切り替え                                      |
| `number({ min, max, step })` | 数                                            |
| `text`                       | 文字                                          |
| `choice(choices)`            | 選択肢。選んだものの `value` を `text` で持つ |

### call

`method` と `args` の中身はプラグインが決める。スクリプトの `api.call(method, args)` は、`args` を JSON にして渡し、返した文字列を JSON として読む。

## ホストの関数

`file` は、その呼び出しの中だけで使える。`read` と `run` は `menu`・`run-menu`・`hook` に渡る証明で、権限のある関数の最初の引数に渡す。

| interface   | 関数                                                                                | 権限（`permissions`）                 | 証明   |
| ----------- | ----------------------------------------------------------------------------------- | ------------------------------------- | ------ |
| `host`      | `read(f, offset, len)`：中身を読む                                                  |                                       |        |
| `host`      | `image-size(f)`・`image-thumbnail(f, edge)`：アプリが読める画像の大きさと縮めた PNG |                                       |        |
| `host`      | `setting(key)`：自分の設定の値                                                      |                                       |        |
| `host`      | `get-data(key)`・`set-data(key, value)`：ライブラリごとに残す値                     |                                       |        |
| `host`      | `fetch(url)`：GET で取ってくる                                                      | plugin.json の `fetch`                |        |
| `host`      | `log(message)`                                                                      |                                       |        |
| `commands`  | `available(name)`・`run(name, args, timeout-ms)`                                    | `required`・`optional` の `commands`  |        |
| `library`   | `item(f)`：ID・名前・ノートか・プロジェクト・タグ・メモ                             | `library`                             | `read` |
| `embed`     | `available()`・`text(s)`・`similar(s, limit)`                                       | `embed`                               | `read` |
| `clipboard` | `copy(text)`                                                                        | `clipboard`                           | `run`  |
| `notes`     | `create(name, body)`・`set-body(f, body)`                                           | `notes`                               | `run`  |
| `edit`      | `rename(f, name)`・`set-tags(f, tags)`                                              | `edit`                                | `run`  |
| `assets`    | `create(name)`・`write(f, data)`・`add(f, name)`・`replace(target, source)`         | `assets`                              | `run`  |
| `export`    | `create(name)`・`write(f, data)`                                                    | `export`                              | `run`  |

- `host::fetch` は `fetched { status, url, content-type, body }` を返す。`url` はリダイレクトをたどったあとのもので、行き先も `fetch` に書いたホストに限る。本文は 16 MB まで。`status` が 200 以外でも `Ok` で返す
- `commands::run` の引数の `file` は、そのファイルの場所に置き換えて渡す。標準入力は空で、`timeout-ms` を書かなければ 30 秒で止める
- `run` の関数で頼んだことは、`run-menu`・`hook` が `Ok` を返したあとにアプリが行う。`Err` を返したときは行わない
- `clipboard` と `export` は `run-menu` の中だけで使える
- 作ったノートと登録した素材は、`targets` の先頭と同じ場所に置く
- `assets::create`・`export::create` で用意したファイルには、`write` で書くか、`commands::run` の引数に渡してコマンドに書かせる
- `assets::replace` は、拡張子を `source` に合わせて変え、元のファイルは残さない。名前・タグ・メモはそのまま
- `export::create` は 1 回の `run-menu` で 1 つだけ。保存先はアプリが聞く
- `embed` は、AI 機能を有効にしてモデルを入れたときだけ使える。`similar` は内容での検索と同じ索引を使うので、索引をまだ作っていないものは出ない
