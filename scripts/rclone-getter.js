#!/usr/bin/env node
const fs = require("fs");
const process = require("process");
const { fetchSafe, maskSecret } = require("./utils");

const main = async () => {

  // Inputs
  const url = process.env.RCLONE_GETTER_URL;
  if (!url) {
    console.error("RCLONE_GETTER_URL is not set");
    process.exit(1);
  }

  // Fetch (supports Node <18 via fallback)
  const res = await fetchSafe(url);
  if (!res.ok) {
    console.error(`Getter failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  let b64 = (await res.text()).replace(/\r?\n/g, "");

  // Mask long secrets (split into chunks so GitHub masks fully)
  maskSecret(b64);

  // Store in GITHUB_ENV
  const envFile = process.env.GITHUB_ENV;
  if (!envFile) {
    console.error("GITHUB_ENV is not available");
    process.exit(1);
  }
  fs.appendFileSync(envFile, `B64_RCLONE<<EOF\n${b64}\nEOF\n`);

  console.log("rclone getter: stored B64_RCLONE to GITHUB_ENV (masked).");

}

main();
