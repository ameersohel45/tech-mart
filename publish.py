#!/usr/bin/env python3
"""
publish.py — recompute the DeDi digest chain for this bucket after editing catalogs.

Run from the repo root, after editing any catalog JSON:

    python3 publish.py              # update the index's parts[].digest from the catalog files
    python3 publish.py --manifest   # ALSO refresh the manifest's files[].digest (optional)

Why: the crawler verifies each file against the sha-256 declared for it in its parent
(catalog -> index parts[].digest, index -> manifest files[].digest). This script hashes the
ACTUAL file bytes (the whole file, trailing newline included) — exactly what GitHub raw serves
and the crawler checks — so you never hand-compute a hash or lose the trailing newline again.

By default it touches ONLY the index (that's all a catalog edit needs to sync). Pass --manifest
if you also want the manifest's index digest refreshed (keeps the daily integrity checkpoint green).
Edits are surgical — only the digest string changes — so diffs stay clean.
"""
import json
import hashlib
import os
import sys
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
MANIFEST = os.path.join(ROOT, ".well-known", "dedi.json")
UPDATE_MANIFEST = "--manifest" in sys.argv


def sha256_of(path):
    """sha-256 of the exact file bytes (trailing newline included)."""
    with open(path, "rb") as f:
        return "sha-256:" + hashlib.sha256(f.read()).hexdigest()


def url_to_local(url):
    """Map a raw.githubusercontent.com URL to a repo-relative file path.
    Handles both /<owner>/<repo>/<branch>/<path> and /<owner>/<repo>/refs/heads/<branch>/<path>."""
    parts = urlparse(url).path.lstrip("/").split("/")
    rel = parts[5:] if parts[2:4] == ["refs", "heads"] else parts[3:]
    return os.path.join(ROOT, *rel)


def swap_digest(path, old, new):
    """Replace one occurrence of `old` with `new` in `path`. Returns True if it changed."""
    if old == new:
        return False
    text = open(path, encoding="utf-8").read()
    if old not in text:
        sys.exit(f"ERROR: digest {old} not found in {path} (was the file edited elsewhere?)")
    open(path, "w", encoding="utf-8").write(text.replace(old, new, 1))
    return True


def main():
    manifest = json.load(open(MANIFEST))
    changed = False
    for fref in manifest["files"]:
        index_path = url_to_local(fref["url"])
        index = json.load(open(index_path))
        for record in index.get("records", []):
            for part in record["details"].get("parts", []):
                new = sha256_of(url_to_local(part["url"]))
                if swap_digest(index_path, part["digest"], new):
                    changed = True
                    print(f"  index part [{os.path.basename(url_to_local(part['url']))}] -> {new}")
        if UPDATE_MANIFEST:
            new_index = sha256_of(index_path)
            if swap_digest(MANIFEST, fref["digest"], new_index):
                changed = True
                print(f"  manifest [{os.path.basename(index_path)}] -> {new_index}")

    print("digest chain " + ("updated." if changed else "already up to date."))
    if not UPDATE_MANIFEST:
        print("(manifest left untouched — pass --manifest to also refresh its index digest)")
    print("Next: commit & push, e.g.  git add -A && git commit -m 'update catalog' && git push")


if __name__ == "__main__":
    main()
