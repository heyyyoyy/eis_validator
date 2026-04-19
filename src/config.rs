use std::net::SocketAddr;

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub host: String,
    pub port: u16,
    #[allow(dead_code)]
    pub log_level: String,
    pub tls_cert_path: String,
    pub tls_key_path: String,
}

impl AppConfig {
    pub fn from_env() -> Self {
        let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into());
        let port = std::env::var("PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(3000);
        let log_level = std::env::var("LOG_LEVEL").unwrap_or_else(|_| "info".into());
        let tls_cert_path =
            std::env::var("TLS_CERT").unwrap_or_else(|_| "certs/cert.pem".into());
        let tls_key_path =
            std::env::var("TLS_KEY").unwrap_or_else(|_| "certs/key.pem".into());

        Self {
            host,
            port,
            log_level,
            tls_cert_path,
            tls_key_path,
        }
    }

    pub fn socket_addr(&self) -> SocketAddr {
        format!("{}:{}", self.host, self.port)
            .parse()
            .expect("invalid socket address")
    }
}
