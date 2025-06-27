# Patchouli MCP サーバー

Patchouli ナレッジベースシステム用のModel Context Protocol (MCP) 実装です。

## 概要

このMCPサーバーは、認証されたセッションを通じてPatchouliの保護されたコンテンツへのアクセスを提供します。MCP対応アプリケーションとPatchouliコアサーバーの橋渡しとして機能します。

## 機能

- **get_protected_content**: Patchouli認証システムから有効なセッションIDを使用して保護されたコンテンツを取得

## 前提条件

- Node.js 18以上
- `http://localhost:8080` で実行中のPatchouliコアサーバー
- コアサーバーの認証フローから取得した有効なセッションID

## インストール

```bash
pnpm install
```

## 開発

```bash
pnpm run dev
```

## ビルド

```bash
pnpm run build
pnpm start
```

## 使用方法

### 認証フロー

1. まず、Patchouliコアサーバーで認証を行います：
   - `http://localhost:8080/login` にアクセス
   - Google OAuth認証を完了
   - コールバックからセッションIDを取得

2. MCPツールでセッションIDを使用：

```json
{
  "name": "get_protected_content",
  "arguments": {
    "session_id": "your-session-id-here"
  }
}
```

### ツールリファレンス

#### get_protected_content

認証されたユーザー向けの保護されたコンテンツを取得します。

**パラメータ:**
- `session_id` (文字列、必須): Patchouli認証から取得した有効なセッションID

**戻り値:**
- 成功: 認証されたユーザー向けにパーソナライズされた保護されたコンテンツ文字列
- エラー: 認証または接続エラーメッセージ

**レスポンス例:**
```
Hello user@example.com! Here's your protected content: 'The Grand Library of Patchouli Knowledge awaits your exploration. May your quest for knowledge be fruitful and your discoveries illuminate the path ahead.'
```

## 設定

MCPサーバーはデフォルトで `http://localhost:8080` のPatchouliコアサーバーに接続します。これは `src/index.ts` の `PatchouliClient` コンストラクタを変更することで設定できます。

## エラーハンドリング

サーバーは様々なエラー状況を処理します：
- 無効または期限切れのセッションID (401 Unauthorized)
- コアサーバー接続失敗
- ネットワークタイムアウトやその他のHTTPエラー

すべてのエラーは `isError` フラグがtrueに設定されたテキストコンテンツとして返されます。