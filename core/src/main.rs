use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    middleware,
    response::{Json, IntoResponse},
    routing::{delete, get, post, put},
    Router,
};
mod database;
use database::Database;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use oauth2::{
    basic::BasicClient,
    reqwest::async_http_client,
    AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken, RedirectUrl, Scope,
    TokenResponse as OAuth2TokenResponse, TokenUrl,
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
    auth_pending: Arc<RwLock<HashMap<String, PendingAuth>>>,
    database: Database,
    jwt_secret: EncodingKey,
    jwt_decode_key: DecodingKey,
}

#[derive(Clone, Debug)]
struct PendingAuth {
    user_email: Option<String>,
    invite_code: Option<String>,
    is_registration: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Claims {
    sub: String, // user_id
    email: String,
    exp: usize,
    iat: usize,
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

// Request/Response DTOs
#[derive(Serialize)]
struct AuthTokenResponse {
    token: String,
    auth_url: String,
}

#[derive(Serialize)]
struct AccessTokenResponse {
    access_token: String,
    token_type: String,
    expires_in: u64,
    user: UserInfo,
}

#[derive(Serialize)]
struct UserInfo {
    id: String,
    email: String,
    name: String,
    is_root: bool,
    can_invite: bool,
}

#[derive(Deserialize)]
struct CreateTokenRequest {
    grant_type: String,
    code: Option<String>,
    state: Option<String>,
}

#[derive(Deserialize)]
struct CreateUserRequest {
    email: String,
    name: String,
    invite_code: Option<String>,
}

#[derive(Deserialize)]
struct UpdateUserRequest {
    name: Option<String>,
    can_invite: Option<bool>,
}

#[derive(Serialize)]
struct InviteResponse {
    id: String,
    code: String,
    created_at: String,
    created_by: i64,
    used_by: Option<i64>,
    used_at: Option<String>,
}

#[derive(Serialize)]
struct UserResponse {
    id: i64,
    email: String,
    name: String,
    google_id: String,
    is_root: bool,
    can_invite: bool,
    created_at: String,
    last_login: Option<String>,
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
    message: String,
}

#[derive(Serialize)]
struct SuccessResponse {
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
        .unwrap_or_else(|_| "http://localhost:8080/oauth/callback".to_string());
    let jwt_secret = std::env::var("JWT_SECRET")
        .unwrap_or_else(|_| "your-secret-key".to_string());

    let oauth_client = BasicClient::new(
        ClientId::new(google_client_id),
        Some(ClientSecret::new(google_client_secret)),
        AuthUrl::new("https://accounts.google.com/o/oauth2/auth".to_string())?,
        Some(TokenUrl::new("https://oauth2.googleapis.com/token".to_string())?),
    )
    .set_redirect_uri(RedirectUrl::new(redirect_url)?);

    let database = Database::new().await?;

    let jwt_decode_key = DecodingKey::from_secret(jwt_secret.as_bytes());

    let state = AppState {
        oauth_client,
        auth_pending: Arc::new(RwLock::new(HashMap::new())),
        database,
        jwt_secret: EncodingKey::from_secret(jwt_secret.as_bytes()),
        jwt_decode_key,
    };

    let app = Router::new()
        // Authentication endpoints
        .route("/auth/tokens", post(create_auth_token))
        .route("/auth/tokens", delete(delete_auth_token))
        .route("/oauth/callback", get(oauth_callback))
        
        // User management endpoints
        .route("/users", get(list_users))
        .route("/users", post(create_user))
        .route("/users/:id", get(get_user))
        .route("/users/:id", put(update_user))
        .route("/users/:id", delete(delete_user))
        
        // Invite management endpoints
        .route("/invites", get(list_invites))
        .route("/invites", post(create_invite))
        .route("/invites/:id", delete(delete_invite))
        
        // Protected content
        .route("/content", get(get_protected_content))
        
        // System status
        .route("/system/status", get(get_system_status))
        
        .layer(middleware::from_fn_with_state(state.clone(), auth_middleware))
        .with_state(state)
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http());

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    info!("RESTful Patchouli API Server running on http://0.0.0.0:8080");
    
    axum::serve(listener, app).await?;
    Ok(())
}

// Auth middleware
async fn auth_middleware(
    State(state): State<AppState>,
    headers: HeaderMap,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Result<axum::response::Response, StatusCode> {
    let path = request.uri().path();
    
    // Skip auth for public endpoints
    if path.starts_with("/auth/tokens") 
        || path.starts_with("/oauth/callback")
        || path.starts_with("/system/status")
        || (path == "/users" && request.method() == "POST") {
        return Ok(next.run(request).await);
    }

    // Extract and validate JWT token
    let auth_header = headers
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "));

    if let Some(token) = auth_header {
        match decode::<Claims>(token, &state.jwt_decode_key, &Validation::default()) {
            Ok(token_data) => {
                // Verify user still exists in database
                match state.database.get_user_by_email(&token_data.claims.email).await {
                    Ok(Some(_)) => {
                        // Add user info to request extensions
                        let mut request = request;
                        request.extensions_mut().insert(token_data.claims);
                        Ok(next.run(request).await)
                    }
                    _ => Err(StatusCode::UNAUTHORIZED),
                }
            }
            Err(_) => Err(StatusCode::UNAUTHORIZED),
        }
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

// Authentication endpoints
async fn create_auth_token(
    State(state): State<AppState>,
    Json(payload): Json<CreateTokenRequest>,
) -> Result<axum::response::Response, (StatusCode, Json<ErrorResponse>)> {
    match payload.grant_type.as_str() {
        "authorization_code" => {
            let code = payload.code.ok_or_else(|| {
                (StatusCode::BAD_REQUEST, Json(ErrorResponse {
                    error: "invalid_request".to_string(),
                    message: "code is required for authorization_code grant".to_string(),
                }))
            })?;
            
            let state_param = payload.state.ok_or_else(|| {
                (StatusCode::BAD_REQUEST, Json(ErrorResponse {
                    error: "invalid_request".to_string(),
                    message: "state is required".to_string(),
                }))
            })?;

            match handle_oauth_token_exchange(state, code, state_param).await {
                Ok(response) => Ok(response.into_response()),
                Err(err) => Err(err),
            }
        }
        "client_credentials" => {
            // Generate OAuth URL for client authentication
            let state_token = Uuid::new_v4().to_string();
            let csrf_token = CsrfToken::new(state_token.clone());
            
            let (auth_url, _) = state
                .oauth_client
                .authorize_url(|| csrf_token)
                .add_scope(Scope::new("openid".to_string()))
                .add_scope(Scope::new("email".to_string()))
                .add_scope(Scope::new("profile".to_string()))
                .url();

            // Store pending auth
            {
                let mut pending = state.auth_pending.write().await;
                pending.insert(state_token.clone(), PendingAuth {
                    user_email: None,
                    invite_code: None,
                    is_registration: false,
                });
            }

            Ok(Json(AuthTokenResponse {
                token: state_token,
                auth_url: auth_url.to_string(),
            }).into_response())
        }
        _ => Err((StatusCode::BAD_REQUEST, Json(ErrorResponse {
            error: "unsupported_grant_type".to_string(),
            message: "Only authorization_code and client_credentials grants are supported".to_string(),
        }))),
    }
}

async fn handle_oauth_token_exchange(
    state: AppState,
    code: String,
    state_param: String,
) -> Result<Json<AccessTokenResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Exchange OAuth code for access token
    let token_result = state
        .oauth_client
        .exchange_code(AuthorizationCode::new(code))
        .request_async(async_http_client)
        .await
        .map_err(|e| {
            warn!("Token exchange failed: {:?}", e);
            (StatusCode::BAD_REQUEST, Json(ErrorResponse {
                error: "invalid_grant".to_string(),
                message: "Failed to exchange authorization code".to_string(),
            }))
        })?;

    let access_token = token_result.access_token().secret().to_string();
    
    // Get user info from Google
    let client = reqwest::Client::new();
    let user_info: GoogleUserInfo = client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|e| {
            warn!("Failed to get user info: {:?}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
                error: "server_error".to_string(),
                message: "Failed to retrieve user information".to_string(),
            }))
        })?
        .json()
        .await
        .map_err(|e| {
            warn!("Failed to parse user info: {:?}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
                error: "server_error".to_string(),
                message: "Failed to parse user information".to_string(),
            }))
        })?;

    // Check if user is registered
    let user = state.database.get_user_by_email(&user_info.email).await
        .map_err(|e| {
            warn!("Database error: {:?}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
                error: "server_error".to_string(),
                message: "Database error".to_string(),
            }))
        })?;

    let user = user.ok_or_else(|| {
        (StatusCode::UNAUTHORIZED, Json(ErrorResponse {
            error: "user_not_found".to_string(),
            message: "User is not registered".to_string(),
        }))
    })?;

    // Update last login
    if let Err(e) = state.database.update_last_login(&user_info.email).await {
        warn!("Failed to update last login: {:?}", e);
    }

    // Generate JWT token
    let now = chrono::Utc::now();
    let claims = Claims {
        sub: user.id.to_string(),
        email: user.email.clone(),
        exp: (now + chrono::Duration::hours(24)).timestamp() as usize,
        iat: now.timestamp() as usize,
    };

    let jwt_token = encode(&Header::default(), &claims, &state.jwt_secret)
        .map_err(|e| {
            warn!("Failed to create JWT: {:?}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
                error: "server_error".to_string(),
                message: "Failed to create authentication token".to_string(),
            }))
        })?;

    info!("User {} authenticated successfully", user.email);

    Ok(Json(AccessTokenResponse {
        access_token: jwt_token,
        token_type: "Bearer".to_string(),
        expires_in: 86400, // 24 hours
        user: UserInfo {
            id: user.id.to_string(),
            email: user.email,
            name: user.name,
            is_root: user.is_root,
            can_invite: user.can_invite,
        },
    }))
}

