use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{migrate::MigrateDatabase, Pool, Row, Sqlite, SqlitePool};
use std::env;
use uuid::Uuid;
use tracing::{info, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisteredUser {
    pub id: i64,
    pub google_id: String,
    pub email: String,
    pub name: String,
    pub registered_at: DateTime<Utc>,
    pub last_login: Option<DateTime<Utc>>,
    pub is_root: bool,
    pub can_invite: bool,
    pub invited_by: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InviteCode {
    pub id: i64,
    pub code: String,
    pub created_by: i64,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub used_by: Option<i64>,
    pub used_at: Option<DateTime<Utc>>,
    pub is_active: bool,
}

#[derive(Clone)]
pub struct Database {
    pool: Pool<Sqlite>,
}

impl Database {
    pub async fn new() -> Result<Self, sqlx::Error> {
        let database_url = env::var("DATABASE_URL")
            .unwrap_or_else(|_| "sqlite:./patchouli.db".to_string());

        if !Sqlite::database_exists(&database_url).await.unwrap_or(false) {
            Sqlite::create_database(&database_url).await?;
        }

        let pool = SqlitePool::connect(&database_url).await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS registered_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                google_id TEXT NOT NULL UNIQUE,
                email TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                registered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_login DATETIME,
                is_root BOOLEAN NOT NULL DEFAULT FALSE,
                can_invite BOOLEAN NOT NULL DEFAULT TRUE,
                invited_by INTEGER,
                FOREIGN KEY (invited_by) REFERENCES registered_users(id)
            )
            "#,
        )
        .execute(&pool)
        .await?;

        // 既存のテーブルに新しいカラムを追加（マイグレーション）
        sqlx::query("ALTER TABLE registered_users ADD COLUMN is_root BOOLEAN DEFAULT FALSE")
            .execute(&pool)
            .await
            .ok(); // エラーを無視（カラムが既に存在する場合）
        
        sqlx::query("ALTER TABLE registered_users ADD COLUMN can_invite BOOLEAN DEFAULT TRUE")
            .execute(&pool)
            .await
            .ok();
            
        sqlx::query("ALTER TABLE registered_users ADD COLUMN invited_by INTEGER")
            .execute(&pool)
            .await
            .ok();

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS invite_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT NOT NULL UNIQUE,
                created_by INTEGER NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME,
                used_by INTEGER,
                used_at DATETIME,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                FOREIGN KEY (created_by) REFERENCES registered_users(id),
                FOREIGN KEY (used_by) REFERENCES registered_users(id)
            )
            "#,
        )
        .execute(&pool)
        .await?;

        Ok(Database { pool })
    }

    pub async fn register_user(
        &self,
        google_id: &str,
        email: &str,
        name: &str,
    ) -> Result<RegisteredUser, sqlx::Error> {
        let now = Utc::now();
        
        // 最初のユーザーかチェック
        let user_count = self.count_registered_users().await?;
        let is_root = user_count == 0;
        
        let row = sqlx::query(
            r#"
            INSERT INTO registered_users (google_id, email, name, registered_at, last_login, is_root, can_invite, invited_by)
            VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, ?7)
            RETURNING id, google_id, email, name, registered_at, last_login, is_root, can_invite, invited_by
            "#,
        )
        .bind(google_id)
        .bind(email)
        .bind(name)
        .bind(now)
        .bind(is_root)
        .bind(is_root) // rootユーザーのみcan_invite=true
        .bind(None::<i64>) // 最初のユーザーはinvited_by=NULL
        .fetch_one(&self.pool)
        .await?;

        Ok(RegisteredUser {
            id: row.get("id"),
            google_id: row.get("google_id"),
            email: row.get("email"),
            name: row.get("name"),
            registered_at: row.get("registered_at"),
            last_login: row.get("last_login"),
            is_root: row.get("is_root"),
            can_invite: row.get("can_invite"),
            invited_by: row.get("invited_by"),
        })
    }

    pub async fn register_invited_user(
        &self,
        google_id: &str,
        email: &str,
        name: &str,
        invited_by: i64,
    ) -> Result<RegisteredUser, sqlx::Error> {
        let now = Utc::now();
        
        let row = sqlx::query(
            r#"
            INSERT INTO registered_users (google_id, email, name, registered_at, last_login, is_root, can_invite, invited_by)
            VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, ?7)
            RETURNING id, google_id, email, name, registered_at, last_login, is_root, can_invite, invited_by
            "#,
        )
        .bind(google_id)
        .bind(email)
        .bind(name)
        .bind(now)
        .bind(false) // 招待されたユーザーはrootではない
        .bind(false) // 招待されたユーザーは招待権限なし
        .bind(invited_by)
        .fetch_one(&self.pool)
        .await?;

        Ok(RegisteredUser {
            id: row.get("id"),
            google_id: row.get("google_id"),
            email: row.get("email"),
            name: row.get("name"),
            registered_at: row.get("registered_at"),
            last_login: row.get("last_login"),
            is_root: row.get("is_root"),
            can_invite: row.get("can_invite"),
            invited_by: row.get("invited_by"),
        })
    }

    pub async fn is_user_registered(&self, email: &str) -> Result<bool, sqlx::Error> {
        let result = sqlx::query("SELECT COUNT(*) as count FROM registered_users WHERE email = ?1")
            .bind(email)
            .fetch_one(&self.pool)
            .await?;

        let count: i64 = result.get("count");
        Ok(count > 0)
    }

    pub async fn get_user_by_email(&self, email: &str) -> Result<Option<RegisteredUser>, sqlx::Error> {
        let result = sqlx::query(
            "SELECT id, google_id, email, name, registered_at, last_login, 
             COALESCE(is_root, FALSE) as is_root, 
             COALESCE(can_invite, TRUE) as can_invite, 
             invited_by 
             FROM registered_users WHERE email = ?1"
        )
        .bind(email)
        .fetch_optional(&self.pool)
        .await?;

        if let Some(row) = result {
            Ok(Some(RegisteredUser {
                id: row.get("id"),
                google_id: row.get("google_id"),
                email: row.get("email"),
                name: row.get("name"),
                registered_at: row.get("registered_at"),
                last_login: row.get("last_login"),
                is_root: row.get("is_root"),
                can_invite: row.get("can_invite"),
                invited_by: row.get("invited_by"),
            }))
        } else {
            Ok(None)
        }
    }

    pub async fn update_last_login(&self, email: &str) -> Result<(), sqlx::Error> {
        let now = Utc::now();
        sqlx::query("UPDATE registered_users SET last_login = ?1 WHERE email = ?2")
            .bind(now)
            .bind(email)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    pub async fn get_all_registered_users(&self) -> Result<Vec<RegisteredUser>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT id, google_id, email, name, registered_at, last_login, 
             COALESCE(is_root, FALSE) as is_root, 
             COALESCE(can_invite, TRUE) as can_invite, 
             invited_by 
             FROM registered_users ORDER BY registered_at DESC"
        )
        .fetch_all(&self.pool)
        .await?;

        let users = rows
            .into_iter()
            .map(|row| RegisteredUser {
                id: row.get("id"),
                google_id: row.get("google_id"),
                email: row.get("email"),
                name: row.get("name"),
                registered_at: row.get("registered_at"),
                last_login: row.get("last_login"),
                is_root: row.get("is_root"),
                can_invite: row.get("can_invite"),
                invited_by: row.get("invited_by"),
            })
            .collect();

        Ok(users)
    }

    pub async fn delete_user(&self, user_id: i64) -> Result<bool, sqlx::Error> {
        info!("Starting delete operation for user ID: {}", user_id);
        
        // トランザクションを開始
        let mut tx = self.pool.begin().await?;
        info!("Transaction started for user deletion");

        // 1. まず、削除対象がrootユーザーでないことを確認
        let user_check = sqlx::query("SELECT is_root, email FROM registered_users WHERE id = ?1")
            .bind(user_id)
            .fetch_optional(&mut *tx)
            .await?;

        match user_check {
            Some(row) => {
                let is_root: bool = row.get("is_root");
                let email: String = row.get("email");
                info!("Found user for deletion: email={}, is_root={}", email, is_root);
                
                if is_root {
                    warn!("Attempted to delete root user: {}", email);
                    tx.rollback().await?;
                    return Ok(false); // rootユーザーは削除できない
                }
            }
            None => {
                warn!("User ID {} not found for deletion", user_id);
                tx.rollback().await?;
                return Ok(false); // ユーザーが存在しない
            }
        }

        // 2. 関連する招待コードを削除または無効化
        info!("Deleting related invite codes for user ID: {}", user_id);
        let invite_result = sqlx::query("DELETE FROM invite_codes WHERE created_by = ?1 OR used_by = ?1")
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        info!("Deleted {} invite codes", invite_result.rows_affected());

        // 3. ユーザーを削除
        info!("Deleting user record for ID: {}", user_id);
        let result = sqlx::query("DELETE FROM registered_users WHERE id = ?1")
            .bind(user_id)
            .execute(&mut *tx)
            .await?;

        let deleted_rows = result.rows_affected();
        info!("User deletion affected {} rows", deleted_rows);

        // トランザクションをコミット
        tx.commit().await?;
        info!("Transaction committed for user deletion");

        Ok(deleted_rows > 0)
    }

    pub async fn create_invite_code(&self, created_by: i64) -> Result<InviteCode, sqlx::Error> {
        let code = Uuid::new_v4().to_string();
        let now = Utc::now();
        
        let row = sqlx::query(
            r#"
            INSERT INTO invite_codes (code, created_by, created_at, is_active)
            VALUES (?1, ?2, ?3, ?4)
            RETURNING id, code, created_by, created_at, expires_at, used_by, used_at, is_active
            "#,
        )
        .bind(&code)
        .bind(created_by)
        .bind(now)
        .bind(true)
        .fetch_one(&self.pool)
        .await?;

        Ok(InviteCode {
            id: row.get("id"),
            code: row.get("code"),
            created_by: row.get("created_by"),
            created_at: row.get("created_at"),
            expires_at: row.get("expires_at"),
            used_by: row.get("used_by"),
            used_at: row.get("used_at"),
            is_active: row.get("is_active"),
        })
    }

    pub async fn validate_invite_code(&self, code: &str) -> Result<Option<InviteCode>, sqlx::Error> {
        let result = sqlx::query(
            r#"
            SELECT id, code, created_by, created_at, expires_at, used_by, used_at, is_active 
            FROM invite_codes 
            WHERE code = ?1 AND is_active = TRUE AND used_by IS NULL
            "#
        )
        .bind(code)
        .fetch_optional(&self.pool)
        .await?;

        if let Some(row) = result {
            let invite = InviteCode {
                id: row.get("id"),
                code: row.get("code"),
                created_by: row.get("created_by"),
                created_at: row.get("created_at"),
                expires_at: row.get("expires_at"),
                used_by: row.get("used_by"),
                used_at: row.get("used_at"),
                is_active: row.get("is_active"),
            };

            if let Some(expires_at) = invite.expires_at {
                if Utc::now() > expires_at {
                    return Ok(None);
                }
            }

            Ok(Some(invite))
        } else {
            Ok(None)
        }
    }

    pub async fn use_invite_code(&self, code: &str, used_by: i64) -> Result<(), sqlx::Error> {
        let now = Utc::now();
        sqlx::query(
            "UPDATE invite_codes SET used_by = ?1, used_at = ?2 WHERE code = ?3"
        )
        .bind(used_by)
        .bind(now)
        .bind(code)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn get_invite_codes_by_user(&self, user_id: i64) -> Result<Vec<InviteCode>, sqlx::Error> {
        let rows = sqlx::query(
            r#"
            SELECT id, code, created_by, created_at, expires_at, used_by, used_at, is_active 
            FROM invite_codes 
            WHERE created_by = ?1 
            ORDER BY created_at DESC
            "#
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;

        let invites = rows
            .into_iter()
            .map(|row| InviteCode {
                id: row.get("id"),
                code: row.get("code"),
                created_by: row.get("created_by"),
                created_at: row.get("created_at"),
                expires_at: row.get("expires_at"),
                used_by: row.get("used_by"),
                used_at: row.get("used_at"),
                is_active: row.get("is_active"),
            })
            .collect();

        Ok(invites)
    }

    pub async fn count_registered_users(&self) -> Result<i64, sqlx::Error> {
        let result = sqlx::query("SELECT COUNT(*) as count FROM registered_users")
            .fetch_one(&self.pool)
            .await?;

        Ok(result.get("count"))
    }
}