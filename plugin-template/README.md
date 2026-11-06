# Patchouli のプラグインのテンプレート

このフォルダを丸ごと写して、プラグインを作り始める。例として、CSV の表を表示し、サムネイルを作る。

## 要るもの

- Node 22.18 以上（`node patchouli/cli.ts` で TypeScript をそのまま動かす）
- Rust と `rustup target add wasm32-wasip2`（WASM を作る）

## 使い方

```bash
npm install
npm run build   # dist/ に、アプリに入れられる形（plugin.json・plugin.wasm・ui.js）を作る
npm run zip     # build したものを <id>-<版>.zip にする
```

できた zip は、アプリの「プラグイン」の「プラグインを追加」で選ぶ。GitHub のリリースに付ければ、「プラグインを追加」にリポジトリの URL を入れて入れられる。

## 中身

| ファイル      | 役目                                                                                                                         |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `plugin.json` | id・名前・版と、受け持つもの。上の階層の `script` には、ビルド後の `.js` のパスを書く（元は拡張子を `.ts` にしたもの）       |
| `src/lib.rs`  | WASM。受け持つ役割（下の「WASM の役割」）を実装する                                                                          |
| `ui.ts`       | スクリプト。アプリの画面の中で動き、WASM でできることに加えて、詳細の表示・カーソルを合わせたときの表示・埋め込み・画面を描ける |
| `patchouli/`  | SDK。型（`index.ts`・`manifest.ts`）、ビルドの道具（`cli.ts`）、WASM の取り決め（`wit/plugin.wit`）。書き換えない            |

plugin.json の `formats` には、同じ扱いの拡張子を `ext` に並べ、受け持つものを `parts` に書く。

```json
"formats": [{ "ext": ["csv"], "label": "CSV", "parts": ["thumbnail", "view"], "script": ["thumbnail", "view"] }]
```

- `parts` は `thumbnail`・`view`・`details`・`excerpt`・`hover`・`embed` から選ぶ。`hover` と `embed` はスクリプトだけが受け持てる
- `parts` のうち `script` に書いたものはスクリプト、ほかは WASM が受け持つ。WASM は権限を絞って動き、ファイルはアプリが渡したものだけを読める。スクリプトは権限の制限なく動く
- スクリプトの中から `api.wasm()` で、WASM の同じものを呼べる
- `media` に `image`・`video`・`audio` を書くと、アプリがそのまま出す。`parts` の `view`・`hover`・`embed` があれば、そちらを使う

URL を受け持つときは、`links` に同じ扱いのホスト名を `host` に並べる。受け持つものはすべてスクリプトが描く。

```json
"links": [{ "host": ["youtube.com", "youtu.be"], "parts": ["thumbnail", "view", "embed", "details"] }]
```

WASM がいらなければ `Cargo.toml` と `src/` を、スクリプトがいらなければ `ui.ts` と plugin.json の `script` を消す。

## WASM の役割

`src/lib.rs` では、受け持つ役割の world を include でまとめた world を作り、役割ごとに `Guest` を実装する。

```rust
wit_bindgen::generate!({
    inline: "
        package local:csv;

        world csv {
            include patchouli:plugin/settings-role@0.13.0;
            include patchouli:plugin/call-role@0.13.0;
        }
    ",
    path: "patchouli/wit",
    world: "local:csv/csv",
    generate_all,
});

use exports::patchouli::plugin as role;

impl role::settings::Guest for Csv { /* ... */ }
impl role::call::Guest for Csv { /* ... */ }
```

| world            | 実装する `Guest`   | 使う場所                                           |
| ---------------- | ------------------ | -------------------------------------------------- |
| `thumbnail-role` | `thumbnail`        | `parts` の `thumbnail`                             |
| `view-role`      | `view`（`decode`） | `parts` の `view`。詳細に出す PNG を作る           |
| `details-role`   | `details`          | `parts` の `details`                               |
| `excerpt-role`   | `excerpt`          | `parts` の `excerpt`                               |
| `menu-role`      | `menu`             | plugin.json の `menu`（右クリックメニュー）        |
| `hook-role`      | `hook`             | plugin.json の `hooks`                             |
| `code-role`      | `code`（`render`） | plugin.json の `notes` の `code`。SVG か PNG を返す |
| `settings-role`  | `settings`         | 設定の項目                                         |
| `call-role`      | `call`             | スクリプトの `api.call`                            |