async fn delete_auth_token(
    headers: HeaderMap,
) -> Result<Json<SuccessResponse>, (StatusCode, Json<ErrorResponse>)> {
    // In stateless JWT system, we just return success
    // Token will expire naturally or client should discard it
    Ok(Json(SuccessResponse {
        success: true,
        message: "Token invalidated".to_string(),
    }))
}

async fn oauth_callback(
    Query(params): Query<AuthRequest>,
    State(state): State<AppState>,
) -> Result<Json<AccessTokenResponse>, (StatusCode, Json<ErrorResponse>)> {
    handle_oauth_token_exchange(state, params.code, params.state).await
}

// User management endpoints
async fn list_users(
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<Claims>,
) -> Result<Json<Vec<UserResponse>>, (StatusCode, Json<ErrorResponse>)> {
    let user = state.database.get_user_by_email(&claims.email).await
        .map_err(|e| {
            warn!("Database error: {:?}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
                error: "server_error".to_string(),
                message: "Database error".to_string(),
            }))
        })?
        .ok_or_else(|| {
            (StatusCode::UNAUTHORIZED, Json(ErrorResponse {
                error: "unauthorized".to_string(),
                message: "User not found".to_string(),
            }))
        })?;

    if !user.is_root {
        return Err((StatusCode::FORBIDDEN, Json(ErrorResponse {
            error: "forbidden".to_string(),
            message: "Only root users can list all users".to_string(),
        })));
    }

    let users = state.database.get_all_registered_users().await
        .map_err(|e| {
            warn!("Failed to get users: {:?}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
                error: "server_error".to_string(),
                message: "Failed to retrieve users".to_string(),
            }))
        })?;

    let user_responses: Vec<UserResponse> = users.into_iter().map(|u| UserResponse {
        id: u.id,
        email: u.email,
        name: u.name,
        google_id: u.google_id,
        is_root: u.is_root,
        can_invite: u.can_invite,
        created_at: u.created_at.to_string(),
        last_login: u.last_login.map(|dt| dt.to_string()),
    }).collect();

    Ok(Json(user_responses))
}

