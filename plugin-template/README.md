# Patchouli プラグインテンプレート

このフォルダをコピーしてプラグインの作成を開始する。サンプルとして CSV ファイルの表表示とサムネイル生成が実装されている。

## 必要な環境

- Node 22.18 以上（`node patchouli/cli.ts` で TypeScript を直接実行するために使用）
- Rust と `rustup target add wasm32-wasip2`（WASM をビルドする場合）

## 使い方

```bash
npm install
npm run build   # dist/ に読み込み用ファイル（plugin.json・plugin.wasm・ui.js）を出力する
npm run zip     # ビルド結果を <id>-<version>.zip にパッケージ化する
```

出力された ZIP ファイルは、アプリの「プラグイン」画面の「プラグインを追加」から選択してインストールできる。GitHub Releases に添付すれば、「プラグインを追加」にリポジトリ URL を入力してインストールできる。

## ファイル構成

| ファイル      | 役割                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| `plugin.json` | ID・名前・バージョンと対象機能の設定。トップレベルの `script` にはビルド後の `.js` のパスを指定する（ソースは `.ts`） |
| `src/lib.rs`  | WASM 実装。対応するロール（後述の「WASM のロール」）を実装する                                                       |
| `ui.ts`       | スクリプト実装。アプリと同じ WebView で動作し、詳細表示・ホバー表示・埋め込み表示・カスタム画面などを描画する        |
| `patchouli/`  | SDK。型定義（`index.ts`・`manifest.ts`）、ビルド CLI（`cli.ts`）、WIT 定義（`wit/plugin.wit`）。編集しない           |

`plugin.json` の `formats` には、対応する拡張子を `ext` に、対応する機能を `parts` に指定する。

```json
"formats": [{ "ext": ["csv"], "label": "CSV", "parts": ["thumbnail", "view"], "script": ["thumbnail", "view"] }]
```

- `parts` には `thumbnail`・`view`・`details`・`excerpt`・`hover`・`embed` を指定できる。`hover` と `embed` はスクリプトのみ対応可能
- `parts` のうち `script` に指定したものはスクリプト、それ以外は WASM が処理する。WASM はサンドボックス内で動作し、アプリから渡されたファイルのみ読み取れる。スクリプトはアプリ本体と同じ権限で動作する
- スクリプトからは `api.wasm()` で同一プラグインの WASM の同名機能を呼び出せる
- `media` に `image`・`video`・`audio` を指定するとアプリ標準のプレーヤーで表示される。`parts` に `view`・`hover`・`embed` がある場合はプラグイン側の実装が優先される

URL に対応する場合は、`links` の `host` に対象ホスト名を指定する。`links` の機能はすべてスクリプトで実装する。

```json
"links": [{ "host": ["youtube.com", "youtu.be"], "parts": ["thumbnail", "view", "embed", "details"] }]
```

WASM が不要な場合は `Cargo.toml` と `src/` を、スクリプトが不要な場合は `ui.ts` と `plugin.json` の `script` を削除する。

## WASM のロール

`src/lib.rs` では、対応するロールの world を `include` でまとめた world を定義し、ロールごとに `Guest` トレイトを実装する。

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

| world            | 実装する `Guest`   | 用途                                                          |
| ---------------- | ------------------ | ------------------------------------------------------------- |
| `thumbnail-role` | `thumbnail`        | `parts` の `thumbnail`                                        |
| `view-role`      | `view`（`decode`） | `parts` の `view`。詳細表示用の PNG を返す                    |
| `details-role`   | `details`          | `parts` の `details`                                          |
| `excerpt-role`   | `excerpt`          | `parts` の `excerpt`                                          |
| `menu-role`      | `menu`             | `plugin.json` の `menu`（右クリックメニュー）                 |
| `hook-role`      | `hook`             | `plugin.json` の `hooks`                                      |
| `code-role`      | `code`（`render`） | `plugin.json` の `notes` の `code`。SVG または PNG を返す     |
| `settings-role`  | `settings`         | プラグインの設定項目                                          |
| `call-role`      | `call`             | スクリプトの `api.call` から呼び出される関数                  |

- アプリは読み込み時に WASM の export を調べて対応機能を判定する
- 外部コマンドを実行する `commands::run`・`commands::available` は、`plugin.json` の `required` または `optional` に `commands` を指定した場合のみ使用でき、記載したコマンドのみ実行できる
- `host::fetch` は `plugin.json` の `fetch` に指定したホストに対してのみ GET リクエストを行える
- world の `@0.13.0` は `patchouli/wit/plugin.wit` のバージョンと合わせる。アプリは同じマイナーバージョン（`1.0` 以降は同じメジャーバージョン）で、アプリのバージョン以下のものを読み込む

