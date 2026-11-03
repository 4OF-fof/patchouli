# elevated（TypeScript）

elevated はアプリの画面と同じ WebView で動く ES モジュールで、`@patchouli/plugin` から読む。型と窓口の説明は SDK の `index.ts` にある。

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

`default` に、受け持つもの（plugin.json の `formats` の `elevated`・`links`・`screens`・`menu`）の分だけ書く。

| 関数                     | 受け持つもの                       | 返すもの                                                                         |
| ------------------------ | ---------------------------------- | -------------------------------------------------------------------------------- |
| `mount(el, api)`         | `view`                             | 閉じるときに呼ぶ関数                                                             |
| `thumbnail(api)`         | `thumbnail`                        | `{ png, width?, height? }` か `null`。`width`・`height` は素材そのものの大きさ    |
| `thumbnailTimeout`       | `thumbnail`                        | 待つ長さ（ms）。既定は 10 秒、長くても 30 秒                                     |
| `hover(el, api)`         | `hover`                            | カーソルが離れたときに呼ぶ関数                                                   |
| `embed(el, api)`         | `embed`                            | 埋め込みが消えるときに呼ぶ関数                                                   |
| `waveform(api)`          | `waveform`                         | `api.points` 個の区間ごとの音の大きさ（二乗平均の平方根）か `null`               |
| `details(api)`           | `details`                          | `{ label, value }` の並び                                                        |
| `content(api)`           | `content`                          | `{ start?, end?, images? / audio? / text? }` の並び。`api.budget` を超えない     |
| `link(api)`              | `link`                             | ファイルが指す URL か `undefined`                                                |
| `menu(api)`              | `menu`（`by` が `elevated`）       | `{ id, label }` の並び                                                           |
| `runMenu(api)`           | 同じく項目が選ばれたとき           | 下の「メニューの結果」。文字列を返すと通知として出す                             |
| `links`                  | `links`                            | `thumbnail`・`mount`・`embed`・`details` を持つもの                              |
| `screens`                | `screens`                          | 画面の ID → `{ mount(el, api) }`                                                 |

- `hover` はカーソルを合わせているカード 1 枚にだけ描くので、動画の再生や音を出すこともできる
- `embed` の `el` の幅は本文の幅で、高さは描いたものに合わせて決まる
- `waveform` と `content` の `api.signal` は、時間の上限を過ぎたときなどに中止になる

## 窓口

素材 1 つの窓口（`Api`）は、`mount`・`thumbnail`・`hover`・`embed`・`waveform`・`details`・`content`・`link` に渡る。

| 窓口                         | 中身                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `item`                       | `{ id, name, ext, url? }`。`url` は中身の URL で、`fetch` や `img`・`video` の `src` に使える  |
| `read(offset, length)`       | 中身を `Uint8Array` で読む。一度に 16 MB まで                                                  |
| `call(method, args?)`        | 自分の WASM の `call`                                                                          |
| `plugin(id).call(...)`       | `required`・`optional` の `plugins` に書いたプラグインの WASM の `call`                         |
| `settings()`・`setSetting()` | 自分の設定                                                                                     |
| `getData()`・`setData()`     | ライブラリごとに残す値（WASM の `get-data`・`set-data` と同じもの）                            |
| `sandbox()`                  | sandbox の同じもの（`thumbnail`・`details`・`content`）を呼ぶ                                  |

`menu` と `runMenu` には、選んでいるものごとの窓口が `api.targets` に入る。`runMenu` の `api.id` は選ばれた項目で、`api.sandbox()` は WASM の `run-menu` を呼ぶ。

### メニューの結果

| 戻り値                                 | 出し方                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| `{ toast: text, level? }`              | 短い知らせ。`level` は下の重要度で、既定は `info`                                          |
| `{ overlay: { title?, rows } }`        | 見出しと値の行を画面に重ねる。値は行ごとにコピーできる                                     |
| `{ screen: { id, window? } }`          | `screens` の画面を開き、選んだものを渡す。`window` なら別のウィンドウで開く                |
| `{ save: { name, data } }`             | ライブラリの外へ書き出す。保存先はアプリが聞く。`data` が文字列なら UTF-8 で書く           |

| `level`   | 色     | 消え方               |
| --------- | ------ | -------------------- |
| `info`    | グレー | 4 秒で消える         |
| `success` | 緑     | 4 秒で消える         |
| `warning` | 黄土色 | 閉じるまで残る       |
| `error`   | 赤     | 閉じるまで残る       |

### links

`links` の関数には、URL の窓口（`LinkApi`）が渡る。

| 窓口                | 中身                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| `url`               | 受け持つ URL                                                                                            |
| `fetch(url)`        | アプリが代わりに取りに行く。CORS に縛られない。plugin.json の `fetch` に書いたホスト名だけ、一度に 16 MB まで |
| `edge`              | `thumbnail` で、長いほうの辺の上限（px）                                                               |

`embed` は、ショートカットを埋め込んだときと、ノートに URL を埋め込んだときの両方に使う。

### screens

画面の `mount(el, api)` の `el` は画面いっぱいの大きさで、はみ出す分は送れる。

| 窓口                                                   | 中身                                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------- |
| `targets()`                                            | 右クリックメニューから開いたときに選んでいたもの。ほかから開いたときは空   |
| `inWindow`                                             | 別のウィンドウで開いているか                                               |
| `items()`・`item(id)`                                  | ライブラリの項目                                                           |
| `onChange(fn)`                                         | 項目が増えたり、変わったり、なくなったりしたら呼ぶ。返した関数で止める     |
| `open(id)`・`openTag(tag)`・`openProject(name)`        | 本体で開く。`{ newTab: true }` で新しいタブに開く                          |
| `createNote({ name?, body?, project? })`               | ノートを作る。同じ名前があれば後ろに番号を付ける                           |
| `setBody(id, body)`・`setTags(id, tags)`・`rename(id, name)` | 書き換える。保存できなかったときは、本体が通知を出して読み込み直す   |

ノートの本文では、ほかの項目へのリンクを `[名前](patchouli:<id>)`、埋め込みを `![名前](patchouli:<id>)` と書く。

## 描くとき

- 本体の CSS 変数（`--ink`・`--muted`・`--card`・`--accent`・`--space-*`・`--fs-*` など）を使える。CSS は `<style>` を `el` の中に入れ、ほかとぶつからないクラス名にする
- `mount`・`embed`・`screens` の中では、`button`・`input`・`select`・`textarea` に本体と同じ見た目が付く。プラグインの CSS で上書きできる
- `select` は、押すと本体と同じ一覧を出す。選んだあとは素の `select` と同じく `value` が変わり、`input` と `change` が届く
- `data-tip` を付けた要素には、その文言で本体のツールチップが出る