async fn create_user(
    State(state): State<AppState>,
    Json(payload): Json<CreateUserRequest>,
) -> Result<Json<UserResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Check if this is the first user (root user creation)
    let user_count = state.database.count_registered_users().await
        .map_err(|e| {
            warn!("Database error: {:?}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
                error: "server_error".to_string(),
                message: "Database error".to_string(),
            }))
        })?;

    if user_count == 0 {
        // First user - create root user without invite code
        let user = state.database.register_user("temp_google_id", &payload.email, &payload.name).await
            .map_err(|e| {
                warn!("Failed to create root user: {:?}", e);
                (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
                    error: "server_error".to_string(),
                    message: "Failed to create root user".to_string(),
                }))
            })?;

        Ok(Json(UserResponse {
            id: user.id,
            email: user.email,
            name: user.name,
            google_id: user.google_id,
            is_root: user.is_root,
            can_invite: user.can_invite,
            created_at: user.created_at.to_string(),
            last_login: user.last_login.map(|dt| dt.to_string()),
        }))
    } else {
        // Subsequent users require invite code
        let invite_code = payload.invite_code.ok_or_else(|| {
            (StatusCode::BAD_REQUEST, Json(ErrorResponse {
                error: "invalid_request".to_string(),
                message: "Invite code is required for new user registration".to_string(),
            }))
        })?;

        let invite = state.database.validate_invite_code(&invite_code).await
            .map_err(|e| {
                warn!("Database error during invite validation: {:?}", e);
                (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
                    error: "server_error".to_string(),
                    message: "Database error".to_string(),
                }))
            })?
            .ok_or_else(|| {
                (StatusCode::BAD_REQUEST, Json(ErrorResponse {
                    error: "invalid_invite".to_string(),
                    message: "Invalid or expired invite code".to_string(),
                }))
            })?;

        let user = state.database.register_invited_user("temp_google_id", &payload.email, &payload.name, invite.created_by).await
            .map_err(|e| {
                warn!("Failed to create invited user: {:?}", e);
                (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
                    error: "server_error".to_string(),
                    message: "Failed to create user".to_string(),
                }))
            })?;

        // Mark invite as used
        if let Err(e) = state.database.use_invite_code(&invite_code, user.id).await {
            warn!("Failed to mark invite as used: {:?}", e);
        }

        Ok(Json(UserResponse {
            id: user.id,
            email: user.email,
            name: user.name,
            google_id: user.google_id,
            is_root: user.is_root,
            can_invite: user.can_invite,
            created_at: user.created_at.to_string(),
            last_login: user.last_login.map(|dt| dt.to_string()),
        }))
    }
}

