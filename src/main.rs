mod config;
mod error;
mod handlers;
mod middleware;
mod repository;
mod routes;
mod state;

use config::AppConfig;
use middleware::cors_layer;
use routes::app_routes;
use tower_http::trace::TraceLayer;

#[tokio::main]
async fn main() {
    // Load .env if present (non-fatal if absent).
    let _ = dotenvy::dotenv();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_env("LOG_LEVEL")
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let config = AppConfig::from_env();
    let addr = config.socket_addr();

    let app_state: Option<std::sync::Arc<state::AppState>> = state::build_state(&config).await;

    let app = app_routes(app_state)
        .layer(cors_layer())
        .layer(TraceLayer::new_for_http());

    tracing::info!("Starting HTTP server on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("failed to bind address");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("server error");
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("Shutting down gracefully...");
}