## 右クリックメニュー

右クリックメニューに項目を追加する場合は、`plugin.json` のトップレベルに `menu` を指定し、`src/lib.rs` で `menu` を実装する。

```json
"menu": { "formats": ["csv", "tsv"] }
```

- `formats` には拡張子の配列、`"all"`（ノートを含む全項目）、`"files"`（ノートを除く全ファイル）のいずれかを指定する。ノートの拡張子は `md`
- 選択中の項目がすべて `formats` に含まれる場合のみメニュー項目が表示される。複数プラグインの項目はプラグインごとに区切って表示される
- `menu` で項目一覧を返し、選択されると `run_menu` が呼ばれる。`menu` には `read`、`run_menu` には `read` と `run` のトークンが渡され、権限が必要なホスト関数の第 1 引数に渡す
- `run_menu` の戻り値で実行結果の表示方法を指定する

| 戻り値                                         | 表示方法                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| `MenuOutput::None`                             | 何も表示しない                                                                       |
| `MenuOutput::Toast(Toast { text, level })`     | トースト通知を表示する。`level`（`ToastLevel`）で色と表示時間が変わる                |
| `MenuOutput::Overlay(Overlay { title, rows })` | ラベルと値の一覧をダイアログで表示する。各行の値をコピーできる                       |
| `MenuOutput::Screen(id)`                       | `screens` の画面をタブで開き、選択していた項目を渡す                                 |

`ToastLevel` は `Info`・`Success`・`Warning`・`Error` の 4 種類。`Info` と `Success` は 4 秒後に自動で閉じ、`Warning` と `Error` は閉じるまで表示される。

## フック

素材やノートが追加・変更された際に処理を実行する場合は、`plugin.json` のトップレベルに `hooks` を指定し、`src/lib.rs` で `hook` を実装する。

```json
"hooks": { "added": { "formats": ["md"] }, "changed": { "formats": ["md"] } }
```

| `hooks`   | 実行タイミング                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------- |
| `added`   | アプリに取り込んだとき。右クリックメニューで作成したノートや追加した素材も含む                       |
| `changed` | 内容が変更されたとき。ノートは編集後に画面を離れたとき、ファイルは外部での変更を検出したとき         |
| `edited`  | 名前・タグ・所属が変更されたとき                                                                     |

- `formats` の指定方法は `menu` と同じ
- 対象項目ごとにバックグラウンドで `hook` が呼ばれ、`event` に発生したイベント種別が渡される。実行中はタイトルバーの「処理中」から確認・中止できる
- 同じ形式に対応するフックが複数ある場合はプラグイン一覧の順に実行され、前のフックによる変更後の内容が次のフックに渡される
- フック内で行われた変更に対してはフックは再実行されない
- `Err` を返した場合はエラー通知が表示される

## 権限

WASM で次の操作を行う場合は、`plugin.json` のトップレベルの `permissions` に指定する。指定していないインターフェースを import する WASM は読み込まれない。

| `permissions` | 使用できる関数                                                              | 第 1 引数 |
| ------------- | --------------------------------------------------------------------------- | --------- |
| `library`     | `library::item`（ID・名前・タグ・プロジェクト・メモの取得）                 | `read`    |
| `embed`       | `embed::available`・`text`（文章のベクトル化）・`similar`（類似項目の検索） | `read`    |
| `clipboard`   | `clipboard::copy`                                                           | `run`     |
| `notes`       | `notes::create`・`set_body`                                                 | `run`     |
| `edit`        | `edit::rename`・`set_tags`                                                  | `run`     |
| `assets`      | `assets::create`・`write`・`add`・`replace`（ファイル内容の置き換え）       | `run`     |
| `export`      | `export::create`・`write`（ライブラリ外へのファイルの書き出し）             | `run`     |

- `run` トークンを使う関数で行った操作は、`run_menu`・`hook` が `Ok` を返した後にアプリ本体側で反映される。`Err` を返した場合は破棄される
- `clipboard` と `export` は `run_menu` 内でのみ使用できる
- 作成したノートと追加した素材は、`targets` の先頭項目と同じ場所に配置される
- `assets::create`・`export::create` で作成した一時ファイルには、`commands::run` の引数に渡して外部コマンドに出力させるか、`write` でデータを書き込む
- `assets::replace` は置き換え先ファイルの拡張子に合わせ、元のファイルは削除する
- 1 回の `run_menu` で書き出せるファイルは 1 件のみ。複数ある場合は ZIP などにまとめる。保存先はダイアログでユーザーが選択する
- `embed` は AI 機能が有効かつモデルがインストールされている場合のみ使用できる。`similar` は AI 検索と同じベクトルインデックスを使用する

