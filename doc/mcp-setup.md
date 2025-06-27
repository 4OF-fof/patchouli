# MCP (Model Context Protocol) セットアップガイド

## 概要

PatchouliのMCPサーバーはClaude DesktopやCursorなどのMCP対応アプリケーションで使用できる認証機能付きのツールを提供します。

## 前提条件

- Node.js 18以上
- pnpm 10.12.3以上
- Patchouliコアサーバーが起動していること（http://localhost:8080）
- Google OAuth 2.0の設定が完了していること

## インストールと設定

### 1. MCPサーバーのビルド

```bash
cd mcp/
pnpm install
pnpm run build
```

### 2. Claude Desktop設定

Claude Desktopの設定ファイル `~/Library/Application Support/Claude/claude_desktop_config.json` を編集：

```json
{
  "mcpServers": {
    "patchouli": {
      "command": "/Users/[username]/.volta/tools/image/node/22.16.0/bin/node",
      "args": ["/Users/[username]/Project/patchouli/mcp/dist/index.js"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

**注意:** 
- `[username]`を実際のユーザー名に置き換えてください
- Node.jsのパスは `which node` で確認できます
- MCPプロジェクトのパスは絶対パスで指定してください

### 3. Claude Desktopの再起動

設定ファイル保存後、Claude Desktopを完全に終了して再起動してください。

## 利用可能なツール

### authenticate
Google OAuth 2.0を使用してPatchouliサーバーで認証を行い、セッションIDを取得します。

**使用方法:**
```
Patchouliサーバーで認証を行ってください
```

**動作:**
1. 認証トークンを生成
2. 自動でブラウザが開きGoogle OAuth認証ページに移動
3. ユーザーがGoogle認証を完了
4. 認証状態をポーリングして完了を待機
5. セッションIDを返却

### get_protected_content
認証済みセッションIDを使用して保護されたコンテンツにアクセスします。

**使用方法:**
```
セッションID [session_id] で保護されたコンテンツを取得してください
```

または、先に認証を済ませた後：
```
保護されたコンテンツを表示してください
```

## トラブルシューティング

### "spawn node ENOENT" エラー
- Node.jsのパスが正しくない場合に発生
- `which node` でパスを確認し、設定ファイルを更新

### 認証タイムアウト
- 60秒以内にブラウザで認証を完了してください
- 認証失敗時は再度 `authenticate` ツールを実行

### コアサーバー接続エラー
- Patchouliコアサーバーが http://localhost:8080 で起動していることを確認
- Google OAuth 2.0の環境変数が設定されていることを確認

### OAuth2スコープエラー
- Google Cloud Consoleでの設定を確認
- リダイレクトURIが正しく設定されていることを確認

## Claude Desktopでの使用例

1. **認証の実行:**
   ```
   Patchouliで認証を行って、利用可能なコンテンツを確認したいです
   ```

2. **コンテンツアクセス:**
   ```
   認証済みなので、保護されたPatchouliのコンテンツを表示してください
   ```

3. **ワンステップでの認証とアクセス:**
   ```
   Patchouliサーバーで認証を行い、その後保護されたコンテンツを取得してください
   ```

## セキュリティ注意事項

- セッションIDは一時的なものです
- 認証は60秒でタイムアウトします
- ブラウザでの認証完了後は認証ページを閉じてください
- セッションIDを他人と共有しないでください