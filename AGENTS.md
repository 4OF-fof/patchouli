# AGENTS.md

## 進め方

- 仕様や設計は勝手に決めない。選択肢を示して決めてもらう。
- テストは依頼されたときだけ書く。
- Storybook がすでに起動していたら別のポートで立ち上げずに使い回す。別のセッションが起動したもの（`preview_start` が「Port 6006 is in use」で失敗したとき）は、`preview_start` に `url: "http://localhost:6006"` を渡して開く。
- 実際の素材ライブラリには手を出さない。画面はサンプルデータ（`app/src/samples/`）で、ファイルを扱う動作は動作確認用ライブラリ（`example/dev-library/`）で確認する。

## サンプルと動作確認用ライブラリ

- 内容は `app/src/samples/spec.ts` の 1 か所で定義する。画面のサンプル（`library.ts`）と `example/dev-library/` はどちらもここから生成するため、内容を変えるときは `spec.ts` を編集する。
- `example/dev-library/` は `node scripts/dev-library.ts` で生成する（`ffmpeg`、Cargo の `wasm32-wasip2` ターゲット、`app` の `pnpm install` が必要）。再生成するたびに上書きされるため、直接編集しない。
- 負荷検証時は `node scripts/dev-library.ts --stress` で `example/stress-library/` に大規模ライブラリを生成し、`PATCHOULI_LIBRARY` で開く。内容は `spec.ts` の `stressSpec` で定義する。
- サンプルプラグインは `example/<名前>-plugin/` に配置し、使用するものを `spec.ts` の `EXAMPLE_PLUGINS` に記載する。スクリプトが SDK の CLI でビルドして `example/dev-plugins/` に出力し、ライブラリに記録する。開発中のアプリは既定でこのライブラリとプラグイン保存先を使用する。設定は `example/dev-settings.json` に保存する。
- 開発時のみ有効な環境変数：`PATCHOULI_LIBRARY`（開くライブラリ）、`PATCHOULI_PLUGIN_DIR`（プラグインの保存先）、`PATCHOULI_NO_COMMANDS`（`ffmpeg,magick` のように指定したコマンドを未検出扱いにする）、`PATCHOULI_EMBED_DIR`（AI 機能の `llama.cpp` とモデルの保存先。既定は `example/dev-embed/`）。リリースビルドには含めない。
- `spec.ts` は Node が直接実行するため、型以外の import は行わない。
- ライブラリの仕様が決まったり変更されたりしたら、`spec.ts` と生成スクリプトにも反映する。

## プラグインの SDK とテンプレート

- SDK（型定義・`definePlugin`・build / zip の CLI・WIT）の元ファイルは `app/plugins/sdk/` にある。編集したら `node scripts/plugin-template.ts` で別リポジトリのテンプレート（`../patchouli-plugin/patchouli-plugin-template/patchouli/`）にコピーする。コピー先は直接編集しない。
- npm には公開しない。外部のプラグイン作成者は SDK を同梱した [patchouli-plugin-template](https://github.com/4OF-fof/patchouli-plugin-template) をコピーして使用する。
- `plugin.json` の形式ごとの `parts` のうち、`script` に指定したものはアプリと同じ WebView で動作する TypeScript（スクリプト）、それ以外は権限を制限した WASM が処理する。スクリプト内から `api.wasm()` で WASM の同名機能を呼び出せる。`links`・`screens`・`covers` はスクリプト、`menu`・`hooks` は WASM が処理する。
- スクリプトはコア機能も外部プラグインも TypeScript で実装し、`@patchouli/plugin` から import する。`plugin.json` のトップレベルの `script` にはビルド後の `.js` のパスを指定する（ソースファイルは拡張子を `.ts` にしたもの）。
- コア機能のスクリプトは `build.rs` が CLI でビルドしてバイナリに埋め込む。スクリプトを持つコア機能は `build.rs` の `UI_PLUGINS` に記載する。

## ブランチとバージョン

- 作業は `dev` に直接コミットしてよい。`dev` は保護していない。
- `master` は PR 経由でのみ更新する。`master` への PR を出せるのは `dev` と `hotfix/*` のみで、マージはマージコミットに限定する（スカッシュやリベースはしない）。
- バージョンは `app/package.json` の `version` で一元管理し、デスクトップと Web で共通とする。hotfix 時もパッチバージョンを上げる。
- `master` への PR では `version` を `master` より上げておく。上がっていないと CI の `version` ジョブが失敗する。
- タグは `master` にマージされた際に CI が `vX.Y.Z` を自動で作成するため、手動では作成しない。`v*` タグの削除・書き換えは不可。
- hotfix を `master` にマージしたら、`master` を `dev` にマージし直す。
- ブランチ保護ルールは `.github/rulesets/*.json` に配置している。

## コミット

- メッセージは日本語で、変更内容のみを書く。「戻す」「退避から復元」など作業の経緯は書かない。
- 1 行目は簡潔に書く。変更点が多い場合は本文に箇条書きで記載する。

## コードの規約

- CSS は CSS Modules（`Name.module.css`）で記述する。グローバル CSS にしてよいのは `src/index.css` と `src/styles/tokens.css` のみ。
- コンポーネントをまたぐスタイル調整は `class` プロパティの受け渡しか CSS 変数で行う。他のコンポーネントのクラス名を外部から直接指定しない。
- 特別な意図があって一般的でない実装を行っており、補足が必要な場合を除いてコメントは書かない。