- アプリは読み込むときに export を調べて、受け持つものを決める
- 手元のコマンドを動かす `commands::run`・`commands::available` は、plugin.json の `required` か `optional` に `commands` を書いたときだけ使え、書いたコマンドだけを動かせる
- `host::fetch` は、plugin.json の `fetch` に書いたホストにだけ GET できる
- world の `@0.13.0` は `patchouli/wit/plugin.wit` の版と合わせる。アプリは同じマイナー版（1.0 からは同じメジャー版）で、アプリの版以下のものを読む。合わないときは読み込まず、作り直すかアプリを更新するかをプラグインの問題に出す

## 右クリックメニュー

右クリックメニューに項目を足すときは、plugin.json の上の階層に `menu` を書き、`src/lib.rs` で `menu` を実装する。

```json
"menu": { "formats": ["csv", "tsv"] }
```

- `formats` は拡張子の並び、`"all"`（ノートも含めたすべて）、`"files"`（ノートを除いたすべて）のどれか。ノートの拡張子は `md`
- 選んだものがすべて `formats` に入るときだけ項目を足す。ほかのプラグインと対象が重なってもよく、プラグインごとに区切って並ぶ
- `menu` で項目を返し、選ばれると `run_menu` が呼ばれる。`menu` には `read`、`run_menu` には `read` と `run` が渡る。下の権限の関数には、これを最初の引数に渡す
- `run_menu` の戻り値で、結果の出し方を選ぶ

| 戻り値                                         | 出し方                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| `MenuOutput::None`                             | 何も出さない                                                                          |
| `MenuOutput::Toast(Toast { text, level })`     | 短い知らせ。終わったことを伝えるときなど。`level`（`ToastLevel`）で色と消え方が変わる |
| `MenuOutput::Overlay(Overlay { title, rows })` | 見出しと値の行を画面に重ねて見せる。値は行ごとにコピーできる                          |
| `MenuOutput::Screen(id)`                       | `screens` の画面をタブで開き、選んだものを渡す                                        |

`ToastLevel` は `Info`（グレー）・`Success`（緑）・`Warning`（黄土色）・`Error`（赤）。`Info` と `Success` は 4 秒で消え、`Warning` と `Error` は閉じるまで残る。

## フック

素材やノートが変わったときに動かすときは、plugin.json の上の階層に `hooks` を書き、`src/lib.rs` で `hook` を実装する。

```json
"hooks": { "added": { "formats": ["md"] }, "changed": { "formats": ["md"] } }
```

| `hooks`   | 呼ぶとき                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------ |
| `added`   | アプリで取り込んだとき。右クリックメニューで作ったノートと登録した素材も含む                     |
| `changed` | 中身が変わったとき。ノートは書き換えて離れたとき、ファイルはアプリの外で変わったのを見つけたとき |
| `edited`  | 名前・タグ・置き場を変えたとき                                                                   |

- `formats` の書き方は `menu` と同じ
- 1 つごとに、裏で `hook` を呼ぶ。`event` に、どのときかが入る。動いているあいだは作業の表示に出て、そこから止められる
- 同じ形式のフックが複数あれば、プラグインの一覧の順に呼び、前のフックが書き換えたあとのものを渡す
- フックの中で書き換えたものには、フックを呼ばない
- `Err` を返すと、そのたびに知らせを出す

## 権限

WASM で次のことをするときは、plugin.json の上の階層の `permissions` に書く。書いていないものを使う WASM は、アプリが読み込まない。

