# Patchouli RESTful API Documentation

## 概要

PatchouliサーバーはRESTfulなAPI設計に準拠したHTTP APIを提供します。このドキュメントでは、利用可能なエンドポイントとその使用方法について説明します。

## 認証

APIはJWT（JSON Web Token）ベースの認証を使用します。認証が必要なエンドポイントでは、リクエストヘッダーに以下の形式でトークンを含める必要があります：

```
Authorization: Bearer <JWT_TOKEN>
```

## ベースURL

```
http://localhost:8080
```

## エンドポイント一覧

### 認証エンドポイント

#### POST /auth/tokens
認証トークンを作成します。

**Request Body:**
```json
{
  "grant_type": "client_credentials"
}
```

**Response (200 OK):**
```json
{
  "token": "uuid-token",
  "auth_url": "https://accounts.google.com/o/oauth2/auth?..."
}
```

**Example:**
```bash
curl -X POST http://localhost:8080/auth/tokens \
  -H "Content-Type: application/json" \
  -d '{"grant_type": "client_credentials"}'
```

#### DELETE /auth/tokens
認証トークンを無効化します（ログアウト）。

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Token invalidated"
}
```

#### GET /oauth/callback
OAuth認証のコールバックエンドポイント。通常はブラウザ経由でアクセスされます。

### ユーザー管理エンドポイント

#### GET /users
全ユーザーを取得します（rootユーザーのみ）。

**認証:** 必須
**権限:** rootユーザーのみ

**Response (200 OK):**
```json
[
  {
    "id": 1,
    "email": "user@example.com",
    "name": "User Name",
    "google_id": "google_user_id",
    "is_root": true,
    "can_invite": true,
    "created_at": "2024-01-01T00:00:00Z",
    "last_login": "2024-01-01T12:00:00Z"
  }
]
```

#### POST /users
新しいユーザーを作成します。

**Request Body:**
```json
{
  "email": "user@example.com",
  "name": "User Name",
  "invite_code": "optional-invite-code"
}
```

**Response (201 Created):**
```json
{
  "id": 1,
  "email": "user@example.com",
  "name": "User Name",
  "google_id": "temp_google_id",
  "is_root": false,
  "can_invite": false,
  "created_at": "2024-01-01T00:00:00Z",
  "last_login": null
}
```

#### GET /users/:id
特定のユーザー情報を取得します。

**認証:** 必須
**権限:** 自分の情報またはrootユーザー

**Response (200 OK):**
```json
{
  "id": 1,
  "email": "user@example.com",
  "name": "User Name",
  "google_id": "google_user_id",
  "is_root": false,
  "can_invite": false,
  "created_at": "2024-01-01T00:00:00Z",
  "last_login": "2024-01-01T12:00:00Z"
}
```

#### PUT /users/:id
ユーザー情報を更新します。

**認証:** 必須
**権限:** 自分の情報（名前のみ）またはrootユーザー（権限変更可能）

**Request Body:**
```json
{
  "name": "New Name",
  "can_invite": true
}
```

#### DELETE /users/:id
ユーザーを削除します。

**認証:** 必須
**権限:** rootユーザーのみ（自分自身は削除不可）

**Response (200 OK):**
```json
{
  "success": true,
  "message": "User deleted successfully"
}
```

### 招待システムエンドポイント

#### GET /invites
自分が作成した招待コードを取得します。

**認証:** 必須
**権限:** 招待権限を持つユーザー

**Response (200 OK):**
```json
[
  {
    "id": "1",
    "code": "uuid-invite-code",
    "created_at": "2024-01-01T00:00:00Z",
    "created_by": 1,
    "used_by": null,
    "used_at": null
  }
]
```

#### POST /invites
新しい招待コードを作成します。

**認証:** 必須
**権限:** 招待権限を持つユーザー

**Response (201 Created):**
```json
{
  "id": "1",
  "code": "uuid-invite-code",
  "created_at": "2024-01-01T00:00:00Z",
  "created_by": 1,
  "used_by": null,
  "used_at": null
}
```

#### DELETE /invites/:id
招待コードを削除します。

**認証:** 必須
**権限:** 招待権限を持つユーザー

### 保護されたコンテンツ

#### GET /content
保護されたコンテンツを取得します。

**認証:** 必須

**Response (200 OK):**
```json
{
  "message": "Hello user@example.com! Here's your protected content...",
  "user": "user@example.com",
  "timestamp": "2024-01-01T12:00:00Z"
}
```

### システム情報

#### GET /system/status
システムの状態を取得します。

**Response (200 OK):**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "users_registered": 5,
  "root_user_exists": true,
  "timestamp": "2024-01-01T12:00:00Z"
}
```

## エラーレスポンス

全てのエラーは以下の形式で返されます：

```json
{
  "error": "error_code",
  "message": "Human readable error message"
}
```

### 共通HTTPステータスコード

- `200 OK` - 成功
- `201 Created` - リソース作成成功
- `400 Bad Request` - リクエストが無効
- `401 Unauthorized` - 認証が必要
- `403 Forbidden` - 権限が不足
- `404 Not Found` - リソースが見つからない
- `500 Internal Server Error` - サーバー内部エラー

## 認証フロー

### 1. 認証トークンの取得
```bash
curl -X POST http://localhost:8080/auth/tokens \
  -H "Content-Type: application/json" \
  -d '{"grant_type": "client_credentials"}'
```

### 2. ブラウザでOAuth認証
レスポンスの`auth_url`をブラウザで開いてGoogle OAuth認証を完了

### 3. JWTトークンの取得
OAuth認証完了後、コールバックでJWTトークンを取得

### 4. APIリクエストでトークンを使用
```bash
curl -X GET http://localhost:8080/content \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

## 設定

### 環境変数

- `GOOGLE_CLIENT_ID` - Google OAuth2 クライアントID（必須）
- `GOOGLE_CLIENT_SECRET` - Google OAuth2 クライアントシークレット（必須）
- `REDIRECT_URL` - OAuth2 リダイレクトURL（デフォルト: http://localhost:8080/oauth/callback）
- `JWT_SECRET` - JWT署名用シークレット（デフォルト: your-secret-key）
- `DATABASE_URL` - データベースURL（デフォルト: sqlite:./patchouli.db）

## 変更履歴

### RESTful リファクタリング (2024年版)

- セッションベースからJWTベースの認証に変更
- HTMLレスポンスから純粋なJSON APIに統一
- リソース指向のURL設計を採用
- 適切なHTTPメソッドとステータスコードの使用
- ステートレス設計の実装

#### 主な変更点

| 旧エンドポイント | 新エンドポイント | 変更内容 |
|------------------|------------------|----------|
| `GET /login` | `POST /auth/tokens` | 認証フロー開始 |
| `GET /logout` | `DELETE /auth/tokens` | ログアウト |
| `GET /admin/users` | `GET /users` | ユーザー一覧 |
| `DELETE /admin/users/:id` | `DELETE /users/:id` | ユーザー削除 |
| `GET /invite/create` | `POST /invites` | 招待作成 |
| `GET /invite/list` | `GET /invites` | 招待一覧 |
| `GET /protected` | `GET /content` | 保護コンテンツ |
| `GET /root/exists` | `GET /system/status` | システム状態 |

このRESTful APIは、スケーラブルで保守性の高い設計となっており、標準的なHTTP規約に準拠しています。