async fn get_user(
    Path(user_id): Path<String>,
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<Claims>,
) -> Result<Json<UserResponse>, (StatusCode, Json<ErrorResponse>)> {
    let requesting_user = state.database.get_user_by_email(&claims.email).await
        .map_err(|e| {
            warn!("Database error: {:?}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
                error: "server_error".to_string(),
                message: "Database error".to_string(),
            }))
        })?
        .ok_or_else(|| {
            (StatusCode::UNAUTHORIZED, Json(ErrorResponse {
                error: "unauthorized".to_string(),
                message: "User not found".to_string(),
            }))
        })?;

    let target_user_id = user_id.parse::<i64>()
        .map_err(|_| {
            (StatusCode::BAD_REQUEST, Json(ErrorResponse {
                error: "invalid_request".to_string(),
                message: "Invalid user ID".to_string(),
            }))
        })?;

    // Users can only access their own info unless they're root
    if !requesting_user.is_root && requesting_user.id != target_user_id {
        return Err((StatusCode::FORBIDDEN, Json(ErrorResponse {
            error: "forbidden".to_string(),
            message: "You can only access your own user information".to_string(),
        })));
    }

    let user = state.database.get_user_by_id(target_user_id).await
        .map_err(|e| {
            warn!("Database error: {:?}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
                error: "server_error".to_string(),
                message: "Database error".to_string(),
            }))
        })?
        .ok_or_else(|| {
            (StatusCode::NOT_FOUND, Json(ErrorResponse {
                error: "user_not_found".to_string(),
                message: "User not found".to_string(),
            }))
        })?;

    Ok(Json(UserResponse {
        id: user.id,
        email: user.email,
        name: user.name,
        google_id: user.google_id,
        is_root: user.is_root,
        can_invite: user.can_invite,
        created_at: user.created_at.to_string(),
        last_login: user.last_login.map(|dt| dt.to_string()),
    }))
}

