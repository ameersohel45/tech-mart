#!/usr/bin/env node
/**
 * publish.js — recompute the DeDi digest chain for this bucket after editing catalogs.
 *
 * Run from the repo root, after editing any catalog JSON:
 *   node publish.js              # update the index's parts[].digest from the catalog files
 *   node publish.js --manifest   # ALSO refresh the manifest's files[].digest (optional)
 *
 * Why: the crawler verifies each file against the sha-256 declared for it in its parent
 * (catalog -> index parts[].digest, index -> manifest files[].digest). This hashes the ACTUAL
 * file bytes (the whole file, trailing newline included) — exactly what GitHub raw serves and the
 * crawler checks — so you never hand-compute a hash or lose the trailing newline again.
 *
 * By default it touches ONLY the index (all a catalog edit needs to sync). Pass --manifest to also
 * refresh the manifest's index digest. Edits are surgical (only the digest string changes).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const MANIFEST = path.join(ROOT, ".well-known", "dedi.json");
const UPDATE_MANIFEST = process.argv.includes("--manifest");

// sha-256 of the exact file bytes (trailing newline included).
function sha256Of(file) {
  return "sha-256:" + crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

// Map a raw.githubusercontent.com URL to a repo-relative file path.
// Handles /<owner>/<repo>/<branch>/<path> and /<owner>/<repo>/refs/heads/<branch>/<path>.
function urlToLocal(url) {
  const parts = new URL(url).pathname.replace(/^\/+/, "").split("/");
  const rel = parts[2] === "refs" && parts[3] === "heads" ? parts.slice(5) : parts.slice(3);
  return path.join(ROOT, ...rel);
}

// Replace one occurrence of `oldD` with `newD` in `file`. Returns true if it changed.
function swapDigest(file, oldD, newD) {
  if (oldD === newD) return false;
  const txt = fs.readFileSync(file, "utf8");
  if (!txt.includes(oldD)) {
    console.error(`ERROR: digest ${oldD} not found in ${file} (was the file edited elsewhere?)`);
    process.exit(1);
  }
  fs.writeFileSync(file, txt.replace(oldD, newD)); // String.replace replaces the first match only
  return true;
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
let changed = false;

for (const fref of manifest.files) {
  const indexPath = urlToLocal(fref.url);
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));

  for (const rec of index.records || []) {
    for (const part of rec.details.parts || []) {
      const next = sha256Of(urlToLocal(part.url));
      if (swapDigest(indexPath, part.digest, next)) {
        changed = true;
        console.log(`  index part [${path.basename(urlToLocal(part.url))}] -> ${next}`);
      }
    }
  }

  if (UPDATE_MANIFEST) {
    const nextIndex = sha256Of(indexPath);
    if (swapDigest(MANIFEST, fref.digest, nextIndex)) {
      changed = true;
      console.log(`  manifest [${path.basename(indexPath)}] -> ${nextIndex}`);
    }
  }
}

console.log("digest chain " + (changed ? "updated." : "already up to date."));
if (!UPDATE_MANIFEST) console.log("(manifest left untouched — pass --manifest to also refresh its index digest)");
console.log("Next: git add -A && git commit -m 'update catalog' && git push");
