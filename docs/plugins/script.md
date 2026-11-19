# スクリプト（TypeScript）

スクリプトはアプリ本体と同じ WebView 上で動作する ES モジュールであり、`@patchouli/plugin` から型とヘルパーを import する。型定義の詳細は SDK の `index.ts` に記載されている。

```ts
import { definePlugin } from '@patchouli/plugin'

interface Zip {
  methods: { entries(): { entries: { path: string; size: number }[]; packed: number } }
  settings: { sort: string }
}

export default definePlugin<Zip>({
  mount(el, api) {
    void api.call('entries').then(({ entries }) => {
      el.textContent = `${entries.length} 件`
    })
    return () => el.replaceChildren()
  },
})
```

- 型引数の `methods` に WASM の `call` で呼び出せる関数、`settings` に設定のキーと値の型を指定すると `api.call` と `api.settings()` に型が付く
- `api.call(method, args?)` は `args` を JSON 文字列に変換して WASM の `call` に渡し、戻り値の文字列を JSON としてパースする（空文字列なら `undefined`）

## エクスポートする関数

`default` エクスポートに対象機能（`plugin.json` の `formats` の `script`・`links`・`screens`・`notes` の `script`・`covers`）に対応する関数を定義する。

| プロパティ         | 対応する機能 | 戻り値・内容                                                                             |
| ------------------ | ------------ | ---------------------------------------------------------------------------------------- |
| `mount(el, api)`   | `view`       | 画面を閉じるときに呼ばれるクリーンアップ関数（任意）                                     |
| `thumbnail(api)`   | `thumbnail`  | `{ png, width?, height? }` または `null`。`width`・`height` は元素材のピクセルサイズ     |
| `thumbnailTimeout` | `thumbnail`  | タイムアウト時間（ms）。既定は 10 秒、最大 30 秒                                         |
| `hover(el, api)`   | `hover`      | カーソルが離れたときに呼ばれるクリーンアップ関数（任意）                                 |
| `embed(el, api)`   | `embed`      | 埋め込み要素が破棄されるときに呼ばれるクリーンアップ関数（任意）                         |
| `details(api)`     | `details`    | `{ label, value }` の配列                                                                |
| `excerpt(api)`     | `excerpt`    | `{ start?, end?, images? / audio? / text? }` の配列。`api.budget` の上限内で返す         |
| `links`            | `links`      | `thumbnail`・`mount`・`details`・`excerpt`・`hover`・`embed` を持つオブジェクト          |
| `screens`          | `screens`    | 画面 ID → `{ mount(el, api) }`                                                           |
| `code`             | `notes`      | 言語名 → `{ render(el, api), update?(el, api) }`。`render` は破棄時のクリーンアップ関数を返す |
| `covers`           | `covers`     | カード ID → `{ mount(el, api) }`                                                         |

- `hover` はカーソルを合わせているカード 1 枚に対してのみ呼ばれるため、動画や音声の再生も可能
- `embed` の `el` はノート本文の幅になり、高さは描画内容に合わせて決まる
- `excerpt` の `api.signal` はタイムアウト時や中断時に abort される

## API

素材 1 件に対する `Api` オブジェクトは `mount`・`thumbnail`・`hover`・`embed`・`details`・`excerpt` に渡される。

| プロパティ・メソッド         | 内容                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `item`                       | `{ id, name, ext, url? }`。`url` は実ファイルの URL で、`fetch` や `img`・`video` の `src` に使用可能 |
| `read(offset, length)`       | ファイル内容を `Uint8Array` で読み取る。1 回につき最大 16 MB                                     |
| `call(method, args?)`        | 同一プラグインの WASM の `call` を呼び出す                                                       |
| `plugin(id).call(...)`       | `required`・`optional` の `plugins` に指定した依存プラグインの WASM の `call` を呼び出す         |
| `settings()`・`setSetting()` | プラグイン設定の取得・更新                                                                       |
| `getData()`・`setData()`     | ライブラリごとに保存されるプラグイン固有データの取得・更新（WASM の `get-data`・`set-data` と共通） |
| `wasm()`                     | 同一プラグインの WASM の同名機能（`thumbnail`・`details`・`excerpt`）を呼び出す                  |

`excerpt` 内で `api.wasm()` を呼ぶと、WASM が生成した区間の位置と種別のみが返り、実データはアプリ本体側で保持・結合される（スクリプト側で再度返す必要はない）。

### links

`links` の各関数には URL 用の `LinkApi` が渡される。

| プロパティ・メソッド | 内容                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `url`                | 対象の URL                                                                                                                         |
| `fetch(url)`         | アプリ本体経由で HTTP GET を行い、`{ status, url, type?, body }` を返す。CORS の制限を受けない。`plugin.json` の `fetch` に指定したホストのみ、最大 16 MB |
| `edge`               | `thumbnail` で渡される長辺の最大サイズ（px）                                                                                       |
| `budget`・`signal`   | `excerpt` で渡される上限設定と `AbortSignal`（`Api` と同じ）                                                                       |
| `settings()` など    | プラグイン設定と保存データ（`Api` と同じ）                                                                                         |

