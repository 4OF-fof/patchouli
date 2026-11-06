# プラグイン

プラグインで次の機能を追加できる。

- アプリ標準では非対応のファイル形式や URL のサムネイル生成・表示
- 右クリックメニューの項目
- 項目の取り込み時・内容変更時・名前やタグや所属の変更時の自動処理（フック）
- ホームや「すべて」と並ぶカスタム画面
- ノートのコードブロックの描画と `/` メニューの項目
- タグやプロジェクトの概要欄のカード

| リファレンス               | 内容                                |
| -------------------------- | ----------------------------------- |
| [manifest.md](manifest.md) | `plugin.json` の仕様                |
| [wasm.md](wasm.md)         | WASM のロールとホスト関数           |
| [script.md](script.md)     | スクリプト（TypeScript）の API 仕様 |

## WASM とスクリプト

プラグインは WASM とスクリプトの 2 つで構成され、どちらか一方のみでも動作する。

| 構成要素   | 実装言語              | 実行環境                     | 対象                                                                                                  | 主な機能                                                                                                        |
| ---------- | --------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| WASM       | Rust（`plugin.wasm`） | サンドボックス化された WASM  | `formats` の `parts`、`notes` の `code`、`menu`、`hooks`                                              | アプリから渡されたファイルの読み取り、`fetch` に指定したホストへの GET、`permissions` に指定した関数の呼び出し |
| スクリプト | TypeScript（`ui.js`） | アプリ本体と同じ WebView     | `formats` の `parts` と `notes` の `code` のうち `script` に指定したもの、`links`、`screens`、`covers` | DOM への描画、`api.call` による WASM の呼び出し、`fetch` に指定したホストへの GET                              |

権限を制限できるのは WASM のみで、`permissions` の指定も WASM にのみ適用される。スクリプトはアプリ本体と同じ権限で動作し、プラグイン一覧には「フルアクセス」と表示される。スクリプトにおける `fetch` の対象ホスト制限は `api.fetch` を使った通信にのみ適用される。また WASM から `commands` 経由で実行する外部コマンドもアプリ本体と同じ権限で動作する。

スクリプトからは `api.wasm()` で同一プラグインの WASM 関数を呼び出せる。重い処理やバイナリのデコードは WASM で実装し、画面の描画はスクリプトで実装するとよい。

## 作成手順

1. `plugin-template/` をコピーする。テンプレート内の `patchouli/` は SDK（型定義・CLI・WIT）のため編集しない。
2. 必要なツールをインストールする。
   - Node 22.18 以上（TypeScript 製の CLI を直接実行するために使用）
   - Rust と `rustup target add wasm32-wasip2`（WASM をビルドする場合）
3. `plugin.json` に ID・名前・バージョンと対象機能を設定する（[manifest.md](manifest.md)）。
4. WASM は `src/lib.rs`（[wasm.md](wasm.md)）、スクリプトは `ui.ts`（[script.md](script.md)）に実装する。不要な側は削除し、スクリプトを使用しない場合は `plugin.json` の `script` も削除する。
5. ビルドする。

   ```bash
   npm install
   npm run build
   ```

   - `dist/` に配布・読み込み用のファイル（`plugin.json`・`plugin.wasm`・`ui.js`）が出力される
   - `plugin.wasm` は `Cargo.toml` がある場合に `cargo build --release --target wasm32-wasip2` でビルドされる
   - `ui.js` は `plugin.json` の `script` の拡張子を `.ts` に置き換えたファイルを esbuild で単一の ES モジュールにバンドルしたもの。`@patchouli/plugin` は SDK に解決される

6. アプリで動作確認する。設定の「開発者モード」を有効にし、次のいずれかを登録して「再読み込み」を押す。
   - 開発用プラグインのフォルダ：プラグインの親フォルダを登録する。直下のサブフォルダのうち `plugin.json` があるもの（`dist/` など）が読み込まれる
   - プラグインのリポジトリ：プラグインのフォルダを登録する。`npm run zip` で作成した `<id>-<version>.zip` が読み込まれる
