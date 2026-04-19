#!/bin/sh
set -e

CERTS_DIR="${CERTS_DIR:-/certs}"
DAYS="${CERT_DAYS:-365}"
SUBJECT="${CERT_SUBJECT:-/CN=localhost}"
SAN="${CERT_SAN:-DNS:localhost,DNS:frontend,IP:127.0.0.1}"

mkdir -p "$CERTS_DIR"

# Skip generation if valid certs already exist
if [ -f "$CERTS_DIR/cert.pem" ] && [ -f "$CERTS_DIR/key.pem" ]; then
    # Check if cert expires within the next 7 days
    if openssl x509 -checkend 604800 -noout -in "$CERTS_DIR/cert.pem" 2>/dev/null; then
        echo "Certificates already exist and are valid. Skipping generation."
        exit 0
    fi
    echo "Certificates exist but are expiring soon. Regenerating..."
fi

echo "Generating self-signed TLS certificate..."
echo "  Subject:  $SUBJECT"
echo "  SANs:     $SAN"
echo "  Validity: $DAYS days"
echo "  Output:   $CERTS_DIR"

openssl req -x509 \
    -newkey rsa:4096 \
    -keyout "$CERTS_DIR/key.pem" \
    -out "$CERTS_DIR/cert.pem" \
    -days "$DAYS" \
    -nodes \
    -subj "$SUBJECT" \
    -addext "subjectAltName=$SAN"

# Both files are readable by all processes in the container.
# The certs volume is internal to Docker's private bridge network and
# never bind-mounted to the host, so world-readable is safe here.
chmod 644 "$CERTS_DIR/cert.pem"
chmod 644 "$CERTS_DIR/key.pem"

echo "Done."
echo "  cert.pem -> $CERTS_DIR/cert.pem"
echo "  key.pem  -> $CERTS_DIR/key.pem"