async fn update_user(
    Path(user_id): Path<String>,
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<Claims>,
    Json(payload): Json<UpdateUserRequest>,
) -> Result<Json<UserResponse>, (StatusCode, Json<ErrorResponse>)> {
    let requesting_user = state.database.get_user_by_email(&claims.email).await
        .map_err(|e| {
            warn!("Database error: {:?}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
                error: "server_error".to_string(),
                message: "Database error".to_string(),
            }))
        })?
        .ok_or_else(|| {
            (StatusCode::UNAUTHORIZED, Json(ErrorResponse {
                error: "unauthorized".to_string(),
                message: "User not found".to_string(),
            }))
        })?;

    let target_user_id = user_id.parse::<i64>()
        .map_err(|_| {
            (StatusCode::BAD_REQUEST, Json(ErrorResponse {
                error: "invalid_request".to_string(),
                message: "Invalid user ID".to_string(),
            }))
        })?;

    // Only root users can update other users' permissions
    if payload.can_invite.is_some() && (!requesting_user.is_root || requesting_user.id == target_user_id) {
        return Err((StatusCode::FORBIDDEN, Json(ErrorResponse {
            error: "forbidden".to_string(),
            message: "Only root users can update permissions, and cannot update their own permissions".to_string(),
        })));
    }

    // Users can only update their own name unless they're root
    if payload.name.is_some() && !requesting_user.is_root && requesting_user.id != target_user_id {
        return Err((StatusCode::FORBIDDEN, Json(ErrorResponse {
            error: "forbidden".to_string(),
            message: "You can only update your own information".to_string(),
        })));
    }

    // Get current user data
    let mut user = state.database.get_user_by_id(target_user_id).await
        .map_err(|e| {
            warn!("Database error: {:?}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
                error: "server_error".to_string(),
                message: "Database error".to_string(),
            }))
        })?
        .ok_or_else(|| {
            (StatusCode::NOT_FOUND, Json(ErrorResponse {
                error: "user_not_found".to_string(),
                message: "User not found".to_string(),
            }))
        })?;

    // Update fields
    if let Some(name) = payload.name {
        user.name = name;
    }
    if let Some(can_invite) = payload.can_invite {
        user.can_invite = can_invite;
    }

    // TODO: Implement database update method
    // For now, return the user as-is
    Ok(Json(UserResponse {
        id: user.id,
        email: user.email,
        name: user.name,
        google_id: user.google_id,
        is_root: user.is_root,
        can_invite: user.can_invite,
        created_at: user.created_at.to_string(),
        last_login: user.last_login.map(|dt| dt.to_string()),
    }))
}

async fn delete_user(
    Path(user_id): Path<String>,
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<Claims>,
) -> Result<Json<SuccessResponse>, (StatusCode, Json<ErrorResponse>)> {
    let requesting_user = state.database.get_user_by_email(&claims.email).await
        .map_err(|e| {
            warn!("Database error: {:?}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
                error: "server_error".to_string(),
                message: "Database error".to_string(),
            }))
        })?
        .ok_or_else(|| {
            (StatusCode::UNAUTHORIZED, Json(ErrorResponse {
                error: "unauthorized".to_string(),
                message: "User not found".to_string(),
            }))
        })?;

    if !requesting_user.is_root {
        return Err((StatusCode::FORBIDDEN, Json(ErrorResponse {
            error: "forbidden".to_string(),
            message: "Only root users can delete users".to_string(),
        })));
    }

    let target_user_id = user_id.parse::<i64>()
        .map_err(|_| {
            (StatusCode::BAD_REQUEST, Json(ErrorResponse {
                error: "invalid_request".to_string(),
                message: "Invalid user ID".to_string(),
            }))
        })?;

    // Prevent self-deletion
    if requesting_user.id == target_user_id {
        return Err((StatusCode::BAD_REQUEST, Json(ErrorResponse {
            error: "invalid_request".to_string(),
            message: "Cannot delete your own account".to_string(),
        })));
    }

    let success = state.database.delete_user(target_user_id).await
        .map_err(|e| {
            warn!("Failed to delete user: {:?}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
                error: "server_error".to_string(),
                message: "Failed to delete user".to_string(),
            }))
        })?;

    if success {
        info!("User {} deleted user ID {}", requesting_user.email, target_user_id);
        Ok(Json(SuccessResponse {
            success: true,
            message: "User deleted successfully".to_string(),
        }))
    } else {
        Err((StatusCode::NOT_FOUND, Json(ErrorResponse {
            error: "user_not_found".to_string(),
            message: "User not found or cannot be deleted".to_string(),
        })))
    }
}

