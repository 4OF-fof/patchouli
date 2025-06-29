# API Migration Guide: Session-based to RESTful JWT

## 概要

Patchouliは、セッションベースの認証からJWTベースのRESTful APIに移行しました。このガイドでは、各コンポーネントで必要な変更を説明します。

## 主な変更点

### 1. 認証システム

#### 旧システム (Session-based)
- セッションIDによる状態管理
- サーバー側でセッション情報を保持
- `session_id` パラメータでの認証

#### 新システム (JWT-based)
- ステートレスなJWTトークン
- クライアント側でトークン管理
- `Authorization: Bearer <token>` ヘッダーでの認証

### 2. エンドポイントの変更

| 機能 | 旧エンドポイント | 新エンドポイント |
|------|----------------|------------------|
| 認証開始 | `GET /login` | `POST /auth/tokens` |
| 認証コールバック | `GET /callback` | `GET /oauth/callback` |
| ログアウト | `GET /logout?session_id=...` | `DELETE /auth/tokens` |
| 保護コンテンツ | `GET /protected?session_id=...` | `GET /content` |
| ユーザー一覧 | `GET /admin/users?session_id=...` | `GET /users` |
| ユーザー削除 | `DELETE /admin/users/:id?session_id=...` | `DELETE /users/:id` |
| 招待作成 | `GET /invite/create?session_id=...` | `POST /invites` |
| 招待一覧 | `GET /invite/list?session_id=...` | `GET /invites` |
| システム状態 | `GET /root/exists` | `GET /system/status` |

### 3. レスポンス形式の統一

#### 旧システム
- HTMLページとJSONが混在
- エンドポイントによって異なる形式

#### 新システム
- 全てのエンドポイントでJSON形式
- 統一されたエラーレスポンス形式

## コンポーネント別移行ガイド

### Frontend (React)

#### API クライアント (`src/services/api.ts`)
- JWTトークンの自動インクルード
- localStorage でのトークン管理
- RESTful エンドポイントの使用

#### 認証コンテキスト (`src/context/AuthContext.tsx`)
- セッションIDからJWTトークンとユーザー情報に変更
- トークン有効性の検証
- ログアウト時のサーバー通知

#### コンポーネントの変更
- `LoginPage`: OAuth フロー開始の新しいAPI使用
- `CallbackPage`: OAuth コードをJWTトークンに交換
- `Dashboard`: JWT認証での各機能の使用

### MCP Server

#### クライアント (`src/client.ts`)
- JWTトークンでの認証
- RESTful API エンドポイントの使用
- OAuth フロー対応

#### MCP ツール (`src/index.ts`)
- 新しい認証フロー用ツール追加
- JWT トークン管理機能
- システム状態確認機能

### Core Server (Rust)

#### 認証システム
- JWT トークン生成と検証
- ミドルウェアベースの認証
- OAuth2 との統合

#### エンドポイント設計
- リソース指向URL構造
- 適切なHTTPメソッド使用
- 統一されたJSON レスポンス

## 移行手順

### 1. 開発環境の準備

```bash
# 新しい依存関係の追加 (既に完了)
cd core
cargo build

cd ../frontend
pnpm install
pnpm build

cd ../mcp
pnpm install
pnpm build
```

### 2. 環境変数の設定

```bash
# .env ファイルに追加
JWT_SECRET=your-jwt-secret-key
```

### 3. クライアントコードの更新

#### Frontend
- API呼び出し時の `session_id` パラメータを削除
- `Authorization` ヘッダーの自動設定
- 新しいエンドポイントURL に変更

#### MCP
- `authenticate` ツールの新しいフロー使用
- `exchange_code_for_token` または `set_jwt_token` でトークン設定
- その他ツールはトークン自動使用

### 4. テスト手順

1. **サーバー起動**
   ```bash
   cd core
   cargo run
   ```

2. **フロントエンド起動**
   ```bash
   cd frontend
   pnpm dev
   ```

3. **認証フローテスト**
   - ブラウザでログインページアクセス
   - Google OAuth 認証完了
   - ダッシュボード機能確認

4. **MCP テスト**
   ```bash
   cd mcp
   pnpm start
   # Claude Desktop で MCP サーバー接続テスト
   ```

## トラブルシューティング

### よくある問題

1. **JWT トークンが無効**
   - トークンの有効期限確認 (24時間)
   - JWT_SECRET の整合性確認
   - ログアウト後の再認証

2. **CORS エラー**
   - フロントエンドとサーバーのURL確認
   - 開発環境でのプロキシ設定

3. **OAuth リダイレクト失敗**
   - REDIRECT_URL の設定確認
   - Google OAuth 設定確認

### ログの確認

```bash
# サーバーログ
cd core
RUST_LOG=info cargo run

# ブラウザコンソール
# Network タブでAPI リクエスト確認

# MCP ログ
cd mcp
# Claude Desktop の MCP ログ確認
```

## 後方互換性について

この移行により、旧APIとの後方互換性は**維持されません**。全てのクライアントアプリケーションは新しいRESTful APIに対応する必要があります。

## セキュリティの向上

### JWTの利点
- ステートレス設計によるスケーラビリティ向上
- トークン内のクレーム情報による効率化
- 有効期限による自動セキュリティ

### セキュリティ考慮事項
- JWT シークレットの適切な管理
- トークン有効期限の設定 (現在24時間)
- HTTPS での通信 (本番環境)

## 今後の拡張

RESTful 設計により、以下の機能拡張が容易になります：

- API バージョニング
- レート制限
- 詳細な権限管理
- 外部システムとの統合
- モバイルアプリ対応

この移行により、Patchouliはより現代的で拡張性の高いAPIアーキテクチャを提供します。