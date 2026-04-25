pub mod parse;
pub mod query;
pub mod validate;

use axum::Json;
use serde::Serialize;

pub use parse::parse_handler;
pub use query::query_handler;
pub use validate::validate_handler;

#[derive(Serialize)]
pub struct HealthResponse {
    status: &'static str,
    timestamp: String,
}

pub async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        timestamp: chrono_lite_timestamp(),
    })
}

fn chrono_lite_timestamp() -> String {
    use std::time::SystemTime;
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_default()
}
