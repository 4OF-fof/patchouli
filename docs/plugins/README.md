# プラグイン

プラグインは次のものを足す。

- アプリが読めない形式や URL のサムネイルと表示
- 右クリックメニューの項目
- 取り込んだとき・中身が変わったとき・名前やタグや置き場を変えたときの処理（フック）
- ホームやすべてと並ぶ画面

| リファレンス               | 中身                                 |
| -------------------------- | ------------------------------------ |
| [manifest.md](manifest.md) | plugin.json                          |
| [wasm.md](wasm.md)         | WASM の役割と、ホストの関数          |
| [script.md](script.md)     | スクリプト（TypeScript）の書き方と窓口 |

## WASM とスクリプト

プラグインは 2 つの部分でできていて、どちらか一方だけでもよい。

| 部分       | 書くもの                | 動く場所                   | 受け持つもの                                       | できること                                                                                           |
| ---------- | ----------------------- | -------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| WASM       | Rust（`plugin.wasm`）   | 権限を絞った WASM          | `formats` の `parts`、`menu`、`hooks`              | アプリが渡したファイルを読む。`fetch` に書いたホストへ GET する。`permissions` に書いた関数を呼べる |
| スクリプト | TypeScript（`ui.js`）   | アプリの画面と同じ WebView | `formats` の `parts` のうち `script` に書いたもの、`links`、`screens` | DOM に描く。WASM を `api.call` で呼ぶ。`fetch` に書いたホストへ取りに行ける                          |

権限を絞れるのは WASM だけで、`permissions` も WASM にだけ効く。スクリプトはアプリと同じ権限で動き、プラグインの一覧にも「フルアクセス」と出る。`fetch` の制限は、スクリプトでは `api.fetch` を使うときの約束にとどまる。WASM から `commands` で動かすコマンドもアプリと同じ権限で動くので、どのファイルも読み書きでき、ネットワークも使える。

スクリプトの中からは `api.wasm()` で WASM の同じものを呼べる。重い処理やファイルの中身を解くところは WASM に、描くところはスクリプトに置くとよい。

## 作り方

1. `plugin-template/` を丸ごと写す。中の `patchouli/` は SDK（型・CLI・WIT）なので書き換えない。
2. 要るものを入れる。
   - Node 22.18 以上（CLI を TypeScript のまま動かす）
   - Rust と `rustup target add wasm32-wasip2`（WASM を書くとき）
3. `plugin.json` に、id・名前・版と受け持つものを書く（[manifest.md](manifest.md)）。
4. WASM は `src/lib.rs`（[wasm.md](wasm.md)）、スクリプトは `ui.ts`（[script.md](script.md)）に書く。いらないほうは消し、スクリプトを消したら plugin.json の `script` も消す。
5. ビルドする。

   ```bash
   npm install
   npm run build
   ```

   - `dist/` に、アプリに入れられる形（`plugin.json`・`plugin.wasm`・`ui.js`）ができる
   - `plugin.wasm` は `Cargo.toml` があるときだけ、`cargo build --release --target wasm32-wasip2` で作る
   - `ui.js` は、plugin.json の `script` の拡張子を `.ts` にしたものを esbuild で 1 つの ES モジュールにまとめたもの。`@patchouli/plugin` は SDK を指す

6. アプリで試す。設定の「開発者モード」を有効にして、どちらかを登録し、「再読み込み」を押す。
   - 開発用プラグインのフォルダ：プラグインのフォルダを登録する。中のフォルダのうち plugin.json のあるもの（`dist/`）を読む
   - プラグインのリポジトリ：プラグインのフォルダを登録する。`npm run zip` で作った `<id>-<版>.zip` を読む
7. 配る。

   ```bash
   npm run zip
   ```

   - `<id>-<版>.zip` ができる。アプリの「プラグイン」の「プラグインを追加」で選ぶ
   - GitHub のリリースに付けると、「プラグインを追加」にリポジトリの URL を入れて入れられる。リリースの zip が 1 つならそれを、いくつもあれば `<id>-<版>.zip` の形のものを使う。タグは `v<版>` にする

## インストールと更新

- プラグインの本体は、アプリのデータフォルダの `plugins/` の下に、ライブラリごとに置く。ライブラリには入れず、`.patchouli/library.json` の `plugins` に、版・取得先・ハッシュ・GitHub のタグを記録する
- 入れる前に、使う権限・外部ツール・接続先と、本体と同じ権限で動くか（スクリプト）を見せて確かめる。更新のときは、前の版より増えたときだけ確かめる
- GitHub から入れたものは、一覧の「更新を確認」で最新のリリースを調べる。記録したタグと違えば、「<タグ> に更新」のボタンに変わる。プラグインごとに、プレリリースも対象にするかを切り替えられる（初期値はオフ）
- ライブラリの記録はあるのに本体がないときは、記録したタグと最新のリリースのどちらを入れるかを選べる。記録したタグを入れるときは、ハッシュも確かめる

CLI は SDK の `cli.ts` で、npm のスクリプトはこれを呼んでいる。

```bash
node patchouli/cli.ts build [フォルダ] [--out <dir>] [--no-wasm]
node patchouli/cli.ts zip [フォルダ] [--out <file>]
```

## 例のプラグイン

`example/` にある。`node scripts/dev-library.ts` が SDK の CLI でビルドし、開発中のアプリに入れる（example_youtube は入れない）。

| 例                                                         | 受け持つもの                                          | 主に使っているもの                                         |
| ---------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------- |
| [example_psd](../../example/example_psd-plugin/)           | PSD のサムネイル・詳細の表示・ファイルの詳細          | WASM の `thumbnail`・`view`・`details`                     |
| [example_zip](../../example/example_zip-plugin/)           | zip のサムネイルと、中身をフォルダの木で見せる詳細    | WASM の `thumbnail`・`call`、スクリプトの `mount`          |
| [example_youtube](../../example/example_youtube-plugin/)   | YouTube の URL                                        | `links`、`fetch`                                           |
| [example_collect](../../example/example_collect-plugin/)   | 選んだものをまとめたノートを作るメニュー              | `menu`、`library`・`notes`                                 |
| [example_graph](../../example/example_graph-plugin/)       | ページの関係図を開くメニュー                          | `menu` の結果の `screen`、`screens`（`place: false`）      |
| [example_page](../../example/example_page-plugin/)         | ノートをカードで並べる画面                            | `screens`                                                  |
| [example_autolink](../../example/example_autolink-plugin/) | md を取り込んだときと書き換えたときに、リンクを付ける | `hooks` の `added`・`changed`、`library`・`notes`・`embed` |

組み込みのプラグイン（`app/plugins/`）も同じ形で書いてある。スクリプトの `thumbnail`・`excerpt` と `api.wasm()` は video、`links` は youtube が使っている。
