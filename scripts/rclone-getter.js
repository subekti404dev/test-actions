#!/usr/bin/env node
const fs = require("fs");
const process = require("process");
const http = require("http");
const https = require("https");
const { URL } = require("url");

// Minimal fetch fallback for Node <18
const nodeFetch = (urlStr, options = {}) =>
  new Promise((resolve, reject) => {
    try {
      const u = new URL(urlStr);
      const lib = u.protocol === "https:" ? https : http;
      const req = lib.request(
        {
          method: options.method || "GET",
          hostname: u.hostname,
          port: u.port || (u.protocol === "https:" ? 443 : 80),
          path: u.pathname + (u.search || ""),
          headers: options.headers || {},
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              statusText: res.statusMessage || "",
              text: async () => body,
            });
          });
        }
      );
      req.on("error", reject);
      if (options.body) req.write(options.body);
      req.end();
    } catch (e) {
      reject(e);
    }
  });

const fetchSafe = typeof globalThis.fetch === "function" ? globalThis.fetch : nodeFetch;

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
  const mask = (s) => {
    for (let i = 0; i < s.length; i += 10000) {
      console.log(`::add-mask::${s.slice(i, i + 10000)}`);
    }
  };
  mask(b64);

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
