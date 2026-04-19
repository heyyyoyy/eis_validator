use axum::routing::{get, post};
use axum::Router;

use crate::handlers;

pub fn app_routes() -> Router {
    Router::new()
        .route("/health", get(handlers::health))
        .route("/validate", post(handlers::validate_handler))
        .route("/parse", post(handlers::parse_handler))
}
