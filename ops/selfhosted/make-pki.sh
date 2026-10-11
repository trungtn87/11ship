#!/usr/bin/env bash
# make-pki.sh — creates the private CA and the PostgreSQL server certificate for the self-hosted staging database
# (M00-VPS-01). The server certificate names `localhost` (SAN DNS:localhost; deliberately NO IP address entry), because the
# backend and the operator tools connect to the host name localhost and verify the chain AND the host name.
#
#   sudo ./make-pki.sh /root/ship11-pki        # target directory must not exist yet
#
# Writes (mode 600 for keys, 644 for certificates): ca.key  ca.crt  server.key  server.crt
#   ca.crt      the CA the backend and the operator tools trust (DB_SSL_CA_FILE); public, not a secret
#   ca.key      KEEP OFFLINE after the server certificate is made (it can mint certificates this database would be trusted
#               under). Back it up with the other keys; it is not needed at runtime.
#   server.*    install server.crt / server.key into /etc/postgresql/17/main/tls/ (owner postgres, key mode 600)
# Validity: CA 3650 days, server certificate 825 days. Re-run into a NEW directory to rotate the server certificate; a new
# CA means every DB_SSL_CA_FILE copy must be replaced too.
# Prints only the SHA-256 fingerprints and the paths, never key material. Needs openssl 3.
set -euo pipefail
umask 077

dir="${1:-}"
if [ -z "$dir" ]; then
  echo "usage: $0 <new directory>" >&2
  exit 2
fi
if [ -e "$dir" ]; then
  echo "refused: $dir already exists (this script never overwrites a key or certificate)" >&2
  exit 1
fi
command -v openssl >/dev/null || { echo "refused: openssl is not installed" >&2; exit 1; }

mkdir -p "$dir"
cd "$dir"

openssl ecparam -name prime256v1 -genkey -noout -out ca.key
openssl req -x509 -new -key ca.key -sha256 -days 3650 \
  -subj "/CN=11ship staging PostgreSQL CA" \
  -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -out ca.crt

openssl ecparam -name prime256v1 -genkey -noout -out server.key
openssl req -new -key server.key -subj "/CN=localhost" -out server.csr
cat > server.ext <<'EXT'
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = serverAuth
subjectAltName = DNS:localhost
EXT
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -sha256 -days 825 -extfile server.ext -out server.crt
rm -f server.csr server.ext ca.srl

chmod 600 ca.key server.key
chmod 644 ca.crt server.crt

# Self-check: the chain verifies and the host name localhost is covered; an IP address is not.
openssl verify -CAfile ca.crt -verify_hostname localhost server.crt >/dev/null
if openssl verify -CAfile ca.crt -verify_ip 127.0.0.1 server.crt >/dev/null 2>&1; then
  echo "refused: the server certificate unexpectedly names an IP address" >&2
  exit 1
fi

echo "ca.crt     sha256 $(openssl x509 -in ca.crt -noout -fingerprint -sha256 | cut -d= -f2)"
echo "server.crt sha256 $(openssl x509 -in server.crt -noout -fingerprint -sha256 | cut -d= -f2)"
echo "written to $dir (ca.key: move it offline; install server.crt and server.key into PostgreSQL's tls directory)"
