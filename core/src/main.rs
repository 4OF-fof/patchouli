use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{Html, Json, Redirect},
    routing::get,
    Router,
};
mod database;
use database::{Database, InviteCode, RegisteredUser};
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

#[derive(Serialize)]
struct InviteCodeResponse {
    invite_code: String,
    invite_url: String,
}

#[derive(Serialize)]
struct InviteCodesListResponse {
    invite_codes: Vec<InviteCode>,
}

#[derive(Serialize)]
struct UsersListResponse {
    users: Vec<RegisteredUser>,
}

#[derive(Serialize)]
struct DeleteUserResponse {
    success: bool,
    message: String,
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
        .route("/invite/create", get(create_invite))
        .route("/invite/list", get(list_invites))
        .route("/admin/users", get(list_users))
        .route("/admin/users/:user_id", 
               axum::routing::delete(delete_user).options(|| async { StatusCode::OK }))
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
    info!("Login request received with query params: {:?}", query);
    let is_registration = query.get("register").map(|v| v == "true").unwrap_or(false);
    let invite_code = query.get("invite").cloned();
    info!("Parsed login params: is_registration={}, invite_code={:?}", is_registration, invite_code);
    
    let csrf_state = if let Some(token) = query.get("token") {
        // API認証用のトークンが指定された場合はそれをstateに使用
        let state_suffix = if is_registration { "register" } else { "login" };
        let state_with_invite = if let Some(ref code) = invite_code {
            format!("{}:{}:{}", token, state_suffix, code)
        } else {
            format!("{}:{}", token, state_suffix)
        };
        CsrfToken::new(state_with_invite)
    } else {
        // 通常のWeb認証の場合はランダムなCSRFトークンを生成
        let state_suffix = if is_registration { "register" } else { "login" };
        let state_with_invite = if let Some(ref code) = invite_code {
            format!("{}:{}", state_suffix, code)
        } else {
            state_suffix.to_string()
        };
        CsrfToken::new(state_with_invite)
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

    // stateパラメータから登録かログインか、招待コードを判定
    let state_parts: Vec<&str> = params.state.split(':').collect();
    info!("State parameter received: '{}', parts: {:?}", params.state, state_parts);
    
    // Web認証とAPI認証を区別して処理
    let (is_registration, auth_token_str, invite_code) = if state_parts.len() >= 3 {
        // API認証の場合: "token:register:invite_code" または "token:login"
        let is_reg = state_parts.get(1).map(|&s| s == "register").unwrap_or(false);
        let token = state_parts[0].to_string();
        let invite = if state_parts.len() >= 3 { Some(state_parts[2]) } else { None };
        (is_reg, token, invite)
    } else if state_parts.len() == 2 {
        // Web認証の場合: "register:invite_code" または "login" または "register"
        if state_parts[0] == "register" || state_parts[0] == "login" {
            let is_reg = state_parts[0] == "register";
            let invite = if state_parts.len() == 2 { Some(state_parts[1]) } else { None };
            (is_reg, params.state.clone(), invite)
        } else {
            // API認証だが招待コードなし: "token:register" または "token:login"
            let is_reg = state_parts.get(1).map(|&s| s == "register").unwrap_or(false);
            let token = state_parts[0].to_string();
            (is_reg, token, None)
        }
    } else {
        // 単純なケース: "register" または "login"
        let is_reg = params.state == "register";
        (is_reg, params.state.clone(), None)
    };
    
    let auth_token = &auth_token_str;
    
    info!("Parsed: is_registration={}, auth_token='{}', invite_code={:?}", 
          is_registration, auth_token, invite_code);

    // 登録成功フラグ
    let mut registration_successful = false;
    
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
                // 新規登録時の招待コード検証
                let user_count = match state.database.count_registered_users().await {
                    Ok(count) => count,
                    Err(e) => {
                        warn!("Database error during user count: {:?}", e);
                        return Err(StatusCode::INTERNAL_SERVER_ERROR);
                    }
                };

                // 最初のユーザー以外は招待コードが必要
                if user_count > 0 {
                    match invite_code {
                        Some(code) => {
                            // 招待コードを検証
                            match state.database.validate_invite_code(code).await {
                                Ok(Some(invite)) => {
                                    info!("Valid invite code used: {}", code);
                                    // 招待による新規登録
                                    let registered_user = match state.database.register_invited_user(&user_info.id, &user_info.email, &user_info.name, invite.created_by).await {
                                        Ok(user) => user,
                                        Err(e) => {
                                            warn!("Failed to register invited user: {:?}", e);
                                            return Err(StatusCode::INTERNAL_SERVER_ERROR);
                                        }
                                    };
                                    // 招待コードを使用済みにマーク
                                    if let Err(e) = state.database.use_invite_code(code, registered_user.id).await {
                                        warn!("Failed to mark invite code as used: {:?}", e);
                                    }
                                    info!("New user registered with invite: {}", user_info.email);
                                    registration_successful = true;
                                }
                                Ok(None) => {
                                    // 無効な招待コード
                                    return Ok(Html(format!(
                                        r#"
                                        <html>
                                        <head><title>Registration Error</title></head>
                                        <body>
                                            <h1>登録エラー</h1>
                                            <p>無効な招待コードです。</p>
                                            <p><a href="/login">ログインページに戻る</a></p>
                                        </body>
                                        </html>
                                        "#
                                    )));
                                }
                                Err(e) => {
                                    warn!("Database error during invite validation: {:?}", e);
                                    return Err(StatusCode::INTERNAL_SERVER_ERROR);
                                }
                            }
                        }
                        None => {
                            // 招待コードなしでの登録は拒否
                            return Ok(Html(format!(
                                r#"
                                <html>
                                <head><title>Registration Error</title></head>
                                <body>
                                    <h1>登録エラー</h1>
                                    <p>新規登録には招待コードが必要です。</p>
                                    <p><a href="/login">ログインページに戻る</a></p>
                                </body>
                                </html>
                                "#
                            )));
                        }
                    }
                } else {
                    // 最初のユーザーは招待コードなしで登録可能
                    if let Err(e) = state.database.register_user(&user_info.id, &user_info.email, &user_info.name).await {
                        warn!("Failed to register first user: {:?}", e);
                        return Err(StatusCode::INTERNAL_SERVER_ERROR);
                    }
                    info!("First user registered: {}", user_info.email);
                    registration_successful = true;
                }
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

    // 登録が成功した場合は、再度登録済みかチェック（ダブルチェック）
    if registration_successful {
        match state.database.is_user_registered(&user_info.email).await {
            Ok(false) => {
                warn!("Registration marked successful but user not found in database: {}", user_info.email);
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
            Ok(true) => {
                info!("Registration confirmed in database for user: {}", user_info.email);
            }
            Err(e) => {
                warn!("Database error during registration confirmation: {:?}", e);
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

async fn create_invite(
    Query(query): Query<SessionQuery>,
    State(state): State<AppState>,
) -> Result<Json<InviteCodeResponse>, StatusCode> {
    let sessions = state.sessions.read().await;
    
    if let Some(session) = sessions.get(&query.session_id) {
        // ユーザーIDを取得
        let user = match state.database.get_user_by_email(&session.email).await {
            Ok(Some(user)) => user,
            Ok(None) => return Err(StatusCode::FORBIDDEN),
            Err(e) => {
                warn!("Database error during invite creation: {:?}", e);
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
        };

        // rootユーザーのみ招待コード作成可能
        if !user.can_invite {
            warn!("User {} attempted to create invite code without permission", user.email);
            return Err(StatusCode::FORBIDDEN);
        }

        // 招待コードを作成
        match state.database.create_invite_code(user.id).await {
            Ok(invite) => {
                let frontend_url = std::env::var("FRONTEND_URL")
                    .unwrap_or_else(|_| "http://localhost:3000".to_string());
                let invite_url = format!("{}/login?register=true&invite={}", frontend_url, invite.code);
                
                info!("Invite code created by user {}: {}", session.email, invite.code);
                
                Ok(Json(InviteCodeResponse {
                    invite_code: invite.code,
                    invite_url,
                }))
            }
            Err(e) => {
                warn!("Failed to create invite code: {:?}", e);
                Err(StatusCode::INTERNAL_SERVER_ERROR)
            }
        }
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

async fn list_invites(
    Query(query): Query<SessionQuery>,
    State(state): State<AppState>,
) -> Result<Json<InviteCodesListResponse>, StatusCode> {
    let sessions = state.sessions.read().await;
    
    if let Some(session) = sessions.get(&query.session_id) {
        // ユーザーIDを取得
        let user = match state.database.get_user_by_email(&session.email).await {
            Ok(Some(user)) => user,
            Ok(None) => return Err(StatusCode::FORBIDDEN),
            Err(e) => {
                warn!("Database error during invite list: {:?}", e);
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
        };

        // ユーザーが作成した招待コードを取得
        match state.database.get_invite_codes_by_user(user.id).await {
            Ok(invite_codes) => {
                Ok(Json(InviteCodesListResponse {
                    invite_codes,
                }))
            }
            Err(e) => {
                warn!("Failed to get invite codes: {:?}", e);
                Err(StatusCode::INTERNAL_SERVER_ERROR)
            }
        }
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

async fn list_users(
    Query(query): Query<SessionQuery>,
    State(state): State<AppState>,
) -> Result<Json<UsersListResponse>, StatusCode> {
    let sessions = state.sessions.read().await;
    
    if let Some(session) = sessions.get(&query.session_id) {
        // ユーザー情報を取得
        let user = match state.database.get_user_by_email(&session.email).await {
            Ok(Some(user)) => user,
            Ok(None) => return Err(StatusCode::FORBIDDEN),
            Err(e) => {
                warn!("Database error during user list: {:?}", e);
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
        };

        // rootユーザーのみアクセス可能
        if !user.is_root {
            warn!("User {} attempted to access user list without root permission", user.email);
            return Err(StatusCode::FORBIDDEN);
        }

        // 全ユーザーを取得
        match state.database.get_all_registered_users().await {
            Ok(users) => {
                info!("Root user {} accessed user list", user.email);
                Ok(Json(UsersListResponse { users }))
            }
            Err(e) => {
                warn!("Failed to get users list: {:?}", e);
                Err(StatusCode::INTERNAL_SERVER_ERROR)
            }
        }
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

async fn delete_user(
    Path(user_id): Path<String>,
    Query(query): Query<SessionQuery>,
    State(state): State<AppState>,
) -> Result<Json<DeleteUserResponse>, StatusCode> {
    info!("Delete user request received: user_id={}, session_id={}", user_id, query.session_id);
    let sessions = state.sessions.read().await;
    
    if let Some(session) = sessions.get(&query.session_id) {
        // ユーザー情報を取得
        let user = match state.database.get_user_by_email(&session.email).await {
            Ok(Some(user)) => user,
            Ok(None) => return Err(StatusCode::FORBIDDEN),
            Err(e) => {
                warn!("Database error during user deletion: {:?}", e);
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
        };

        // rootユーザーのみアクセス可能
        if !user.is_root {
            warn!("User {} attempted to delete user without root permission", user.email);
            return Err(StatusCode::FORBIDDEN);
        }

        // ユーザーIDを数値に変換
        let target_user_id = match user_id.parse::<i64>() {
            Ok(id) => id,
            Err(_) => {
                return Ok(Json(DeleteUserResponse {
                    success: false,
                    message: "無効なユーザーIDです".to_string(),
                }));
            }
        };

        // 自分自身の削除を防ぐ
        if target_user_id == user.id {
            return Ok(Json(DeleteUserResponse {
                success: false,
                message: "自分自身は削除できません".to_string(),
            }));
        }

        // ユーザーを削除
        info!("Attempting to delete user ID: {}", target_user_id);
        match state.database.delete_user(target_user_id).await {
            Ok(true) => {
                info!("Root user {} successfully deleted user ID {}", user.email, target_user_id);
                
                Ok(Json(DeleteUserResponse {
                    success: true,
                    message: "ユーザーが正常に削除されました".to_string(),
                }))
            }
            Ok(false) => {
                warn!("Delete operation returned false for user ID: {}", target_user_id);
                Ok(Json(DeleteUserResponse {
                    success: false,
                    message: "ユーザーが見つからないか、rootユーザーは削除できません".to_string(),
                }))
            }
            Err(e) => {
                warn!("Database error during user deletion - ID: {}, Error: {:?}", target_user_id, e);
                Ok(Json(DeleteUserResponse {
                    success: false,
                    message: format!("削除中にデータベースエラーが発生しました: {}", e),
                }))
            }
        }
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}