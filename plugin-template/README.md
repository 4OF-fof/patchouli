# Patchouli のプラグインのテンプレート

このフォルダを丸ごと写して、プラグインを作り始める。例として、CSV の表を表示し、サムネイルを作る。

## 要るもの

- Node 22.18 以上（`node patchouli/cli.ts` で TypeScript をそのまま動かす）
- Rust と `rustup target add wasm32-wasip2`（処理部分の WASM を作る）

## 使い方

```bash
npm install
npm run build   # dist/ に、アプリに入れられる形（plugin.json・plugin.wasm・ui.js）を作る
npm run zip     # build したものを <id>-<版>.zip にする
```

できた zip は、アプリの「プラグイン」から「インストール」で選ぶ。

## 中身

| ファイル | 役目 |
| --- | --- |
| `plugin.json` | id・名前・版と、対応する形式。上の階層の `elevated` には、ビルド後の `.js` のパスを書く（元は拡張子を `.ts` にしたもの） |
| `src/lib.rs` | sandbox（WASM）。受け持つ役割（下の「WASM の役割」）を実装する |
| `ui.ts` | elevated。アプリの画面の中で動き、sandbox でできることに加えて、詳細の表示・波形・カーソルを合わせたときの表示・埋め込みを描ける |
| `patchouli/` | SDK。型（`index.ts`）、ビルドの道具（`cli.ts`）、WASM の取り決め（`wit/plugin.wit`）。書き換えない |

plugin.json の形式ごとに、受け持つものを `sandbox` と `elevated` に書く。

- `sandbox` を `true` にすると、WASM が export する役割（下の表の `thumbnail`・`view`・`details`・`content`）を受け持つ。WASM は権限を絞って動き、ファイルはアプリが渡したものだけを読め、ネットワークは使えない
- `elevated` には受け持つものを並べる。アプリの画面と同じ WebView で動き、権限の制限がない。`sandbox` と同じものを書いたときは `elevated` を使い、中から `api.sandbox()` で `sandbox` の同じものを呼べる

WASM がいらなければ `Cargo.toml` と `src/` を、elevated がいらなければ `ui.ts` と plugin.json の `elevated` を消す。

## WASM の役割

`src/lib.rs` では、受け持つ役割の world を include でまとめた world を作り、役割ごとに `Guest` を実装する。

```rust
wit_bindgen::generate!({
    inline: "
        package local:csv;

        world csv {
            include patchouli:plugin/settings-role@0.11.0;
            include patchouli:plugin/call-role@0.11.0;
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

| world | 実装する `Guest` | 使う場所 |
| --- | --- | --- |
| `thumbnail-role` | `thumbnail` | `sandbox` を `true` にした形式のサムネイル |
| `view-role` | `view`・`decode` | 同じく詳細の表示 |
| `details-role` | `details` | 同じく詳細に足す行 |
| `content-role` | `content` | 同じく内容で探したり分けたりするときに読む区間 |
| `menu-role` | `menu`・`run_menu` | `menu` の `by` を `sandbox` にした右クリックメニュー |
| `settings-role` | `settings` | 設定の項目 |
| `call-role` | `call` | elevated の `api.call` |

- アプリは読み込むときに export を調べて、受け持つものを決める
- 手元のコマンドを動かす `commands::run`・`commands::available` は、plugin.json の `required` か `optional` に `commands` を書いたときだけ使え、書いたコマンドだけを動かせる
- world の `@0.11.0` は `patchouli/wit/plugin.wit` の版と合わせる。アプリは同じマイナー版（1.0 からは同じメジャー版）で、アプリの版以下のものを読む。合わないときは読み込まず、作り直すかアプリを更新するかをプラグインの問題に出す

## 右クリックメニュー

右クリックメニューに項目を足すときは、plugin.json の上の階層に `menu` を書く。

```json
"menu": { "formats": ["csv", "tsv"], "by": "sandbox" }
```

- `formats` は拡張子の並び、`"all"`（ノートも含めたすべて）、`"files"`（ノートを除いたすべて）のどれか。ノートの拡張子は `md`
- 選んだものがすべて `formats` に入るときだけ項目を足す。ほかのプラグインと対象が重なってもよく、プラグインごとに区切って並ぶ
- `by` が `sandbox` なら `src/lib.rs` の `menu`、`elevated` なら `ui.ts` の `menu` で項目を返す。選ばれると `run_menu`（`runMenu`）が呼ばれる
- WASM の `menu` には `read`、`run_menu` には `read` と `run` が渡る。下の権限の関数には、これを最初の引数に渡す
- `run_menu` の戻り値で、結果の出し方を選ぶ

| 戻り値 | 出し方 |
| --- | --- |
| `MenuOutput::None` | 何も出さない |
| `MenuOutput::Toast(text)` | 短い知らせ。終わったことを伝えるときなど |
| `MenuOutput::Overlay(Overlay { title, rows })` | 見出しと値の行を画面に重ねて見せる。値は行ごとにコピーできる |

WASM で次のことをするときは、plugin.json の上の階層の `permissions` に書く。書いていないものを使う WASM は、アプリが読み込まない。

| `permissions` | 使える関数 | 最初の引数 |
| --- | --- | --- |
| `library` | `library::item`（ID・名前・タグ・プロジェクト・メモ） | `read` |
| `clipboard` | `clipboard::copy` | `run` |
| `notes` | `notes::create` | `run` |
| `assets` | `assets::create`・`write`・`add` | `run` |

- コピー・ノートの作成・素材の登録は、`run_menu` が `Ok` を返したあとにアプリが行う。`Err` を返したときは行わない
- 作ったノートと登録した素材は、選んだものの先頭と同じ場所に置く
- `assets::create` で用意したファイルは、`commands::run` の引数に渡してコマンドに書かせるか、`assets::write` で書く

## elevated の書き方

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
- 窓口の一覧と説明は `patchouli/index.ts` にある
