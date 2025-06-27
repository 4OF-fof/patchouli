# Patchouli MCP サーバー

Patchouli ナレッジベースシステム用のModel Context Protocol (MCP) 実装です。

## 概要

このMCPサーバーは、認証されたセッションを通じてPatchouliの保護されたコンテンツへのアクセスを提供します。MCP対応アプリケーションとPatchouliコアサーバーの橋渡しとして機能します。

## 機能

- **authenticate**: Patchouliサーバーで認証を行いセッションIDを取得
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

### 基本的な使用フロー

1. **認証**: `authenticate` ツールを使用してセッションIDを取得
2. **コンテンツアクセス**: 取得したセッションIDで `get_protected_content` を呼び出し

```json
// 1. 認証
{
  "name": "authenticate",
  "arguments": {}
}

// 2. 保護されたコンテンツの取得
{
  "name": "get_protected_content",
  "arguments": {
    "session_id": "認証で取得したセッションID"
  }
}
```

### ツールリファレンス

#### authenticate

Patchouliサーバーで認証を行いセッションIDを取得します。

**パラメータ:** なし

**動作:**
1. 一時的な認証トークンを生成
2. ブラウザでGoogle OAuth認証ページを開く
3. ユーザーが認証を完了するまでポーリング
4. 認証完了後、セッションIDを返す

**戻り値:**
- 成功: 認証成功メッセージとセッションID
- エラー: 認証エラーメッセージ

#### get_protected_content

認証されたユーザー向けの保護されたコンテンツを取得します。

**パラメータ:**
- `session_id` (文字列、必須): `authenticate` ツールで取得したセッションID

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