# Patchouli Frontend

Patchouli Knowledge BaseのWebフロントエンドアプリケーションです。

## 技術スタック

- **Vite**: 高速ビルドツール
- **React 19**: UIライブラリ
- **TypeScript**: 型安全性
- **Panda CSS**: CSS-in-JSスタイリング
- **React Router DOM**: クライアントサイドルーティング
- **Axios**: HTTPクライアント

## 機能

- **Google OAuth 2.0認証**: Patchouliコアサーバー経由
- **セッション管理**: ローカルストレージベース
- **保護されたルート**: 認証が必要なページ
- **レスポンシブデザイン**: Panda CSSによるモダンUI
- **自動リダイレクト**: 認証フロー完了後の自動遷移

## セットアップ

### 前提条件

- Node.js 18以上
- pnpm 10.12.3以上
- Patchouliコアサーバーが起動していること（http://localhost:8080）

### インストール

```bash
pnpm install
```

### 開発サーバー起動

```bash
pnpm run dev
```

フロントエンドは http://localhost:3000 で起動します。

### ビルド

```bash
pnpm run build
```

### プレビュー

```bash
pnpm run preview
```

## 設定

### プロキシ設定

`vite.config.ts`でAPIプロキシが設定されています：

```typescript
proxy: {
  '/api': {
    target: 'http://localhost:8080',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api/, ''),
  },
}
```

## ルート構成

- `/` - ダッシュボードへのリダイレクト
- `/login` - ログインページ
- `/callback` - OAuth認証コールバック処理
- `/dashboard` - メインダッシュボード（認証必須）

## 認証フロー

1. **未認証時**: 自動的に`/login`ページにリダイレクト
2. **ログインボタンクリック**: `window.location.href = '/api/login'`でGoogle OAuth開始
3. **Google認証完了**: コアサーバーが`/callback`にリダイレクト
4. **コールバック処理**: URLパラメータからセッション情報を取得
5. **認証完了**: `/dashboard`に遷移してメインアプリケーション表示

## API通信

### エンドポイント

- `GET /api/protected`: 保護されたコンテンツ取得
- `GET /api/logout`: ログアウト

### エラーハンドリング

- 401 Unauthorized: 自動的にログインページにリダイレクト
- ネットワークエラー: ユーザーフレンドリーなエラーメッセージ表示

## トラブルシューティング

### ビルドエラー

- TypeScriptエラー: 型定義を確認
- Panda CSSエラー: `pnpm run prepare`でコード生成を再実行

### 認証エラー

- コアサーバーが起動していることを確認
- Google OAuth設定を確認
- ブラウザのローカルストレージをクリア
