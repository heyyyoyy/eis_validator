use std::sync::Arc;

use axum::routing::{get, post};
use axum::Router;

use crate::handlers;
use crate::state::AppState;

pub fn app_routes(state: Option<Arc<AppState>>) -> Router {
    Router::new()
        .route("/health", get(handlers::health))
        .route("/validate", post(handlers::validate_handler))
        .route("/parse", post(handlers::parse_handler))
        .route("/query", post(handlers::query_handler))
        .with_state(state)
}
