# スマートリダイレクト機能

## 概要

Patchouliのスマートリダイレクト機能は、rootアカウントの存在状況に基づいてユーザーを適切なページに自動的に誘導する機能です。この機能により、ユーザーは常に適切な認証フローを体験でき、混乱を避けることができます。

## 機能詳細

### rootアカウント存在確認API

**エンドポイント:** `GET /root/exists`

**レスポンス:**
```json
{
  "root_exists": boolean
}
```

- `root_exists: true`: rootアカウントが登録済み
- `root_exists: false`: rootアカウント未登録（初回セットアップ状態）

### 自動リダイレクトロジック

#### 1. 登録ページ（/register）のリダイレクト

**条件:** rootアカウントが既に存在する場合
**動作:** 自動的にログインページ（/login）にリダイレクト

**実装箇所:** `frontend/src/components/RegistrationPage.tsx`
```typescript
useEffect(() => {
  const checkRootAndRedirect = async () => {
    try {
      const { root_exists } = await patchouliAPI.checkRootExists();
      if (root_exists) {
        navigate('/login');
      }
    } catch (error) {
      console.error('Failed to check root existence:', error);
    }
  };
  
  checkRootAndRedirect();
}, [navigate]);
```

#### 2. ログインページ（/login）のリダイレクト

**条件:** rootアカウントが存在しない場合
**動作:** 自動的に登録ページ（/register）にリダイレクト

**例外:** 招待コード付きのURLの場合はリダイレクトをスキップ

**実装箇所:** `frontend/src/components/LoginPage.tsx`
```typescript
useEffect(() => {
  const checkRootAndRedirect = async () => {
    try {
      const { root_exists } = await patchouliAPI.checkRootExists();
      if (!root_exists) {
        navigate('/register');
        return;
      }
    } catch (error) {
      console.error('Failed to check root existence:', error);
    }
  };

  // 通常のログインページの場合のみrootアカウント存在確認
  if (!register) {
    checkRootAndRedirect();
  }
}, [navigate]);
```

## ユーザーフロー

### 初回セットアップ時

```
1. ユーザーがサイトにアクセス
2. /login または /register にアクセス
3. rootアカウント存在確認 -> false
4. /register に自動リダイレクト
5. rootユーザー登録を実行
```

### rootアカウント登録済み時

```
1. ユーザーがサイトにアクセス
2. /login または /register にアクセス
3. rootアカウント存在確認 -> true
4. /login に自動リダイレクト
5. 通常ログインを実行
```

### 招待URL経由時

```
1. 招待URLにアクセス (/login?register=true&invite=xxx)
2. リダイレクトをスキップ
3. 招待コードを使用した新規登録を実行
```

## 技術実装

### バックエンド（Rust）

**ファイル:** `core/src/main.rs`

```rust
async fn check_root_exists(State(state): State<AppState>) -> Result<Json<RootExistsResponse>, StatusCode> {
    match state.database.count_registered_users().await {
        Ok(count) => Ok(Json(RootExistsResponse {
            root_exists: count > 0,
        })),
        Err(e) => {
            warn!("Database error during root exists check: {:?}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}
```

### フロントエンド（React + TypeScript）

**APIクライアント:** `frontend/src/services/api.ts`

```typescript
export interface RootExistsResponse {
  root_exists: boolean;
}

async checkRootExists(): Promise<RootExistsResponse> {
  const response = await this.client.get('/root/exists');
  return response.data;
}
```

**React Hook使用パターン:**
```typescript
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { patchouliAPI } from '../services/api';

const navigate = useNavigate();

useEffect(() => {
  const checkRootAndRedirect = async () => {
    try {
      const { root_exists } = await patchouliAPI.checkRootExists();
      // リダイレクトロジック
    } catch (error) {
      console.error('Failed to check root existence:', error);
    }
  };
  
  checkRootAndRedirect();
}, [navigate]);
```

## 利点

1. **ユーザビリティ向上**: ユーザーは適切なページに自動的に誘導される
2. **混乱の回避**: 手動のナビゲーションリンクによる混乱を防止
3. **一貫性**: 常に正しい認証フローを提供
4. **保守性**: リダイレクトロジックが一箇所に集約
5. **拡張性**: 新しいリダイレクト条件を簡単に追加可能

## 注意点

- API呼び出しに失敗した場合はリダイレクトを実行しない（フォールバック動作）
- 招待URL経由のアクセスは通常のリダイレクトロジックをスキップ
- React Router の navigate() を使用してクライアントサイドナビゲーションを実行
- useEffect の依存配列に navigate を含めて適切な再実行を保証

## デバッグ

コンソールログでリダイレクトの動作を確認できます：

```
Failed to check root existence: [error details]
```

このログが表示された場合は、coreサーバーとの通信に問題がある可能性があります。