// find-video.js
const fs = require("fs");
const path = require("path");

// Levenshtein ratio for fuzzy matching
function levenshteinRatio(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  const distance = matrix[b.length][a.length];
  return 1 - distance / Math.max(a.length, b.length);
}

// ---- MAIN ----
// Take TARGET from input (env var or CLI arg)
const TARGET = process.env.TARGET || process.argv[2];
if (!TARGET) {
  console.error("❌ TARGET filename not provided. Use env TARGET=... or node find-video.js <target>");
  process.exit(1);
}

const searchDir = "/data";

// Recursively walk directory
function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(filePath));
    } else {
      results.push(filePath);
    }
  });
  return results;
}

const allFiles = walk(searchDir)
  // .filter((f) => f.endsWith(".mp4"));

let bestFile = null;
let bestScore = 0;

for (const f of allFiles) {
  const score = levenshteinRatio(path.basename(f), TARGET);
  if (score > bestScore) {
    bestScore = score;
    bestFile = f;
  }
}

// if (bestFile && bestScore >= 0.95) {
//   console.log(`::set-output name=video_file::${bestFile}`);
// } else if (bestFile) {
//   console.log(`⚠️ No 95%+ match, best fallback: ${bestFile} (${Math.round(bestScore * 100)}%)`);
//   console.log(`::set-output name=video_file::${bestFile}`);
// } else {
//   console.error("❌ No video file found in /data");
//   process.exit(1);
// }


if (!bestFile) {
  console.error("❌ No .mp4 file found in /data");
  process.exit(1);
}

if (bestScore >= 0.95) {
  console.log(`✅ Found match: ${bestFile}`);
} else {
  console.log(`⚠️ Best fallback: ${bestFile} (${Math.round(bestScore * 100)}% similar)`);
}

// Write to GitHub Actions output file
fs.appendFileSync(process.env.GITHUB_OUTPUT, `video_file=${bestFile}\n`);
