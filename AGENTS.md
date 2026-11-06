# AGENTS.md

## 進め方

- 仕様や設計は勝手に決めない。選択肢を示して、決めてもらう。
- テストは、頼まれたときだけ書く。
- Storybook がすでに動いていたら、別のポートで立ち上げずにそれを使い回す。ほかのチャットが起動したもの（`preview_start` が「Port 6006 is in use」で失敗したとき）は、`preview_start` に `url: "http://localhost:6006"` を渡して開く。
- 実際の素材ライブラリには手を出さない。画面は見本データ（`app/src/samples/`）で、ファイルを扱う動作は動作確認用のライブラリ（`example/dev-library/`）で確かめる。

## 見本と動作確認用のライブラリ

- 中身は `app/src/samples/spec.ts` の 1 か所で決める。画面の見本（`library.ts`）と `example/dev-library/` は、どちらもここから作る。中身を変えるときは `spec.ts` を直す。
- `example/dev-library/` は `node scripts/dev-library.ts` で作る（ffmpeg と、cargo の wasm32-wasip2、app の pnpm install が要る）。作り直すたびに消えるので、手で直さない。
- 負荷を調べるときは、`node scripts/dev-library.ts --stress` で `example/stress-library/` に大きなライブラリを作り、`PATCHOULI_LIBRARY` で開く。中身は `spec.ts` の `stressSpec` で決める。
- 例のプラグインは `example/<名前>-plugin/` に置き、使うものを `spec.ts` の `EXAMPLE_PLUGINS` に書く。スクリプトが SDK の CLI でビルドして `example/dev-plugins/` に入れ、ライブラリに記録する。開発中のアプリは、既定でこのライブラリとプラグインの置き場を使う。
- 開発中だけ効く環境変数: `PATCHOULI_LIBRARY`（開くライブラリ）、`PATCHOULI_PLUGIN_DIR`（プラグインの置き場）、`PATCHOULI_NO_COMMANDS`（「ffmpeg,magick」のように並べたコマンドを、見つからないことにする）、`PATCHOULI_EMBED_DIR`（自動分類の llama.cpp とモデルの置き場。既定は `example/dev-embed/`）。リリースビルドには残さない。
- `spec.ts` は Node がそのまま読むので、型のほかは import しない。
- ライブラリの形式が決まったり変わったりしたら、`spec.ts` とスクリプトにも反映する。

## プラグインの SDK とテンプレート

- SDK（型・`definePlugin`・build / zip の CLI・WIT）の正本は `app/plugins/sdk/`。直したら `node scripts/plugin-template.ts` で `plugin-template/patchouli/` に写す。写した側は手で直さない。
- npm には上げない。外部の作者には、SDK を同梱した `plugin-template/` を写して使ってもらう。
- plugin.json の形式ごとの `parts` のうち、`script` に書いたものは画面と同じ WebView で動く TypeScript（スクリプト）、ほかは権限を絞った WASM が受け持つ。スクリプトの中から `api.wasm()` で WASM の同じものを呼べる。`links`・`screens` はスクリプト、`menu`・`hooks` は WASM が受け持つ。
- スクリプトは、コア機能も外部のプラグインも TypeScript で書き、`@patchouli/plugin` から読む。plugin.json の上の階層の `script` はビルド後の `.js` のパスで、元は拡張子を `.ts` にしたもの。
- コア機能のスクリプトは、`build.rs` が CLI でビルドして埋め込む。スクリプトのあるものは `build.rs` の `UI_PLUGINS` に書く。

## ブランチと版

- 作業は dev に直接コミットしてよい。dev は保護していない。
- master は PR でしか更新しない。master への PR を出せるのは dev と `hotfix/*` だけで、マージはマージコミットに限る（スカッシュやリベースはしない）。
- 版は `app/package.json` の `version` 1 つで、デスクトップと web で共通に使う。hotfix のときも、パッチ版を上げる。
- master への PR では、`version` を master より上げておく。上がっていないと、CI の `version` で落ちる。
- タグは、master に入ったときに CI が `vX.Y.Z` で打つ。手では打たない。`v*` のタグは、消すことも書き換えることもできない。
- hotfix を master に入れたら、master を dev にマージし直す。
- 保護ルールは `.github/rulesets/*.json` に置いてある。

## コミット

- メッセージは日本語で、変更の中身だけを書く。「戻す」「退避から復元」など、作業の経緯は書かない。
- 1 行目は簡潔に。中身が多いときは、本文に箇条書きで足す。

## コードの決まり

- CSS は CSS Modules（`Name.module.css`）で書く。グローバルにしてよいのは `src/index.css` と `src/styles/tokens.css` だけ。
- 部品をまたぐ見た目は、`class` の受け渡しか CSS 変数で渡す。ほかの部品のクラス名を外から指定しない。
- 特別な意図があって一般的でない実装を行っており、補足が必要な場合を除いてコメントは書かない。