7. パッケージを作成する。

   ```bash
   npm run zip
   ```

   - `<id>-<version>.zip` が出力される。アプリの「プラグイン」画面の「プラグインを追加」から選択してインストールできる
   - GitHub Releases に ZIP ファイルを添付すると「プラグインを追加」にリポジトリ URL を入力してインストールできる。リリースの ZIP ファイルが 1 つならそのファイル、複数ある場合は `<id>-<version>.zip` の名前のファイルが使用される。リリースタグは `v<version>` とする

## インストールと更新

- プラグインの実体はアプリデータフォルダ内の `plugins/` 下にライブラリごとに保存される。ライブラリ側の `.patchouli/library.json` の `plugins` にはバージョン・取得元・ハッシュ・GitHub のリリースタグのみが記録される
- インストール前には使用する権限・外部ツール・接続先ホスト・スクリプトの有無を確認ダイアログに表示する。更新時は以前のバージョンから権限が増えた場合のみ確認ダイアログを表示する
- GitHub からインストールしたプラグインは一覧の「更新を確認」で最新リリースを確認できる。記録されたタグより新しいリリースがあれば「`<タグ>` に更新」ボタンが表示される。プレリリースを含めるかはプラグインごとに切り替えられる（既定はオフ）
- ライブラリに記録があるものの端末にインストールされていない場合は、記録されたバージョンと最新リリースのどちらをインストールするか選択できる。記録されたバージョンをインストールする際はハッシュも検証される

ビルド用 CLI の実体は SDK の `cli.ts` であり、`npm run build` / `npm run zip` から呼び出される。

```bash
node patchouli/cli.ts build [フォルダ] [--out <dir>] [--no-wasm]
node patchouli/cli.ts zip [フォルダ] [--out <file>]
```

## サンプルプラグイン

`example/` にサンプルプラグインがある。`node scripts/dev-library.ts` を実行すると SDK の CLI でビルドされ、開発用ライブラリに導入される（`example_youtube` はコア機能と重複するため除外される）。

| サンプル                                                   | 機能                                                       | 主な使用 API                                                |
| ---------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------- |
| [example_psd](../../example/example_psd-plugin/)           | PSD のサムネイル生成・詳細表示・ファイル詳細の取得         | WASM の `thumbnail`・`view`・`details`                      |
| [example_zip](../../example/example_zip-plugin/)           | ZIP のサムネイル生成と中身をフォルダツリーで表示する詳細画面 | WASM の `thumbnail`・`call`、スクリプトの `mount`           |
| [example_youtube](../../example/example_youtube-plugin/)   | YouTube URL のサムネイルとプレーヤー表示                   | `links`、`fetch`                                            |
| [example_collect](../../example/example_collect-plugin/)   | 選択した項目をまとめたノートを作成するメニュー             | `menu`、`library`・`notes`                                  |
| [example_graph](../../example/example_graph-plugin/)       | ノート間のリンク関係図を開くメニュー                       | `menu` の結果の `screen`、`screens`（`place: false`）       |
| [example_page](../../example/example_page-plugin/)         | ノートをカード形式で一覧表示する画面                       | `screens`                                                   |
| [example_autolink](../../example/example_autolink-plugin/) | `.md` の取り込み時・編集時に内容の近いノートへ自動リンク   | `hooks` の `added`・`changed`、`library`・`notes`・`embed`  |
| [example_chart](../../example/example_chart-plugin/)       | ノートの棒グラフとカウンター表のコードブロック             | `notes`、WASM の `render`、スクリプトの `code`・`setSource` |
| [example_cover](../../example/example_cover-plugin/)       | タグ・プロジェクト概要欄の目標件数カードと月別件数カード   | `covers`、スクリプトの `setValue`・`onEditing`              |

コア機能（`app/plugins/`）も同じ仕組みで実装されている。スクリプトの `thumbnail`・`excerpt` と `api.wasm()` は `video`、`links` は `youtube`、スクリプトの `code` は `mermaid` で使用している。`math` のコードブロックと `$…$`・`$$…$$` の数式描画はアプリ本体が処理する。
