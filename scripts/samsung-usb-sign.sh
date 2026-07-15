#!/usr/bin/env bash
# samsung-usb-sign.sh — upload .wgt, sign, download .tmg + widget.license
#
# Usage: ./samsung-usb-sign.sh <file.wgt> [output-dir]
#
# HOW TO GET SESSION COOKIE:
#   1. Login ke https://seller.samsungapps.com
#   2. Buka DevTools (F12) → tab Network
#   3. Buka https://seller.samsungapps.com/tv/tool/usb-package
#   4. Klik request apapun ke seller.samsungapps.com
#   5. Tab Headers → Request Headers → Cookie
#   6. Copy nilai SESSION=xxxxx, paste di bawah
#
# SESSION cookie expire tiap beberapa jam — update kalau muncul 401/403.

SESSION="${SAMSUNG_SESSION:?Set SAMSUNG_SESSION env var}"

set -euo pipefail

WGT="${1:?Usage: $0 <file.wgt> [output-dir]}"
OUTDIR="${2:-$(dirname "$WGT")}"

[[ -f "$WGT" ]] || { echo "File not found: $WGT"; exit 1; }
mkdir -p "$OUTDIR"

FILENAME="$(basename "$WGT")"
FILENAME_CLEAN="${FILENAME//+/}"
FILESIZE="$(stat -c%s "$WGT")"
COOKIE="COOKIE_CONSENT=TRUE; GA_CONSENT=TRUE; SESSION=${SESSION}"
BASE_URL="https://seller.samsungapps.com/tv/v2/sba"
BASENAME_CLEAN="${FILENAME_CLEAN%.wgt}"

# copy to /tmp with clean name to avoid + encoding issues
WGT_CLEAN="/tmp/${FILENAME_CLEAN}"
cp "$WGT" "$WGT_CLEAN"

echo "==> Uploading $FILENAME ($FILESIZE bytes)..."

UPLOAD_RES=$(curl -s -w "\n%{http_code}" "${BASE_URL}/files/upload/app-sign" \
  -X POST \
  -H "Accept: application/json" \
  -H "Cache-Control: no-cache" \
  -H "Cookie: ${COOKIE}" \
  -F "fileId=" \
  -F 'fileUploadProperties={"downloadType":"FW.FILE.APP_SIGN","ownerObjectId":null,"ownerObjectId2":null,"ownerTableName":null,"isPublic":false,"isNewIdForEachFile":false}' \
  -F "file_${FILESIZE}_${FILENAME_CLEAN}=@${WGT_CLEAN};type=application/octet-stream")

UPLOAD_HTTP=$(echo "$UPLOAD_RES" | tail -1)
UPLOAD_BODY=$(echo "$UPLOAD_RES" | sed '$d')
echo "    upload HTTP $UPLOAD_HTTP: $UPLOAD_BODY"
[[ "$UPLOAD_HTTP" == "200" ]] || { echo "Upload failed (HTTP $UPLOAD_HTTP)"; exit 1; }

FILE_KEY=$(echo "$UPLOAD_BODY" | jq -r '.[0].fileKey')
[[ -n "$FILE_KEY" && "$FILE_KEY" != "null" ]] || { echo "No fileKey in response"; exit 1; }
echo "    fileKey: $FILE_KEY"

echo "==> Signing..."
SIGN_RES=$(curl -s -w "\n%{http_code}" "${BASE_URL}/appsign/usb" \
  -X POST \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -H "Cache-Control: no-cache" \
  -H "Cookie: ${COOKIE}" \
  --data-raw "{\"fileKey\":\"${FILE_KEY}\"}")

SIGN_HTTP=$(echo "$SIGN_RES" | tail -1)
SIGN_BODY=$(echo "$SIGN_RES" | sed '$d')
echo "    sign HTTP $SIGN_HTTP: $SIGN_BODY"
[[ "$SIGN_HTTP" == "200" ]] || { echo "Sign failed (HTTP $SIGN_HTTP)"; exit 1; }

TMG_URL=$(echo "$SIGN_BODY" | jq -r '.tmgFileUrl // empty')
LIC_URL=$(echo "$SIGN_BODY" | jq -r '.licenseFileUrl // empty')
ERR=$(echo "$SIGN_BODY" | jq -r '.errorMessage // empty')

[[ -n "$ERR" && "$ERR" != "null" ]] && { echo "Sign error: $ERR"; exit 1; }
[[ -n "$TMG_URL" ]] || { echo "Sign failed — no tmgFileUrl in response"; exit 1; }

echo "==> Downloading .tmg..."
curl -L --progress-bar "$TMG_URL" -o "${OUTDIR}/${BASENAME_CLEAN}.tmg" || { echo "Download .tmg failed"; exit 1; }
echo "    Saved: ${OUTDIR}/${BASENAME_CLEAN}.tmg"

echo "==> Downloading widget.license..."
curl -L --progress-bar "$LIC_URL" -o "${OUTDIR}/widget.license" || { echo "Download license failed"; exit 1; }
echo "    Saved: ${OUTDIR}/widget.license"

echo "==> Copying WGT..."
cp "$WGT_CLEAN" "${OUTDIR}/${BASENAME_CLEAN}.wgt"
echo "    Saved: ${OUTDIR}/${BASENAME_CLEAN}.wgt"

echo "Done."
