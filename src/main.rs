mod config;
mod error;
mod handlers;
mod middleware;
mod routes;

use axum_server::tls_rustls::RustlsConfig;
use config::AppConfig;
use middleware::cors_layer;
use routes::app_routes;
use tower_http::trace::TraceLayer;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let config = AppConfig::from_env();
    let addr = config.socket_addr();

    let app = app_routes()
        .layer(cors_layer())
        .layer(TraceLayer::new_for_http());

    let tls_config = RustlsConfig::from_pem_file(&config.tls_cert_path, &config.tls_key_path)
        .await
        .unwrap_or_else(|e| {
            panic!(
                "failed to load TLS certs ({} / {}): {e}\n\
                 Run `cargo run --bin generate_certs` first.",
                config.tls_cert_path, config.tls_key_path
            )
        });

    tracing::info!("Starting HTTPS server on {}", addr);

    let handle = axum_server::Handle::new();
    let shutdown_handle = handle.clone();
    tokio::spawn(async move {
        shutdown_signal().await;
        shutdown_handle.graceful_shutdown(Some(std::time::Duration::from_secs(5)));
    });

    axum_server::bind_rustls(addr, tls_config)
        .handle(handle)
        .serve(app.into_make_service())
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
