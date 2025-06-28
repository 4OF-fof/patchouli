use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{migrate::MigrateDatabase, Pool, Row, Sqlite, SqlitePool};
use std::env;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisteredUser {
    pub id: i64,
    pub google_id: String,
    pub email: String,
    pub name: String,
    pub registered_at: DateTime<Utc>,
    pub last_login: Option<DateTime<Utc>>,
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
                last_login DATETIME
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
        
        let row = sqlx::query(
            r#"
            INSERT INTO registered_users (google_id, email, name, registered_at, last_login)
            VALUES (?1, ?2, ?3, ?4, ?4)
            RETURNING id, google_id, email, name, registered_at, last_login
            "#,
        )
        .bind(google_id)
        .bind(email)
        .bind(name)
        .bind(now)
        .fetch_one(&self.pool)
        .await?;

        Ok(RegisteredUser {
            id: row.get("id"),
            google_id: row.get("google_id"),
            email: row.get("email"),
            name: row.get("name"),
            registered_at: row.get("registered_at"),
            last_login: row.get("last_login"),
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
            "SELECT id, google_id, email, name, registered_at, last_login FROM registered_users WHERE email = ?1"
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
            "SELECT id, google_id, email, name, registered_at, last_login FROM registered_users ORDER BY registered_at DESC"
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
            })
            .collect();

        Ok(users)
    }
}