use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{Html, Redirect},
    routing::get,
    Router,
};
use oauth2::{
    basic::BasicClient,
    reqwest::async_http_client,
    AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken, RedirectUrl, Scope,
    TokenResponse, TokenUrl,
};
use serde::Deserialize;
use std::{collections::HashMap, sync::Arc};
use tokio::sync::RwLock;
use tower_http::trace::TraceLayer;
use tracing::{info, warn};
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    oauth_client: BasicClient,
    sessions: Arc<RwLock<HashMap<String, UserSession>>>,
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

    let state = AppState {
        oauth_client,
        sessions: Arc::new(RwLock::new(HashMap::new())),
    };

    let app = Router::new()
        .route("/", get(index))
        .route("/login", get(login))
        .route("/callback", get(callback))
        .route("/protected", get(protected))
        .route("/logout", get(logout))
        .with_state(state)
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

async fn login(State(state): State<AppState>) -> Redirect {
    let (auth_url, _csrf_token) = state
        .oauth_client
        .authorize_url(CsrfToken::new_random)
        .add_scope(Scope::new("openid".to_string()))
        .add_scope(Scope::new("email".to_string()))
        .add_scope(Scope::new("profile".to_string()))
        .url();

    Redirect::permanent(&auth_url.to_string())
}

async fn callback(
    Query(params): Query<AuthRequest>,
    State(state): State<AppState>,
) -> Result<Html<String>, StatusCode> {
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

    info!("User {} logged in successfully", user_info.email);

    Ok(Html(format!(
        r#"
        <html>
        <head><title>Login Success</title></head>
        <body>
            <h1>Login Successful!</h1>
            <p>Welcome, {}!</p>
            <p>Your session ID: {}</p>
            <p><a href="/protected?session_id={}">Access Protected Resource</a></p>
            <p><a href="/logout?session_id={}">Logout</a></p>
        </body>
        </html>
        "#,
        user_info.name, session_id, session_id, session_id
    )))
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
        Ok(format!(
            "Hello {}! Here's your protected content: 'The Grand Library of Patchouli Knowledge awaits your exploration. May your quest for knowledge be fruitful and your discoveries illuminate the path ahead.'",
            session.email
        ))
    } else {
        Err(StatusCode::UNAUTHORIZED)
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