`embed` はショートカットファイル（`.url`）をノートに埋め込んだ場合と、URL を直接ノートに埋め込んだ場合の両方で使われる。

### screens

画面の `mount(el, api)` に渡される `el` は画面全体の領域を持ち、溢れた内容はスクロール可能になる。

| プロパティ・メソッド                                         | 内容                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `targets()`                                                  | 右クリックメニューから開いた際に選択されていた項目の配列。それ以外の経路では空 |
| `items()`・`item(id)`                                        | ライブラリ内の全項目・指定 ID の項目を取得                                     |
| `onChange(fn)`                                               | 項目の追加・変更・削除時に呼ばれるリスナーを登録する。戻り値の関数で解除する   |
| `open(id)`・`openTag(tag)`・`openProject(name)`              | 項目・タグ・プロジェクトを開く。`{ newTab: true }` で新しいタブで開く          |
| `createNote({ name?, body?, project? })`                     | ノートを作成する。同名のノートがある場合は末尾に連番が付く                     |
| `setBody(id, body)`・`setTags(id, tags)`・`rename(id, name)` | 項目を更新する。保存に失敗した場合はアプリ本体がエラー通知を出して再読み込みする |
| `settings()` など                                            | プラグイン設定と保存データ（`Api` と同じ）                                     |

ノートの本文内では他項目へのリンクを `[名前](patchouli:<id>)`、埋め込みを `![名前](patchouli:<id>)` と記述する。

### code

コードブロックの `render(el, api)` と `update(el, api)` には `CodeApi` が渡される。`el` の幅は本文の幅になり、高さは描画内容に合わせて決まる。`el` 内のクリックやキー入力はノートエディタ側には伝播しない。

| プロパティ・メソッド | 内容                                                                      |
| -------------------- | ------------------------------------------------------------------------- |
| `lang`               | ```` ``` ```` の直後に指定された言語名（小文字）                          |
| `source`             | コードブロックの中身（囲みの ```` ``` ```` の行を除く）                   |
| `setSource(source)`  | コードブロックの中身を書き換える                                          |
| `wasm()`             | 同一プラグインの WASM の `render` を現在の `source` で呼び出し、`{ svg }` または `{ png }` を返す |
| `fetch(url)`         | `LinkApi` と同じ                                                          |
| `settings()` など    | プラグイン設定と保存データ（`Api` と同じ）                                |

`update` はコードブロックの内容が変わるたび（エディタでの編集時および `setSource` 呼び出し後）に呼ばれる。`update` を省略した場合は、`render` が返したクリーンアップ関数を実行してから再度 `render` が呼ばれる。

### covers

概要カードの `mount(el, api)` にはカード 1 枚ごとの `CoverApi` が渡される。`el` の幅は概要欄の幅になり、高さは描画内容に合わせて決まる。

| プロパティ・メソッド        | 内容                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `on`                        | 配置先の画面種別（`tag` または `project`）                                                       |
| `name`                      | タグ名またはプロジェクト名                                                                       |
| `id`                        | カードの ID。同じ種類のカードを複数配置した際の識別に使える                                      |
| `value`・`setValue(value?)` | カードに保存された JSON 値の取得・更新。引数なしで呼ぶと削除される。カード削除時にも消去される   |
| `editing`・`onEditing(fn)`  | 「概要を編集」モード中かどうか。`onEditing` は編集モードの開始・終了時に呼ばれる                 |
| `items()`                   | 画面に表示されている対象項目の一覧。タグ画面でサブタグ絞り込み中は絞り込み後の項目、プロジェクト画面ではサブフォルダ内を含む全項目 |
| `onChange(fn)`              | 対象項目またはカードの保存値が変更されたときに呼ばれる                                           |
| `open(id)`・`openTag(tag)`  | 項目やタグを開く。`{ newTab: true }` で新しいタブで開く                                          |
| `settings()` など           | プラグイン設定と保存データ（`Api` と同じ）                                                       |

`onEditing`・`onChange` は戻り値の関数でリスナーを解除する。

## スタイルと UI 要素

- アプリ本体の CSS 変数（`--ink`・`--muted`・`--card`・`--accent`・`--space-*`・`--fs-*` など）をそのまま利用できる。独自スタイルは `<style>` 要素を `el` 内に追加し、他の要素と衝突しないクラス名を付ける
- `mount`・`embed`・`screens`・`code`・`covers` の描画領域内では、標準の `button`・`input`・`select`・`textarea` にアプリ本体と統一されたスタイルが適用される（プラグイン側の CSS で上書き可能）
- `select` 要素をクリックするとアプリ本体のカスタムドロップダウンが開く。選択時は標準の `select` と同様に `value` が更新され、`input` イベントと `change` イベントが発火する
- `data-tip` 属性を付けた要素にはアプリ本体のツールチップが表示される
