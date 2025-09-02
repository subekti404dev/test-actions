#!/usr/bin/env bash
# scripts/vidmoly.sh
# Upload a file to Vidmoly transit via curl.
#
# Usage:
#   VIDMOLY_USERNAME=... VIDMOLY_PASSWORD=... scripts/vidmoly.sh <file_path>
#   scripts/vidmoly.sh <username> <password> <file_path>
#
# Outputs (writes to $GITHUB_OUTPUT if set):
# - upload_status: HTTP status code from transit upload
# - progress_id: 12-digit progress id used
# - upload_url: final transit URL with progress id
# - file_code: file code returned by Vidmoly (fn)

set -euo pipefail

log() { printf '%s\n' "$*"; }
err() { printf '❌ %s\n' "$*" 1>&2; }

usage() {
  err "Usage: VIDMOLY_USERNAME=... VIDMOLY_PASSWORD=... $0 <file_path>"
  err "   or: $0 <username> <password> <file_path>"
}

# Parse args/env
USERNAME="${VIDMOLY_USERNAME:-}"
PASSWORD="${VIDMOLY_PASSWORD:-}"
FILE_PATH=""

if [[ -n "${USERNAME}" && -n "${PASSWORD}" && $# -ge 1 ]]; then
  FILE_PATH="$1"
elif [[ $# -ge 3 ]]; then
  USERNAME="$1"
  PASSWORD="$2"
  FILE_PATH="$3"
else
  usage
  exit 1
fi

# Normalize file:// prefix and trim whitespace
FILE_PATH=$(printf '%s' "$FILE_PATH" | sed -e 's#^file://##' -e 's/[[:space:]]*$//')

if [[ -z "${USERNAME}" || -z "${PASSWORD}" || -z "${FILE_PATH}" ]]; then
  usage
  exit 1
fi

if [[ ! -f "$FILE_PATH" ]]; then
  err "File not found: $FILE_PATH"
  exit 1
fi

# Mask secrets in GitHub logs
log "::add-mask::${USERNAME}"
log "::add-mask::${PASSWORD}"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

cookiejar="$workdir/cookies.txt"
hdrs="$workdir/headers.txt"
login_body="$workdir/login.html"

# Login to obtain xfsts cookie
login_url="https://vidmoly.me/"
user_agent="Mozilla/5.0 (X11; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0"

curl -sS -X POST "$login_url" \
  -H "User-Agent: $user_agent" \
  -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" \
  -H "Accept-Language: en-US,en;q=0.5" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Origin: https://vidmoly.me" \
  -H "Referer: https://vidmoly.me/" \
  -c "$cookiejar" \
  -D "$hdrs" \
  --data-urlencode "op=login" \
  --data-urlencode "redirect=" \
  --data-urlencode "login=${USERNAME}" \
  --data-urlencode "password=${PASSWORD}" \
  --data-urlencode "submit=Enter" \
  --data-urlencode "submitme=1" \
  -o "$login_body" \
  -w ''

# Extract xfsts from cookie jar (Netscape format, 7th column is value)
xfsts="$(awk '($0 !~ /^#/ && $0 ~ /\txfsts\t/) {print $7}' "$cookiejar" | tail -n1)"
if [[ -z "$xfsts" ]]; then
  # Fallback: try headers directly
  xfsts="$(grep -i "^Set-Cookie:" "$hdrs" | grep -o 'xfsts=[^;]*' | sed 's/^xfsts=//;q')"
fi

if [[ -z "$xfsts" ]]; then
  err "Login failed: xfsts cookie not found"
  if [[ -s "$login_body" ]]; then
    err "Login response snippet:" 
    head -c 300 "$login_body" 1>&2 || true
    printf '\n' 1>&2
  fi
  exit 1
fi

# Mask session token
log "::add-mask::${xfsts}"

# Generate 12-digit progress id
progress_id=""
for _ in {1..12}; do
  progress_id+="$(( RANDOM % 10 ))"
done

base_url="https://upload-transit-eu-2x.vmrange.lat/upload/01"
upload_url="${base_url}?X-Progress-ID=${progress_id}"

resp_html="$workdir/upload.html"

# Perform multipart upload
upload_status=$(curl -sS -X POST "$upload_url" \
  -H "User-Agent: $user_agent" \
  -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" \
  -H "Accept-Language: en-US,en;q=0.5" \
  -H "Origin: https://vidmoly.me" \
  -H "Referer: https://vidmoly.me/" \
  -b "$cookiejar" \
  -F "sess_id=${xfsts}" \
  -F "file=@${FILE_PATH}" \
  -F "fld_id=0" \
  -F "tos=1" \
  -F "submit_btn= Upload! " \
  -o "$resp_html" \
  -w '%{http_code}')

if [[ "$upload_status" -lt 200 || "$upload_status" -ge 300 ]]; then
  err "Transit upload returned status $upload_status"
  if [[ -s "$resp_html" ]]; then
    err "Response snippet:"
    head -c 200 "$resp_html" 1>&2 || true
    printf '\n' 1>&2
  fi
  echo "upload_status=${upload_status}" >> "${GITHUB_OUTPUT:-/dev/null}" 2>/dev/null || true
  exit 1
fi

# Extract <textarea name="fn"> value (file code). Use grep PCRE in dotall mode.
file_code="$(grep -Poz '(?s)<textarea\s+name=["\x27]fn["\x27]\s*>\s*\K(.+?)\s*(?=</textarea>)' "$resp_html" | tr -d '\0' | head -n1 || true)"

if [[ -z "$file_code" ]]; then
  # Secondary attempt using sed (less robust)
  file_code="$(sed -n '/<textarea[[:space:]]\{1,\}name=["\'"'"']fn["\'"'"']/{:a;N;/<\/textarea>/!ba;s/.*<textarea[^>]*>\s*//;s/\s*<\/textarea>.*//;p;}' "$resp_html" | head -n1 | sed 's/[\r\n]//g' || true)"
fi

if [[ -z "$file_code" ]]; then
  err "Upload response missing file code (fn)"
  echo "upload_status=${upload_status}" >> "${GITHUB_OUTPUT:-/dev/null}" 2>/dev/null || true
  exit 1
fi

# Write outputs
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "upload_status=${upload_status}"
    echo "progress_id=${progress_id}"
    echo "upload_url=${upload_url}"
    echo "file_code=${file_code}"
  } >> "$GITHUB_OUTPUT"
  log "✅ Upload completed (status ${upload_status}). Progress ID: ${progress_id}"
else
  log "upload_status=${upload_status}"
  log "progress_id=${progress_id}"
  log "upload_url=${upload_url}"
  log "file_code=${file_code}"
fi

exit 0

