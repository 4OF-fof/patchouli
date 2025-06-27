# Patchouli Core Server

Google OAuth2認証を使用したRust/Axumベースのナレッジベース管理サーバー

## セットアップ

1. 環境変数の設定:
```bash
cp .env.example .env
# .envファイルを編集してGoogle OAuth2の認証情報を設定
```

2. Google Cloud Consoleでの設定:
   - OAuth 2.0 クライアントIDを作成
   - リダイレクトURIに `http://localhost:8080/callback` を追加
   - CLIENT_IDとCLIENT_SECRETを.envに設定

3. サーバー起動:
```bash
cargo run
```

## エンドポイント

- `GET /` - ホームページ
- `GET /login` - Google OAuth2ログイン
- `GET /callback` - OAuth2コールバック
- `GET /protected?session_id=<id>` - 認証が必要な保護されたリソース
- `GET /logout?session_id=<id>` - ログアウト

## 使用方法

1. http://localhost:8080 にアクセス
2. "Login with Google"をクリックしてログイン
3. 認証後、session_idを使って保護されたAPIにアクセス可能