#!/usr/bin/env node
import fs from "fs";
import { execSync } from "child_process";
import process from "process";

const setterUrl = process.env.RCLONE_SETTER_URL;
if (!setterUrl) {
  console.error("RCLONE_SETTER_URL is not set");
  process.exit(1);
}

// Determine actual config path rclone uses
let target;
try {
  const out = execSync(
    `rclone config file | awk '/Configuration file is stored at:/ {print $NF}'`,
    { stdio: ["ignore", "pipe", "pipe"], shell: "/bin/bash" }
  )
    .toString()
    .trim();
  target = out || `${process.env.HOME}/.config/rclone/rclone.conf`;
} catch {
  target = `${process.env.HOME}/.config/rclone/rclone.conf`;
}

if (!fs.existsSync(target)) {
  console.error(`rclone.conf not found at: ${target}`);
  process.exit(1);
}

// Base64 (single line)
const b64 = fs.readFileSync(target).toString("base64");

// Mask (chunked)
const mask = (s) => {
  for (let i = 0; i < s.length; i += 10000) {
    console.log(`::add-mask::${s.slice(i, i + 10000)}`);
  }
};
mask(b64);

// POST application/x-www-form-urlencoded
const body = new URLSearchParams({ data: b64 });
const res = await fetch(setterUrl, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body
});
if (!res.ok) {
  const txt = await res.text().catch(() => "");
  console.error(`Setter failed: ${res.status} ${res.statusText}\n${txt}`);
  process.exit(1);
}
console.log("rclone setter: POSTed base64 config successfully.");