## カスタム画面

ホームや「すべて」と並ぶ画面を追加する場合は、`plugin.json` のトップレベルに `screens` を指定し、スクリプトの `screens` で描画する。画面はタブとして開く。

```json
"screens": {
  "graph": { "label": "ページの関係図", "icon": "diagram", "place": false }
}
```

| キー    | 内容                                                                              |
| ------- | --------------------------------------------------------------------------------- |
| `label` | ナビゲーションメニューやタブに表示する名前                                        |
| `icon`  | アプリ本体のアイコン名。省略時はプラグインのアイコン                              |
| `place` | ナビゲーションメニュー・コマンド・起動時の画面の選択肢に表示するか。既定は `true` |

- `place` が `false` の画面は、右クリックメニューの戻り値 `MenuOutput::Screen` から開く
- 画面の `api.targets()` で右クリックメニュー実行時に選択されていた項目を取得できる

## ノートのコードブロック

ノートの ```` ```abc ```` のようなコードブロックを描画する場合は、`plugin.json` のトップレベルに `notes` を指定する。

```json
"notes": {
  "code": ["abc"],
  "script": ["abc"],
  "slash": [{ "label": "楽譜", "keys": "abc gakufu", "insert": "```abc\n$0\n```" }]
}
```

| キー     | 内容                                                                                               |
| -------- | -------------------------------------------------------------------------------------------------- |
| `code`   | 対応する言語名の配列                                                                               |
| `script` | `code` のうちスクリプトの `code` で描画するもの。指定しないものは WASM の `render` が SVG か PNG を返す |
| `slash`  | ノートの `/` メニューに追加する項目。`insert` を挿入し、`$0` の位置にカーソルを置く                |

- スクリプトの `code.abc.render(el, api)` は `el` 内に描画する。`api.source` で現在の内容を取得し、`api.setSource(source)` で内容を更新できる。内容が変わると `update(el, api)` が呼ばれる
- WASM の `render(lang, source)` は内容が変わるたびに呼ばれる。SVG ではアプリ本体の CSS 変数（`--ink` など）を使用できる

## 概要欄のカード

タグやプロジェクトの概要欄にカードを追加する場合は、`plugin.json` のトップレベルに `covers` を指定し、スクリプトの `covers` で描画する。カードは「概要を編集」の「セクションを追加」から配置できる。

```json
"covers": {
  "goal": { "label": "目標", "note": "件数の目標と進み具合", "on": ["tag", "project"] }
}
```

| キー       | 内容                                                           |
| ---------- | -------------------------------------------------------------- |
| `label`    | カードの見出しと「セクションを追加」メニューに表示する名前     |
| `note`     | 「セクションを追加」メニューで名前の下に表示する補足説明       |
| `on`       | 配置できる画面。`tag`・`project`。既定は両方                   |
| `multiple` | 1 つの概要欄に複数配置できるか。既定は `false`                 |

- スクリプトの `covers.goal.mount(el, api)` は `el` 内に描画する。`api.items()` で対象項目の一覧を取得し、変更時は `api.onChange` のリスナーが呼ばれる
- `api.setValue(value)` でカードごとに JSON 値を保存でき、`api.value` で読み取れる
- `api.editing` で「概要を編集」モード中かを判定でき、切り替わりは `api.onEditing` で受け取れる
- プラグインを無効化するとカードは非表示になり、再度有効化すると保存された値とともに復元される

## スクリプトの実装方法

`@patchouli/plugin` から `definePlugin` を import し、`default` エクスポートする。型引数に WASM の `call` で呼び出せるメソッドと設定の型を指定すると、`api.call` と `api.settings` に型が付く。

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

- `api.call(method, args?)` の引数と戻り値は JSON として受け渡される。WASM の `call` は JSON 文字列を受け取り、JSON 文字列を返す
- `api.read(offset, length)` はファイル内容を `Uint8Array` で返す
- `links` の `api.fetch(url)` は `plugin.json` の `fetch` に指定したホストへアプリ本体経由で HTTP GET を行う
- API の全一覧と説明は `patchouli/index.ts` に記載されている
