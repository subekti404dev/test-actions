#!/usr/bin/env node
// scripts/vidmoly.js
// Upload a file to vidmoly transit by logging in to obtain `xfsts` (sess_id).
// Usage:
//   node scripts/vidmoly.js <username> <password> <file_path>
//   VIDMOLY_USERNAME=... VIDMOLY_PASSWORD=... node scripts/vidmoly.js <file_path>
//
// Outputs (writes to $GITHUB_OUTPUT if set):
// - upload_status: HTTP status code
// - progress_id: 12-digit progress id used
// - upload_url: final transit URL with progress id
//
// Notes:
// - Masks sensitive values (username, password, xfsts) in GitHub logs.
// - Does not print response body unless a non-2xx status occurs.

/* eslint-env node */
/* global fetch */

const fs = require("fs");

function parseSetCookieHeaders(setCookieHeaders) {
  // setCookieHeaders: string[] of full Set-Cookie header lines
  const cookies = {};
  for (const line of setCookieHeaders) {
    const firstSemicolon = line.indexOf(";");
    const pair = firstSemicolon === -1 ? line : line.slice(0, firstSemicolon);
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    cookies[name] = value;
  }
  return cookies;
}

async function loginVidmoly({ username, password }) {
  if (!username || !password) {
    throw new Error("username and password are required");
  }

  const url = "https://vidmoly.me/";
  const params = new URLSearchParams();
  params.set("op", "login");
  params.set("redirect", "");
  params.set("login", username);
  params.set("password", password);
  params.set("submit", "Enter");
  params.set("submitme", "1");

  const headers = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    // Node's fetch handles compression; header included to mirror curl
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Content-Type": "application/x-www-form-urlencoded",
    "Origin": "https://vidmoly.me",
    "Referer": "https://vidmoly.me/",
  };

  // Important: use manual redirect so we can read Set-Cookie on the 302 response
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: params.toString(),
    redirect: "manual",
  });

  // Gather all Set-Cookie headers (undici exposes getSetCookie)
  let setCookies = [];
  if (typeof res.headers.getSetCookie === "function") {
    setCookies = res.headers.getSetCookie();
  } else {
    const single = res.headers.get("set-cookie");
    if (single) setCookies = [single];
  }

  if (!setCookies || setCookies.length === 0) {
    const text = await res.text().catch(() => "");
    const snippet = text ? text.slice(0, 300) : "";
    throw new Error(`No Set-Cookie headers found (status ${res.status}). Body: ${snippet}`);
  }

  const cookieMap = parseSetCookieHeaders(setCookies);
  const xfsts = cookieMap["xfsts"];
  if (!xfsts) {
    throw new Error("xfsts cookie not found in response");
  }

  return { xfsts, setCookies, status: res.status };
}