// Invite management endpoints
async fn list_invites(
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<Claims>,
) -> Result<Json<Vec<InviteResponse>>, (StatusCode, Json<ErrorResponse>)> {
    let user = state.database.get_user_by_email(&claims.email).await
        .map_err(|e| {
            warn!("Database error: {:?}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
                error: "server_error".to_string(),
                message: "Database error".to_string(),
            }))
        })?
        .ok_or_else(|| {
            (StatusCode::UNAUTHORIZED, Json(ErrorResponse {
                error: "unauthorized".to_string(),
                message: "User not found".to_string(),
            }))
        })?;

    if !user.can_invite {
        return Err((StatusCode::FORBIDDEN, Json(ErrorResponse {
            error: "forbidden".to_string(),
            message: "You don't have permission to view invites".to_string(),
        })));
    }

    let invites = state.database.get_invite_codes_by_user(user.id).await
        .map_err(|e| {
            warn!("Failed to get invites: {:?}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
                error: "server_error".to_string(),
                message: "Failed to retrieve invites".to_string(),
            }))
        })?;

    let invite_responses: Vec<InviteResponse> = invites.into_iter().map(|i| InviteResponse {
        id: i.id.to_string(),
        code: i.code,
        created_at: i.created_at.to_string(),
        created_by: i.created_by,
        used_by: i.used_by,
        used_at: i.used_at.map(|dt| dt.to_string()),
    }).collect();

    Ok(Json(invite_responses))
}

async fn create_invite(
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<Claims>,
) -> Result<Json<InviteResponse>, (StatusCode, Json<ErrorResponse>)> {
    let user = state.database.get_user_by_email(&claims.email).await
        .map_err(|e| {
            warn!("Database error: {:?}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
                error: "server_error".to_string(),
                message: "Database error".to_string(),
            }))
        })?
        .ok_or_else(|| {
            (StatusCode::UNAUTHORIZED, Json(ErrorResponse {
                error: "unauthorized".to_string(),
                message: "User not found".to_string(),
            }))
        })?;

    if !user.can_invite {
        return Err((StatusCode::FORBIDDEN, Json(ErrorResponse {
            error: "forbidden".to_string(),
            message: "You don't have permission to create invites".to_string(),
        })));
    }

    let invite = state.database.create_invite_code(user.id).await
        .map_err(|e| {
            warn!("Failed to create invite: {:?}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
                error: "server_error".to_string(),
                message: "Failed to create invite".to_string(),
            }))
        })?;

    info!("Invite created by user {}: {}", user.email, invite.code);

    Ok(Json(InviteResponse {
        id: invite.id.to_string(),
        code: invite.code,
        created_at: invite.created_at.to_string(),
        created_by: invite.created_by,
        used_by: invite.used_by,
        used_at: invite.used_at.map(|dt| dt.to_string()),
    }))
}

async fn delete_invite(
    Path(invite_id): Path<String>,
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<Claims>,
) -> Result<Json<SuccessResponse>, (StatusCode, Json<ErrorResponse>)> {
    let user = state.database.get_user_by_email(&claims.email).await
        .map_err(|e| {
            warn!("Database error: {:?}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
                error: "server_error".to_string(),
                message: "Database error".to_string(),
            }))
        })?
        .ok_or_else(|| {
            (StatusCode::UNAUTHORIZED, Json(ErrorResponse {
                error: "unauthorized".to_string(),
                message: "User not found".to_string(),
            }))
        })?;

    if !user.can_invite {
        return Err((StatusCode::FORBIDDEN, Json(ErrorResponse {
            error: "forbidden".to_string(),
            message: "You don't have permission to delete invites".to_string(),
        })));
    }

    // TODO: Implement delete invite in database
    // For now, return success
    Ok(Json(SuccessResponse {
        success: true,
        message: "Invite deleted successfully".to_string(),
    }))
}

// Protected content
async fn get_protected_content(
    axum::Extension(claims): axum::Extension<Claims>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    Ok(Json(serde_json::json!({
        "message": format!(
            "Hello {}! Here's your protected content: 'The Grand Library of Patchouli Knowledge awaits your exploration. May your quest for knowledge be fruitful and your discoveries illuminate the path ahead.'",
            claims.email
        ),
        "user": claims.email,
        "timestamp": chrono::Utc::now().to_rfc3339()
    })))
}

// System status
async fn get_system_status(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let user_count = state.database.count_registered_users().await
        .map_err(|e| {
            warn!("Database error: {:?}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
                error: "server_error".to_string(),
                message: "Database error".to_string(),
            }))
        })?;

    Ok(Json(serde_json::json!({
        "status": "healthy",
        "version": "1.0.0",
        "users_registered": user_count,
        "root_user_exists": user_count > 0,
        "timestamp": chrono::Utc::now().to_rfc3339()
    })))
}