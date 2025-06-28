use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{Html, Json, Redirect},
    routing::get,
    Router,
};
mod database;
use database::Database;
use oauth2::{
    basic::BasicClient,
    reqwest::async_http_client,
    AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken, RedirectUrl, Scope,
    TokenResponse, TokenUrl,
};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc};
use tokio::sync::RwLock;
use tower_http::{trace::TraceLayer, cors::CorsLayer};
use tracing::{info, warn};
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    oauth_client: BasicClient,
    sessions: Arc<RwLock<HashMap<String, UserSession>>>,
    auth_tokens: Arc<RwLock<HashMap<String, Option<String>>>>,
    database: Database,
}

#[derive(Clone, Debug)]
struct UserSession {
    user_id: String,
    email: String,
}

#[derive(Deserialize)]
struct AuthRequest {
    code: String,
    state: String,
}

#[derive(Deserialize)]
struct GoogleUserInfo {
    id: String,
    email: String,
    name: String,
}

#[derive(Serialize)]
struct AuthResponse {
    session_id: String,
    user_email: String,
}

#[derive(Serialize)]
struct AuthTokenResponse {
    auth_token: String,
    login_url: String,
}

#[derive(Serialize)]
struct AuthStatusResponse {
    status: String,
    session_id: Option<String>,
    user_email: Option<String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt::init();

    let google_client_id = std::env::var("GOOGLE_CLIENT_ID")
        .expect("GOOGLE_CLIENT_ID environment variable must be set");
    let google_client_secret = std::env::var("GOOGLE_CLIENT_SECRET")
        .expect("GOOGLE_CLIENT_SECRET environment variable must be set");
    let redirect_url = std::env::var("REDIRECT_URL")
        .unwrap_or_else(|_| "http://localhost:8080/callback".to_string());

    let oauth_client = BasicClient::new(
        ClientId::new(google_client_id),
        Some(ClientSecret::new(google_client_secret)),
        AuthUrl::new("https://accounts.google.com/o/oauth2/auth".to_string())?,
        Some(TokenUrl::new("https://oauth2.googleapis.com/token".to_string())?),
    )
    .set_redirect_uri(RedirectUrl::new(redirect_url)?);

    let database = Database::new().await?;

    let state = AppState {
        oauth_client,
        sessions: Arc::new(RwLock::new(HashMap::new())),
        auth_tokens: Arc::new(RwLock::new(HashMap::new())),
        database,
    };

    let app = Router::new()
        .route("/", get(index))
        .route("/login", get(login))
        .route("/login/api", get(login_api))
        .route("/callback", get(callback))
        .route("/callback/api", get(callback_api))
        .route("/auth/status/:token", get(auth_status))
        .route("/protected", get(protected))
        .route("/logout", get(logout))
        .with_state(state)
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http());

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    info!("Server running on http://0.0.0.0:8080");
    
    axum::serve(listener, app).await?;
    Ok(())
}

async fn index() -> Html<&'static str> {
    Html(r#"
        <html>
        <head><title>Patchouli Server</title></head>
        <body>
            <h1>Patchouli Knowledge Base Server</h1>
            <p>Welcome to Patchouli! Please authenticate to access the API.</p>
            <a href="/login">Login with Google</a>
        </body>
        </html>
    "#)
}

async fn login(Query(query): Query<std::collections::HashMap<String, String>>, State(state): State<AppState>) -> Redirect {
    let is_registration = query.get("register").map(|v| v == "true").unwrap_or(false);
    
    let csrf_state = if let Some(token) = query.get("token") {
        // API認証用のトークンが指定された場合はそれをstateに使用
        CsrfToken::new(format!("{}:{}", token, if is_registration { "register" } else { "login" }))
    } else {
        // 通常のWeb認証の場合はランダムなCSRFトークンを生成
        CsrfToken::new(if is_registration { "register".to_string() } else { "login".to_string() })
    };

    let (auth_url, _csrf_token) = state
        .oauth_client
        .authorize_url(|| csrf_state)
        .add_scope(Scope::new("openid".to_string()))
        .add_scope(Scope::new("email".to_string()))
        .add_scope(Scope::new("profile".to_string()))
        .url();

    Redirect::permanent(&auth_url.to_string())
}

async fn send_discord_notification(auth_token: &str, user_email: &str) -> Result<(), reqwest::Error> {
    let discord_bot_url = std::env::var("DISCORD_BOT_URL")
        .unwrap_or_else(|_| "http://localhost:3001".to_string());
    
    let notification_payload = serde_json::json!({
        "auth_token": auth_token,
        "user_email": user_email
    });

    let client = reqwest::Client::new();
    let response = client
        .post(&format!("{}/auth-complete", discord_bot_url))
        .json(&notification_payload)
        .send()
        .await?;

    if response.status().is_success() {
        info!("Discord notification sent successfully for user: {}", user_email);
    } else {
        warn!("Discord notification failed with status: {}", response.status());
    }

    Ok(())
}

