# スクリプト（TypeScript）

スクリプトはアプリの画面と同じ WebView で動く ES モジュールで、`@patchouli/plugin` から読む。型と窓口の説明は SDK の `index.ts` にある。

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

- 型の引数の `methods` に WASM の `call` で呼べるもの、`settings` に設定の key と値の型を書くと、`api.call` と `api.settings()` に型が付く
- `api.call(method, args?)` は `args` を JSON にして WASM の `call` に渡し、返した文字列を JSON として読む（空なら `undefined`）

## 書き出すもの

`default` に、受け持つもの（plugin.json の `formats` の `script`・`links`・`screens`）の分だけ書く。

| 関数               | 受け持つもの | 返すもの                                                                          |
| ------------------ | ------------ | --------------------------------------------------------------------------------- |
| `mount(el, api)`   | `view`       | 閉じるときに呼ぶ関数                                                              |
| `thumbnail(api)`   | `thumbnail`  | `{ png, width?, height? }` か `null`。`width`・`height` は素材そのものの大きさ    |
| `thumbnailTimeout` | `thumbnail`  | 待つ長さ（ms）。既定は 10 秒、長くても 30 秒                                      |
| `hover(el, api)`   | `hover`      | カーソルが離れたときに呼ぶ関数                                                    |
| `embed(el, api)`   | `embed`      | 埋め込みが消えるときに呼ぶ関数                                                    |
| `details(api)`     | `details`    | `{ label, value }` の並び                                                         |
| `excerpt(api)`     | `excerpt`    | `{ start?, end?, images? / audio? / text? }` の並び。`api.budget` を超えない      |
| `links`            | `links`      | `thumbnail`・`mount`・`details`・`excerpt`・`hover`・`embed` を持つもの           |
| `screens`          | `screens`    | 画面の ID → `{ mount(el, api) }`                                                  |

- `hover` はカーソルを合わせているカード 1 枚にだけ描くので、動画の再生や音を出すこともできる
- `embed` の `el` の幅は本文の幅で、高さは描いたものに合わせて決まる
- `excerpt` の `api.signal` は、時間の上限を過ぎたときなどに中止になる

## 窓口

素材 1 つの窓口（`Api`）は、`mount`・`thumbnail`・`hover`・`embed`・`details`・`excerpt` に渡る。

| 窓口                         | 中身                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| `item`                       | `{ id, name, ext, url? }`。`url` は中身の URL で、`fetch` や `img`・`video` の `src` に使える |
| `read(offset, length)`       | 中身を `Uint8Array` で読む。一度に 16 MB まで                                                 |
| `call(method, args?)`        | 自分の WASM の `call`                                                                         |
| `plugin(id).call(...)`       | `required`・`optional` の `plugins` に書いたプラグインの WASM の `call`                       |
| `settings()`・`setSetting()` | 自分の設定                                                                                    |
| `getData()`・`setData()`     | ライブラリごとに残す値（WASM の `get-data`・`set-data` と同じもの）                           |
| `wasm()`                     | WASM の同じもの（`thumbnail`・`details`・`excerpt`）を呼ぶ                                    |

`excerpt` の `api.wasm()` が返すのは区間の位置と種類だけで、中身は本体が持つ。本体はそれを `excerpt` が返す区間に足すので、返し直さない。

### links

`links` の関数には、URL の窓口（`LinkApi`）が渡る。

| 窓口                | 中身                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `url`               | 受け持つ URL                                                                                                     |
| `fetch(url)`        | アプリが代わりに取りに行き、`{ status, url, type?, body }` を返す。CORS に縛られない。plugin.json の `fetch` に書いたホスト名だけ、一度に 16 MB まで |
| `edge`              | `thumbnail` で、長いほうの辺の上限（px）                                                                         |
| `budget`・`signal`  | `excerpt` で、`Api` と同じもの                                                                                   |
| `settings()` など   | 自分の設定と残す値。`Api` と同じもの                                                                             |

`embed` は、ショートカットを埋め込んだときと、ノートに URL を埋め込んだときの両方に使う。

### screens

画面の `mount(el, api)` の `el` は画面いっぱいの大きさで、はみ出す分は送れる。

| 窓口                                                         | 中身                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `targets()`                                                  | 右クリックメニューから開いたときに選んでいたもの。ほかから開いたときは空 |
| `items()`・`item(id)`                                        | ライブラリの項目                                                         |
| `onChange(fn)`                                               | 項目が増えたり、変わったり、なくなったりしたら呼ぶ。返した関数で止める   |
| `open(id)`・`openTag(tag)`・`openProject(name)`              | 本体で開く。`{ newTab: true }` で新しいタブに開く                        |
| `createNote({ name?, body?, project? })`                     | ノートを作る。同じ名前があれば後ろに番号を付ける                         |
| `setBody(id, body)`・`setTags(id, tags)`・`rename(id, name)` | 書き換える。保存できなかったときは、本体が通知を出して読み込み直す       |
| `settings()` など                                            | 自分の設定と残す値。`Api` と同じもの                                     |

ノートの本文では、ほかの項目へのリンクを `[名前](patchouli:<id>)`、埋め込みを `![名前](patchouli:<id>)` と書く。

## 描くとき

- 本体の CSS 変数（`--ink`・`--muted`・`--card`・`--accent`・`--space-*`・`--fs-*` など）を使える。CSS は `<style>` を `el` の中に入れ、ほかとぶつからないクラス名にする
- `mount`・`embed`・`screens` の中では、`button`・`input`・`select`・`textarea` に本体と同じ見た目が付く。プラグインの CSS で上書きできる
- `select` は、押すと本体と同じ一覧を出す。選んだあとは素の `select` と同じく `value` が変わり、`input` と `change` が届く
- `data-tip` を付けた要素には、その文言で本体のツールチップが出る
