use axum::routing::get;
use axum::Router;

use crate::handlers;

pub fn app_routes() -> Router {
    Router::new().route("/health", get(handlers::health))
}
