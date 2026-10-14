#!/usr/bin/env bash
# make-pki.sh — private CA and PostgreSQL server certificate for the self-hosted staging database (M00-VPS-01).
# The server certificate names `localhost` (SAN DNS:localhost; deliberately NO IP address entry), because the backend and the
# operator tools connect to the host name localhost and verify the chain AND the host name.
#
# TWO DIFFERENT PROCEDURES — do not mix them up:
#
#   1. NEW CA + certificate (first install, or a deliberate CA rotation):
#        sudo ./make-pki.sh new /root/ship11-pki            (a single argument, `./make-pki.sh /root/ship11-pki`, means the same)
#      Writes ca.key ca.crt server.key server.crt. This is a NEW CA: every copy of db-ca.crt (service, operator) must trust it
#      before the server presents a certificate it signed. The runbook gives the order (trust both, switch, then retire).
#
#   2. RENEW THE SERVER CERTIFICATE UNDER THE SAME CA (the usual renewal; db-ca.crt does not change):
#        sudo ./make-pki.sh renew-leaf <dir holding ca.crt and ca.key> /root/ship11-pki-2
#      Needs the CA private key, which should be offline: restore it into a root-only directory (mode 700, ca.key mode 600) for
#      this one command, then remove it. Writes server.key server.crt (new key pair) and a copy of the public ca.crt into the NEW
#      directory; ca.key is never copied there. Refuses unless ca.key matches ca.crt and the CA is valid for at least 30 more days.
#
# Files (mode 600 for keys, 644 for certificates). ca.crt is public (DB_SSL_CA_FILE). ca.key can mint certificates this database
# is trusted under: keep it offline. server.* go to /etc/postgresql/17/main/tls/ (owner postgres, key mode 600).
# Validity: CA 3650 days; server certificate 825 days (shortened to end before the CA when renewing late).
# Neither procedure overwrites anything: the target directory must not exist. Prints only fingerprints and paths, never key
# material. Needs openssl 3.
set -euo pipefail
umask 077

usage() {
  echo "usage: $0 new <new directory> | $0 renew-leaf <CA directory> <new directory>" >&2
  exit 2
}
refuse() {
  echo "refused: $1" >&2
  exit 1
}

command -v openssl >/dev/null || refuse "openssl is not installed"

mode="new"
case "${1:-}" in
  "") usage ;;
  new) mode="new"; shift ;;
  renew-leaf) mode="renew-leaf"; shift ;;
  -*) usage ;;
  *) mode="new" ;;
esac

# Issues server.key / server.crt, signed by ca.crt in the current directory; $1 = validity in days, $2 = CA key (default ./ca.key).
issue_leaf() {
  local days="$1" ca_key="${2:-ca.key}"
  openssl ecparam -name prime256v1 -genkey -noout -out server.key
  openssl req -new -key server.key -subj "/CN=localhost" -out server.csr
  cat > server.ext <<'EXT'
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = serverAuth
subjectAltName = DNS:localhost
EXT
  openssl x509 -req -in server.csr -CA ca.crt -CAkey "$ca_key" -CAcreateserial -sha256 -days "$days" -extfile server.ext -out server.crt
  rm -f server.csr server.ext ca.srl
}

# Self-check: the chain verifies against ca.crt and the host name localhost is covered; an IP address is not.
check_leaf() {
  openssl verify -CAfile ca.crt -verify_hostname localhost server.crt >/dev/null
  if openssl verify -CAfile ca.crt -verify_ip 127.0.0.1 server.crt >/dev/null 2>&1; then
    refuse "the server certificate unexpectedly names an IP address"
  fi
}

if [ "$mode" = "new" ]; then
  dir="${1:-}"
  [ -n "$dir" ] || usage
  [ ! -e "$dir" ] || refuse "$dir already exists (this script never overwrites a key or certificate)"
  mkdir -p "$dir"
  cd "$dir"
  openssl ecparam -name prime256v1 -genkey -noout -out ca.key
  openssl req -x509 -new -key ca.key -sha256 -days 3650 \
    -subj "/CN=11ship staging PostgreSQL CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -out ca.crt
  issue_leaf 825
  chmod 600 ca.key server.key
  chmod 644 ca.crt server.crt
  check_leaf
  echo "NEW CA: db-ca.crt on the service and the operator must trust this ca.crt before the server presents server.crt."
  echo "ca.crt     sha256 $(openssl x509 -in ca.crt -noout -fingerprint -sha256 | cut -d= -f2)"
  echo "server.crt sha256 $(openssl x509 -in server.crt -noout -fingerprint -sha256 | cut -d= -f2)"
  echo "written to $dir (ca.key: move it offline; install server.crt and server.key into PostgreSQL's tls directory)"
  exit 0
fi

# renew-leaf
ca_dir="${1:-}"
dir="${2:-}"
[ -n "$ca_dir" ] && [ -n "$dir" ] || usage
[ -d "$ca_dir" ] || refuse "the CA directory does not exist"
ca_dir="$(cd "$ca_dir" && pwd)"
[ -f "$ca_dir/ca.crt" ] && [ -f "$ca_dir/ca.key" ] || refuse "the CA directory must hold ca.crt and ca.key"
[ ! -e "$dir" ] || refuse "$dir already exists (this script never overwrites a key or certificate)"
case "$(stat -c '%a' "$ca_dir/ca.key")" in
  600 | 400) ;;
  *) refuse "ca.key must have mode 600 (or 400)" ;;
esac
[ "$(stat -c '%u' "$ca_dir/ca.key")" = "$(id -u)" ] || refuse "ca.key must be owned by the user running this command"
ca_pub_from_key="$(openssl pkey -in "$ca_dir/ca.key" -pubout 2>/dev/null)" || refuse "ca.key is not a usable private key"
ca_pub_from_crt="$(openssl x509 -in "$ca_dir/ca.crt" -noout -pubkey 2>/dev/null)" || refuse "ca.crt is not a usable certificate"
[ "$ca_pub_from_key" = "$ca_pub_from_crt" ] || refuse "ca.key does not belong to ca.crt"
openssl x509 -in "$ca_dir/ca.crt" -noout -checkend $((30 * 86400)) >/dev/null || refuse "the CA is expired or expires within 30 days: rotate the CA (make-pki.sh new) instead"

ca_end="$(openssl x509 -in "$ca_dir/ca.crt" -noout -enddate | cut -d= -f2)"
remaining_days=$((($(date -d "$ca_end" +%s) - $(date +%s)) / 86400))
days=825
if [ "$remaining_days" -le "$days" ]; then
  days=$((remaining_days - 1))
fi

mkdir -p "$dir"
cp "$ca_dir/ca.crt" "$dir/ca.crt"
cd "$dir"
issue_leaf "$days" "$ca_dir/ca.key"
chmod 600 server.key
chmod 644 ca.crt server.crt
check_leaf
cmp -s ca.crt "$ca_dir/ca.crt" || refuse "internal error: the CA certificate changed"

echo "SAME CA: db-ca.crt does not change. Install only server.crt and server.key (then reload PostgreSQL)."
echo "ca.crt     sha256 $(openssl x509 -in ca.crt -noout -fingerprint -sha256 | cut -d= -f2)  (unchanged)"
echo "server.crt sha256 $(openssl x509 -in server.crt -noout -fingerprint -sha256 | cut -d= -f2)  valid ${days} days"
echo "written to $dir (no ca.key here; remove the restored ca.key from $ca_dir now and return it to offline storage)"