async fn callback(
    Query(params): Query<AuthRequest>,
    State(state): State<AppState>,
) -> Result<Html<String>, StatusCode> {
    let token_result = state
        .oauth_client
        .exchange_code(AuthorizationCode::new(params.code.clone()))
        .request_async(async_http_client)
        .await
        .map_err(|e| {
            warn!("Token exchange failed: {:?}", e);
            StatusCode::BAD_REQUEST
        })?;

    let access_token = token_result.access_token().secret().to_string();
    
    let client = reqwest::Client::new();
    let user_info: GoogleUserInfo = client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|e| {
            warn!("Failed to get user info: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?
        .json()
        .await
        .map_err(|e| {
            warn!("Failed to parse user info: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // stateパラメータから登録かログインかを判定
    let state_parts: Vec<&str> = params.state.split(':').collect();
    let is_registration = state_parts.get(1).map(|&s| s == "register").unwrap_or_else(|| params.state == "register");
    let auth_token = if state_parts.len() > 1 { state_parts[0] } else { &params.state };

    // 登録処理かログイン処理かを判定
    if is_registration {
        // 既に登録済みかチェック
        match state.database.is_user_registered(&user_info.email).await {
            Ok(true) => {
                // 既に登録済みの場合はエラー
                return Ok(Html(format!(
                    r#"
                    <html>
                    <head><title>Registration Error</title></head>
                    <body>
                        <h1>登録エラー</h1>
                        <p>このアカウント（{}）は既に登録済みです。</p>
                        <p><a href="/login">ログインページに戻る</a></p>
                    </body>
                    </html>
                    "#,
                    user_info.email
                )));
            }
            Ok(false) => {
                // 新規登録
                if let Err(e) = state.database.register_user(&user_info.id, &user_info.email, &user_info.name).await {
                    warn!("Failed to register user: {:?}", e);
                    return Err(StatusCode::INTERNAL_SERVER_ERROR);
                }
                info!("New user registered: {}", user_info.email);
            }
            Err(e) => {
                warn!("Database error during registration check: {:?}", e);
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
        }
    } else {
        // ログイン処理 - 登録済みかチェック
        match state.database.is_user_registered(&user_info.email).await {
            Ok(false) => {
                // 未登録の場合はエラー
                return Ok(Html(format!(
                    r#"
                    <html>
                    <head><title>Login Error</title></head>
                    <body>
                        <h1>ログインエラー</h1>
                        <p>このアカウント（{}）は登録されていません。</p>
                        <p><a href="/register">新規登録ページへ</a></p>
                    </body>
                    </html>
                    "#,
                    user_info.email
                )));
            }
            Ok(true) => {
                // 最終ログイン時刻を更新
                if let Err(e) = state.database.update_last_login(&user_info.email).await {
                    warn!("Failed to update last login: {:?}", e);
                }
            }
            Err(e) => {
                warn!("Database error during login check: {:?}", e);
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
        }
    }

    // セッション作成
    let session_id = Uuid::new_v4().to_string();
    let user_session = UserSession {
        user_id: user_info.id.clone(),
        email: user_info.email.clone(),
    };

    {
        let mut sessions = state.sessions.write().await;
        sessions.insert(session_id.clone(), user_session);
    }

    // API認証の場合のauth_token処理
    {
        let mut auth_tokens = state.auth_tokens.write().await;
        if state_parts.len() > 1 && auth_tokens.contains_key(auth_token) {
            auth_tokens.insert(auth_token.to_string(), Some(session_id.clone()));
        }
    }

    // stateパラメータがauth_tokenかどうかで判定
    let auth_tokens = state.auth_tokens.read().await;
    let is_api_auth = auth_tokens.contains_key(auth_token);
    drop(auth_tokens);
    
    if is_api_auth {
        // Discord通知を送信
        let notification_result = send_discord_notification(auth_token, &user_info.email).await;
        if let Err(e) = notification_result {
            warn!("Failed to send Discord notification: {:?}", e);
        }

        // API認証の場合はそのまま表示
        Ok(Html(format!(
            r#"
            <html>
            <head><title>{} Success</title></head>
            <body>
                <h1>{} Successful!</h1>
                <p>Welcome, {}!</p>
                <p><strong>API認証が完了しました。このウィンドウを閉じてください。</strong></p>
            </body>
            </html>
            "#,
            if is_registration { "Registration" } else { "Login" },
            if is_registration { "Registration" } else { "Login" },
            user_info.name
        )))
    } else {
        // 通常のWeb認証の場合はフロントエンドにリダイレクト
        let redirect_url = format!(
            "http://localhost:3000/callback?session_id={}&user_email={}",
            urlencoding::encode(&session_id),
            urlencoding::encode(&user_info.email)
        );
        
        Ok(Html(format!(
            r#"
            <html>
            <head>
                <title>Redirecting...</title>
                <script>
                    window.location.href = '{}';
                </script>
            </head>
            <body>
                <p>Redirecting to application...</p>
                <p>If you are not redirected automatically, <a href="{}">click here</a>.</p>
            </body>
            </html>
            "#,
            redirect_url, redirect_url
        )))
    }
}

#[derive(Deserialize)]
struct SessionQuery {
    session_id: String,
}

async fn protected(
    Query(query): Query<SessionQuery>,
    State(state): State<AppState>,
) -> Result<String, StatusCode> {
    let sessions = state.sessions.read().await;
    
    if let Some(session) = sessions.get(&query.session_id) {
        // セッションに対応するユーザーが登録済みかダブルチェック
        match state.database.is_user_registered(&session.email).await {
            Ok(true) => {
                Ok(format!(
                    "Hello {}! Here's your protected content: 'The Grand Library of Patchouli Knowledge awaits your exploration. May your quest for knowledge be fruitful and your discoveries illuminate the path ahead.'",
                    session.email
                ))
            }
            Ok(false) => {
                warn!("Session exists but user {} is not registered", session.email);
                Err(StatusCode::FORBIDDEN)
            }
            Err(e) => {
                warn!("Database error during protected access: {:?}", e);
                Err(StatusCode::INTERNAL_SERVER_ERROR)
            }
        }
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

async fn callback_api(
    Query(params): Query<AuthRequest>,
    State(state): State<AppState>,
) -> Result<Json<AuthResponse>, StatusCode> {
    let token_result = state
        .oauth_client
        .exchange_code(AuthorizationCode::new(params.code))
        .request_async(async_http_client)
        .await
        .map_err(|e| {
            warn!("Token exchange failed: {:?}", e);
            StatusCode::BAD_REQUEST
        })?;

    let access_token = token_result.access_token().secret().to_string();
    
    let client = reqwest::Client::new();
    let user_info: GoogleUserInfo = client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|e| {
            warn!("Failed to get user info: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?
        .json()
        .await
        .map_err(|e| {
            warn!("Failed to parse user info: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let session_id = Uuid::new_v4().to_string();
    let user_session = UserSession {
        user_id: user_info.id.clone(),
        email: user_info.email.clone(),
    };

    {
        let mut sessions = state.sessions.write().await;
        sessions.insert(session_id.clone(), user_session);
    }

    info!("User {} logged in successfully via API", user_info.email);

    Ok(Json(AuthResponse {
        session_id,
        user_email: user_info.email,
    }))
}

async fn login_api(State(state): State<AppState>) -> Json<AuthTokenResponse> {
    let auth_token = Uuid::new_v4().to_string();
    
    // auth_tokenをstateパラメータとして使用（CSRFトークンの代わり）
    let (auth_url, _csrf_token) = state
        .oauth_client
        .authorize_url(|| CsrfToken::new(auth_token.clone()))
        .add_scope(Scope::new("openid".to_string()))
        .add_scope(Scope::new("email".to_string()))
        .add_scope(Scope::new("profile".to_string()))
        .url();

    {
        let mut auth_tokens = state.auth_tokens.write().await;
        auth_tokens.insert(auth_token.clone(), None);
    }

    Json(AuthTokenResponse {
        auth_token: auth_token.clone(),
        login_url: auth_url.to_string(),
    })
}

async fn auth_status(
    Path(token): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<AuthStatusResponse>, StatusCode> {
    let auth_tokens = state.auth_tokens.read().await;
    
    if let Some(session_id_opt) = auth_tokens.get(&token) {
        if let Some(session_id) = session_id_opt {
            let sessions = state.sessions.read().await;
            if let Some(session) = sessions.get(session_id) {
                Ok(Json(AuthStatusResponse {
                    status: "completed".to_string(),
                    session_id: Some(session_id.clone()),
                    user_email: Some(session.email.clone()),
                }))
            } else {
                Ok(Json(AuthStatusResponse {
                    status: "error".to_string(),
                    session_id: None,
                    user_email: None,
                }))
            }
        } else {
            Ok(Json(AuthStatusResponse {
                status: "pending".to_string(),
                session_id: None,
                user_email: None,
            }))
        }
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

async fn logout(
    Query(query): Query<SessionQuery>,
    State(state): State<AppState>,
) -> Result<Html<&'static str>, StatusCode> {
    let mut sessions = state.sessions.write().await;
    
    if sessions.remove(&query.session_id).is_some() {
        info!("User logged out successfully");
        Ok(Html(r#"
            <html>
            <head><title>Logged Out</title></head>
            <body>
                <h1>Logged Out Successfully</h1>
                <p><a href="/">Return to Home</a></p>
            </body>
            </html>
        "#))
    } else {
        Err(StatusCode::BAD_REQUEST)
    }
}