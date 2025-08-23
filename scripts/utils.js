const http = require("http");
const https = require("https");
const { URL } = require("url");

// Minimal fetch-like implementation for Node <18.
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
          path: (u.pathname || "/") + (u.search || ""),
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

const maskSecret = (s) => {
  if (!s) return;
  for (let i = 0; i < s.length; i += 10000) {
    // GitHub Actions will mask these fragments in logs
    console.log(`::add-mask::${s.slice(i, i + 10000)}`);
  }
};

module.exports = { fetchSafe, maskSecret };

