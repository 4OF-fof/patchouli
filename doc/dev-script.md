# dev.ps1 / dev.sh の使い方

このプロジェクトには、開発用の統合スクリプトとして `dev.ps1`（Windows PowerShell用）と `dev.sh`（Unix系シェル用）が用意されています。

## 共通の機能

- 依存パッケージの一括インストール
- 各サブプロジェクト（frontend, mcp, discord, core）のビルド・開発サーバー・バックエンドの並列起動
- 終了コマンドによる全プロセスの停止

---

## dev.ps1（Windows PowerShell用）

### 依存関係のインストール
```powershell
./dev.ps1 install
```
- frontend, mcp, discord ディレクトリで `pnpm install` を自動実行します。

### 開発サーバー・バックエンドの起動
```powershell
./dev.ps1
```
- mcp: `pnpm build` でビルド
- frontend: `pnpm dev` で開発サーバーをバックグラウンド起動
- core: `cargo run` でRustバックエンドをバックグラウンド起動
- discord: `pnpm dev` でBotをバックグラウンド起動
- すべてのプロセスの標準出力・エラーは一時ファイル（%TEMP%）にリダイレクトされます
- `q` または `exit` 入力で全プロセスを停止

---

## dev.sh（Unix系シェル用）

### 依存関係のインストール
```sh
./dev.sh install
```
- frontend, mcp, discord ディレクトリで `pnpm install` を自動実行します。

### 開発サーバー・バックエンドの起動
```sh
./dev.sh
```
- mcp: `pnpm build` でビルド
- frontend: `pnpm dev` で開発サーバーをバックグラウンド起動（ログは /tmp）
- core: `cargo run` でRustバックエンドをバックグラウンド起動（ログは /tmp）
- discord: `pnpm dev` でBotをバックグラウンド起動（ログは /tmp）
- `q` または `exit` 入力で全プロセスを停止

---

## 注意事項
- 事前に Node.js, pnpm, Rust のインストールが必要です。
- 各サブプロジェクトのREADMEも参照してください。