async function main() {
  // Support two invocation modes:
  // 1) node scripts/vidmoly.js <username> <password> <file_path>
  // 2) VIDMOLY_USERNAME/VIDMOLY_PASSWORD env and arg[2] = <file_path>
  const envUser = process.env.VIDMOLY_USERNAME;
  const envPass = process.env.VIDMOLY_PASSWORD;
  let username, password, filePath;

  if (envUser && envPass && process.argv[2]) {
    username = envUser;
    password = envPass;
    filePath = process.argv[2];
  } else {
    username = process.argv[2];
    password = process.argv[3];
    filePath = process.argv[4];
  }

  if (!username || !password || !filePath) {
    console.error("❌ Usage: node scripts/vidmoly.js <username> <password> <file_path> (or provide VIDMOLY_USERNAME/VIDMOLY_PASSWORD env and pass <file_path> as sole arg)");
    process.exit(1);
  }

  try {
    // Mask secrets in GitHub Actions logs
    console.log(`::add-mask::${username}`);
    console.log(`::add-mask::${password}`);

    const { upload_status, progress_id, upload_url, file_code } = await upload({ username, password, filePath });

    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `upload_status=${upload_status}\n`);
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `progress_id=${progress_id}\n`);
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `upload_url=${upload_url}\n`);
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `file_code=${file_code}\n`);
      console.log(`✅ Upload completed (status ${upload_status}). Progress ID: ${progress_id}`);
    } else {
      console.log(`upload_status=${upload_status}`);
      console.log(`progress_id=${progress_id}`);
      console.log(`upload_url=${upload_url}`);
      console.log(`file_code=${file_code}`);
    }
  } catch (err) {
    console.error(`❌ Upload failed: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

// Export only the high-level upload function
module.exports = { upload };
/**
 * Generate a numeric progress ID (default 12 digits).
 */
function randomProgressId(len = 12) {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += Math.floor(Math.random() * 10);
  }
  return out;
}

/**
 * Upload a file to vidmoly transit endpoint using the xfsts session.
 *
 * Params:
 * - xfsts: required session token (maps to form field `sess_id`)
 * - filePath: required absolute/relative path to the file to upload
 * - opts: optional overrides
 *   - progressId: override X-Progress-ID (default: random 12 digits)
 *   - transitUrl: full base URL before the query (default: https://upload-transit-eu-2x.vmrange.lat/upload/01)
 *   - fldId: folder id string (default: "0")
 *   - tos: terms value (default: "1")
 *   - submitBtn: submit label (default: " Upload! ")
 *   - headers: additional headers to merge
 *
 * Returns: { status, url, progressId, body }
 */
async function uploadTransit({ xfsts, filePath }, opts = {}) {
  if (!xfsts) throw new Error("xfsts (sess_id) is required");
  if (!filePath) throw new Error("filePath is required");

  const fsPromises = require("fs/promises");
  const path = require("path");

  const absPath = path.resolve(filePath);
  const stat = await fsPromises.stat(absPath).catch(() => null);
  if (!stat || !stat.isFile()) {
    throw new Error(`File not found or not a file: ${absPath}`);
  }

  const progressId = opts.progressId || randomProgressId(12);
  const baseUrl = opts.transitUrl || "https://upload-transit-eu-2x.vmrange.lat/upload/01";
  const url = `${baseUrl}?X-Progress-ID=${encodeURIComponent(progressId)}`;

  const defaultHeaders = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "en-US,en;q=0.5",
    "Origin": "https://vidmoly.me",
    "Referer": "https://vidmoly.me/",
    "Sec-GPC": "1",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "iframe",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "cross-site",
    "Sec-Fetch-User": "?1",
    "Priority": "u=4",
  };

  const headers = { ...defaultHeaders, ...(opts.headers || {}) };

  // Prepare multipart form (stream to avoid loading large files into memory)
  const filename = path.basename(absPath);
  const form = new FormData();
  form.append("sess_id", xfsts);
  const fileStream = require("fs").createReadStream(absPath);
  form.append("file", fileStream, filename);
  form.append("fld_id", opts.fldId ?? "0");
  form.append("tos", opts.tos ?? "1");
  form.append("submit_btn", opts.submitBtn ?? " Upload! ");

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: form,
  });

  const body = await res.text().catch(() => "");
  return { status: res.status, url, progressId, body };
}

/**
 * High-level upload flow: login -> obtain xfsts -> upload
 *
 * Params:
 * - username, password: required login credentials
 * - filePath: required path to file
 * - opts: optional overrides passed to uploadTransit
 *
 * Returns: { upload_status, progress_id, upload_url, file_code }
 */
async function upload({ username, password, filePath }, opts = {}) {
  const { xfsts } = await loginVidmoly({ username, password });
  // Mask the session token in logs
  console.log(`::add-mask::${xfsts}`);
  const { status, url, progressId, body } = await uploadTransit({ xfsts, filePath }, opts);
  if (status < 200 || status >= 300) {
    // Provide a short snippet for diagnostics, but avoid large logs
    const snippet = body ? String(body).slice(0, 200) : "";
    throw new Error(`Transit upload returned status ${status}. Body: ${snippet}`);
  }
  const { op, fn, st } = parseTransitHtml(body || "");
  if (!fn) {
    const snippet = body ? String(body).slice(0, 300) : "";
    throw new Error(`Upload response missing file code (fn). Status ${status}. Body: ${snippet}`);
  }
  if (st && String(st).toUpperCase() !== "OK") {
    // Non-fatal but informative
    console.warn(`Warning: upload status flag is '${st}', expected 'OK'`);
  }
  return { upload_status: status, progress_id: progressId, upload_url: url, file_code: fn };
}

function parseTransitHtml(html) {
  const get = (name) => {
    const re = new RegExp(`<textarea\\s+name=["']${name}["']\\s*>\\s*([\\s\\S]*?)\\s*<\\/textarea>`, "i");
    const m = re.exec(html);
    return m ? m[1].trim() : null;
  };
  return { op: get("op"), fn: get("fn"), st: get("st") };
}
