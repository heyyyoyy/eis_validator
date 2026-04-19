use std::net::SocketAddr;

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub host: String,
    pub port: u16,
    #[allow(dead_code)]
    pub log_level: String,
}

impl AppConfig {
    pub fn from_env() -> Self {
        let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into());
        let port = std::env::var("PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(3000);
        let log_level = std::env::var("LOG_LEVEL").unwrap_or_else(|_| "info".into());

        Self {
            host,
            port,
            log_level,
        }
    }

    pub fn socket_addr(&self) -> SocketAddr {
        format!("{}:{}", self.host, self.port)
            .parse()
            .expect("invalid socket address")
    }
}
