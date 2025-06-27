# Patchouli Discord Bot

Patchouliナレッジベースと連携するDiscord Botです。OAuth認証を使用してPatchouliサーバーにアクセスし、保護されたコンテンツを取得できます。

## 機能

- **認証**: Patchouliサーバーでの OAuth認証
- **コンテンツ取得**: 認証後の保護されたコンテンツへのアクセス
- **状態確認**: Patchouliサーバーのヘルスチェック
- **セッション管理**: ユーザーごとの認証状態管理

## セットアップ

### 前提条件

- Node.js 18以上
- pnpm
- Discord開発者アカウント
- 実行中のPatchouli core server

### Discord Bot作成

1. [Discord Developer Portal](https://discord.com/developers/applications)にアクセス
2. 新しいアプリケーションを作成
3. Botセクションでbotを作成し、TOKENを取得
4. OAuth2セクションでSCOPESに`bot`と`applications.commands`を選択
5. Bot PermissionsでRead Messages/View Channels、Send Messages、Use Slash Commandsを選択
6. Generated URLを使用してbotをサーバーに招待

### 環境変数設定

`.env`ファイルを作成:

```env
DISCORD_BOT_TOKEN=your_discord_bot_token_here
DISCORD_CLIENT_ID=your_discord_client_id_here
```

### インストールと実行

```bash
# 依存関係のインストール
pnpm install

# 開発環境での実行
pnpm dev

# プロダクション用ビルド
pnpm build
pnpm start
```

## 使用方法

### 利用可能なコマンド

| コマンド | 説明 |
|---------|------|
| `/authenticate` | Patchouliサーバーでの認証を開始 |
| `/checkauth` | 認証状態を確認 |
| `/getcontent` | 保護されたコンテンツを取得 |
| `/status` | Patchouliサーバーの状態確認 |
| `/logout` | 認証をクリア |

### 認証フロー

1. `/authenticate` コマンドを実行
2. Botが認証URLを提供
3. ユーザーがブラウザで認証URLにアクセス
4. OAuth認証を完了
5. `/checkauth` コマンドで認証完了を確認
6. `/getcontent` コマンドで保護されたコンテンツにアクセス

## アーキテクチャ

Discord BotはPatchouli core serverのクライアントとして動作します：

```
Discord User
    ↓ (slash commands)
Discord Bot
    ↓ (HTTP API)
Patchouli Core Server
    ↓ (OAuth)
Google OAuth 2.0
```

### 主要コンポーネント

- **`src/index.ts`**: Botのメインエントリーポイント
- **`src/commands.ts`**: スラッシュコマンドの定義と実装
- **`src/client.ts`**: Patchouli core serverとの通信

### セッション管理

- メモリ内でユーザーのセッションIDを管理
- 認証待ち状態の追跡
- プロダクション環境では永続化ストレージの使用を推奨

## セキュリティ考慮事項

- 認証トークンとセッションIDは適切に管理
- Discord メッセージは一時的(ephemeral)に設定
- 機密情報のログ出力を避ける

## トラブルシューティング

### よくあるエラー

1. **"Patchouli core server is not accessible"**
   - Patchouli core serverが起動していることを確認
   - `http://localhost:8080` でアクセス可能か確認

2. **"Authentication failed"**
   - 認証URLが正しいことを確認
   - ブラウザでOAuth認証を完了しているか確認

3. **"Invalid or expired session ID"**
   - `/logout` してから再度 `/authenticate` を実行

## 開発

### 依存関係

- **discord.js**: Discord API wrapper
- **axios**: HTTP client for Patchouli API
- **TypeScript**: Type safety

### テスト

```bash
pnpm test
```

### 本番環境での実行

環境変数を設定し、プロセス管理ツール（PM2など）を使用することを推奨します。

```bash
# PM2を使用した例
pm2 start dist/index.js --name patchouli-discord-bot
```