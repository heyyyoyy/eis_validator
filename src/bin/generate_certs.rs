use rcgen::{generate_simple_self_signed, CertifiedKey};
use std::fs;
use std::path::Path;

fn main() {
    let subject_alt_names: Vec<String> = {
        let args: Vec<String> = std::env::args().skip(1).collect();
        if args.is_empty() {
            vec!["localhost".to_string(), "127.0.0.1".to_string()]
        } else {
            args
        }
    };

    println!(
        "Generating self-signed certificate for SANs: {}",
        subject_alt_names.join(", ")
    );

    let CertifiedKey { cert, key_pair } =
        generate_simple_self_signed(subject_alt_names).expect("failed to generate certificate");

    let cert_pem = cert.pem();
    let key_pem = key_pair.serialize_pem();

    let certs_dir = Path::new("certs");
    fs::create_dir_all(certs_dir).expect("failed to create certs/ directory");

    let cert_path = certs_dir.join("cert.pem");
    let key_path = certs_dir.join("key.pem");

    fs::write(&cert_path, cert_pem).expect("failed to write cert.pem");
    fs::write(&key_path, key_pem).expect("failed to write key.pem");

    println!("Certificate written to: {}", cert_path.display());
    println!("Private key written to:  {}", key_path.display());
    println!();
    println!("Start the server with:");
    println!("  cargo run");
    println!();
    println!("Connect with:");
    println!("  curl -k https://127.0.0.1:3000/health");
}
