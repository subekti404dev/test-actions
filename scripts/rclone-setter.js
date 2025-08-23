#!/usr/bin/env node
// Robust rclone setter: finds config path or uses B64_RCLONE, masks secrets, POSTs to setter URL.

const fs = require("fs");
const process = require("process");
const { execSync } = require("child_process");

// ---- Inputs ----
const setterUrl = process.env.RCLONE_SETTER_URL;
if (!setterUrl) {
  console.error("RCLONE_SETTER_URL is not set");
  process.exit(1);
}

// ---- Utils ----
const mask = (s) => {
  if (!s) return;
  for (let i = 0; i < s.length; i += 10000) {
    console.log(`::add-mask::${s.slice(i, i + 10000)}`);
  }
};

// ---- 1) Try env var first ----
let target = process.env.RCLONE_CONFIG && fs.existsSync(process.env.RCLONE_CONFIG)
  ? process.env.RCLONE_CONFIG
  : "";

// ---- 2) Try parsing `rclone config file` ----
if (!target) {
  try {
    const out = execSync("rclone config file", {
      stdio: ["ignore", "pipe", "pipe"],
      shell: "/bin/bash",
      encoding: "utf8",
    });
    // Typical output: "Configuration file is stored at: /home/runner/.config/rclone/rclone.conf"
    const m = out.match(/Configuration file is stored at:\s*(.+)\s*$/i);
    if (m && fs.existsSync(m[1].trim())) {
      target = m[1].trim();
    }
  } catch {
    // ignore
  }
}

// ---- 3) Try common locations ----
if (!target) {
  const home = process.env.HOME || "/home/runner";
  const candidates = [
    `${home}/.config/rclone/rclone.conf`,
    "/home/runner/.config/rclone/rclone.conf",
    "/etc/rclone/rclone.conf",
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) {
      target = p;
      break;
    }
  }
}

// ---- 4) If still not found, fall back to B64_RCLONE ----
let b64;
if (!target) {
  b64 = (process.env.B64_RCLONE || "").replace(/\r?\n/g, "");
  if (!b64) {
    console.error("rclone.conf not found, and B64_RCLONE is empty. Aborting.");
    process.exit(1);
  }
  // We can POST B64_RCLONE directly without touching disk.
} else {
  // Read file and encode to base64 (single line)
  const buf = fs.readFileSync(target);
  b64 = buf.toString("base64");
}

// ---- Mask and POST ----
mask(b64);

const res = await fetch(setterUrl + "?data=" + b64, {
  method: "GET"
});
if (!res.ok) {
  const txt = await res.text().catch(() => "");
  console.error(`Setter failed: ${res.status} ${res.statusText}\n${txt}`);
  process.exit(1);
}

console.log("rclone setter: POSTed base64 config successfully.");
