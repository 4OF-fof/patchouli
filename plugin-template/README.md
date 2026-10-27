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
| `plugin.json` | id・名前・版と、対応する形式。`ui` には、ビルド後の `.js` のパスを書く（元は拡張子を `.ts` にしたもの） |
| `src/lib.rs` | 処理部分（WASM）。サムネイル・詳細の記述・設定の項目・`call` で呼ばれる関数 |
| `ui.ts` | 組み込み UI。アプリの画面の中で動き、詳細の表示・サムネイル・波形・カーソルを合わせたときの表示を描ける |
| `patchouli/` | SDK。型（`index.ts`）、ビルドの道具（`cli.ts`）、WASM の取り決め（`wit/plugin.wit`）。書き換えない |

WASM がいらなければ `Cargo.toml` と `src/` を、組み込み UI がいらなければ `ui.ts` と plugin.json の `ui` を消す。

## 組み込み UI の書き方

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