| `permissions` | 使える関数                                                                  | 最初の引数 |
| ------------- | --------------------------------------------------------------------------- | ---------- |
| `library`     | `library::item`（ID・名前・タグ・プロジェクト・メモ）                       | `read`     |
| `embed`       | `embed::available`・`text`（文章のベクトル）・`similar`（近い素材とノート） | `read`     |
| `clipboard`   | `clipboard::copy`                                                           | `run`      |
| `notes`       | `notes::create`・`set_body`                                                 | `run`      |
| `edit`        | `edit::rename`・`set_tags`                                                  | `run`      |
| `assets`      | `assets::create`・`write`・`add`・`replace`（中身を置き換える）             | `run`      |
| `export`      | `export::create`・`write`（ライブラリの外へ書き出す）                       | `run`      |

- `run` の関数で頼んだことは、`run_menu`・`hook` が `Ok` を返したあとにアプリが行う。`Err` を返したときは行わない
- `clipboard` と `export` は `run_menu` の中だけで使える
- 作ったノートと登録した素材は、対象の先頭と同じ場所に置く
- `assets::create`・`export::create` で用意したファイルは、`commands::run` の引数に渡してコマンドに書かせるか、`write` で書く
- `assets::replace` は拡張子を置き換えたファイルに合わせ、元のファイルは残さない
- 書き出せるのは 1 回に 1 つのファイルだけ。複数あるときは zip などにまとめる。保存先はアプリが聞く
- `embed` は、AI 機能を有効にしてモデルを入れたときだけ使える。`similar` は内容での検索と同じ索引を使う

## 画面

ホームやすべてと並ぶ画面を足すときは、plugin.json の上の階層に `screens` を書き、スクリプトの `screens` で描く。画面はタブで開く。

```json
"screens": {
  "graph": { "label": "ページの関係図", "icon": "diagram", "place": false }
}
```

| キー    | 中身                                                                |
| ------- | ------------------------------------------------------------------- |
| `label` | 場所のメニューやタブに出す名前                                      |
| `icon`  | 本体のアイコンの名前。書かないときはプラグインのアイコン            |
| `place` | 場所のメニュー・コマンド・起動時に開く画面に並べるか。既定は `true` |

- `place` が `false` の画面は、右クリックメニューの戻り値の `MenuOutput::Screen` で開く
- 画面の `api.targets()` で、右クリックメニューで選んでいたものを読める

## ノートのコードブロック

ノートの ```` ```abc ```` のようなコードブロックを描くときは、plugin.json の上の階層に `notes` を書く。

```json
"notes": {
  "code": ["abc"],
  "script": ["abc"],
  "slash": [{ "label": "楽譜", "keys": "abc gakufu", "insert": "```abc\n$0\n```" }]
}
```

| キー     | 中身                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------ |
| `code`   | 描く言語の並び                                                                                         |
| `script` | `code` のうち、スクリプトの `code` で描くもの。ほかは WASM の `render` が SVG か PNG を返して描く      |
| `slash`  | ノートの `/` のメニューに足す項目。`insert` を入れ、`$0` の位置にカーソルを置く                        |

- スクリプトの `code.abc.render(el, api)` は `el` に描く。`api.source` がいまの中身で、`api.setSource(source)` で書き換えられる。中身が変わると `update(el, api)` が呼ばれる
- WASM の `render(lang, source)` は、中身が変わるたびに呼ばれる。SVG では本体の CSS 変数（`--ink` など）を使える

## スクリプトの書き方

`@patchouli/plugin` から `definePlugin` を読み、`default` で書き出す。型の引数に、WASM の `call` で呼べるものと設定の型を書くと、`api.call` と `api.settings` に型が付く。

```ts
import { definePlugin } from '@patchouli/plugin'

export default definePlugin<{
  methods: { summary(): { rows: number; columns: number } }
  settings: { header: boolean }
}>({
  mount(el, api) {
    // api.call('summary') は Promise<{ rows: number; columns: number }>
  },
})
```

- `api.call(method, args?)` の引数と戻り値は JSON にして受け渡す。WASM の `call` は JSON の文字列を受け取り、JSON の文字列を返す
- `api.read(offset, length)` は素材の中身を `Uint8Array` で返す
- `links` の `api.fetch(url)` は、plugin.json の `fetch` に書いたホストへアプリが代わりに取りに行く
- 窓口の一覧と説明は `patchouli/index.ts` にある
