#!/usr/bin/env python3
"""
pull_fda_dockets.py — pull public comments (metadata + full text + attachments)
from regulations.gov v4 for the FDA AI-device dockets.

Default dockets:
  FDA-2025-N-2338  DHAC, GenAI-enabled digital mental health devices (Nov 2025)
  FDA-2025-N-4203  RFC, measuring real-world performance of AI-enabled devices
  FDA-2024-N-3924  DHAC, TPLC considerations for GenAI-enabled devices (Nov 2024)

Why this is not a one-liner: the v4 API cannot filter comments by docket. You
must first get the docket's documents, take each document's objectId, then
filter comments by commentOnId. And the list endpoint returns metadata only —
the substantive submissions are PDF/DOCX attachments, fetched per-comment from
the detail endpoint.

Setup:
    pip install requests pypdf pdfplumber python-docx
    Get a free key (1,000 req/hr) at https://api.data.gov/signup
    export REGULATIONS_GOV_API_KEY=...

Usage:
    python pull_fda_dockets.py                       # all three dockets
    python pull_fda_dockets.py --docket FDA-2025-N-4203
    python pull_fda_dockets.py --out ./corpus --no-attachments
    python pull_fda_dockets.py --dry-run             # counts only, no download

Output (under --out, default ./fda_ai_dockets):
    comments.csv                 one row per comment, metadata + text lengths
    comments.jsonl               full records incl. inline text + extracted text
    raw/<COMMENT-ID>.json        untouched API detail response
    attachments/<COMMENT-ID>/    original PDFs/DOCXs as filed
    text/<COMMENT-ID>.txt        inline comment + extracted attachment text

Re-running skips work already on disk, so an interrupted run resumes cleanly.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
from collections import deque
from pathlib import Path

import requests

API = "https://api.regulations.gov/v4"

DEFAULT_DOCKETS = [
    "FDA-2025-N-2338",
    "FDA-2025-N-4203",
    "FDA-2024-N-3924",
]

PAGE_SIZE = 250          # API maximum
MAX_PAGES = 20           # API caps a single query at 20 pages (5,000 records)
HOURLY_BUDGET = 950      # stay under the 1,000/hr key limit


# --------------------------------------------------------------------------
# rate-limited HTTP
# --------------------------------------------------------------------------

class Client:
    """Thin wrapper: injects the key, self-throttles, retries on 429/5xx."""

    def __init__(self, api_key: str, verbose: bool = True):
        self.key = api_key
        self.verbose = verbose
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": "docket-puller/1.0"})
        self._calls: deque[float] = deque()

    def _throttle(self) -> None:
        now = time.time()
        while self._calls and now - self._calls[0] > 3600:
            self._calls.popleft()
        if len(self._calls) >= HOURLY_BUDGET:
            wait = 3600 - (now - self._calls[0]) + 5
            self._log(f"  hourly budget reached; sleeping {wait/60:.1f} min")
            time.sleep(wait)
        self._calls.append(time.time())

    def _log(self, msg: str) -> None:
        if self.verbose:
            print(msg, flush=True)

    def get(self, path: str, params: dict | None = None, tries: int = 6) -> dict:
        params = dict(params or {})
        params["api_key"] = self.key
        url = f"{API}/{path.lstrip('/')}"
        backoff = 5.0
        for attempt in range(1, tries + 1):
            self._throttle()
            try:
                r = self.session.get(url, params=params, timeout=60)
            except requests.RequestException as exc:
                if attempt == tries:
                    raise
                self._log(f"  network error ({exc}); retry in {backoff:.0f}s")
                time.sleep(backoff)
                backoff *= 2
                continue

            if r.status_code == 200:
                return r.json()

            if r.status_code == 429:
                # Key exhausted, or DEMO_KEY's 10/hr shared ceiling.
                retry_after = int(r.headers.get("Retry-After", 0)) or int(backoff)
                self._log(f"  429 rate-limited; sleeping {retry_after}s "
                          f"(attempt {attempt}/{tries})")
                time.sleep(retry_after)
                backoff = min(backoff * 2, 900)
                continue

            if r.status_code in (500, 502, 503, 504):
                self._log(f"  {r.status_code} server error; retry in {backoff:.0f}s")
                time.sleep(backoff)
                backoff *= 2
                continue

            raise RuntimeError(f"{r.status_code} on {url}\n{r.text[:400]}")

        raise RuntimeError(f"gave up after {tries} attempts: {url}")

    def download(self, url: str, dest: Path, tries: int = 4) -> bool:
        """Attachment files live on downloads.regulations.gov — no key needed.

        The CDN rejects non-browser User-Agents with 403, so send a browser UA
        for the file fetch (the API session's own UA is left untouched).
        """
        browser_headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                          "AppleWebKit/537.36 (KHTML, like Gecko) "
                          "Chrome/124.0.0.0 Safari/537.36",
        }
        backoff = 4.0
        for attempt in range(1, tries + 1):
            try:
                r = self.session.get(url, timeout=120, headers=browser_headers)
                if r.status_code == 200:
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(r.content)
                    return True
                if r.status_code == 429:
                    time.sleep(int(r.headers.get("Retry-After", 0)) or backoff)
                    backoff *= 2
                    continue
                self._log(f"    ! {r.status_code} downloading {url}")
                return False
            except requests.RequestException as exc:
                if attempt == tries:
                    self._log(f"    ! failed {url}: {exc}")
                    return False
                time.sleep(backoff)
                backoff *= 2
        return False


# --------------------------------------------------------------------------
# API traversal
# --------------------------------------------------------------------------

def docket_documents(client: Client, docket_id: str) -> list[dict]:
    """Every document in a docket. objectId is the join key for comments."""
    docs, page = [], 1
    while page <= MAX_PAGES:
        payload = client.get("documents", {
            "filter[docketId]": docket_id,
            "page[size]": PAGE_SIZE,
            "page[number]": page,
            "sort": "documentId",
        })
        batch = payload.get("data", [])
        docs.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        page += 1
    return docs


def comments_for_object(client: Client, object_id: str) -> list[dict]:
    """
    All comments attached to one document.

    Pages 250 at a time. If a document somehow exceeds the API's 5,000-record
    ceiling, we re-enter using lastModifiedDate as a cursor — the standard
    workaround, since page[number] cannot exceed 20.
    """
    seen: dict[str, dict] = {}
    cursor: str | None = None

    while True:
        page, last_modified = 1, None
        while page <= MAX_PAGES:
            params = {
                "filter[commentOnId]": object_id,
                "page[size]": PAGE_SIZE,
                "page[number]": page,
                "sort": "lastModifiedDate,documentId",
            }
            if cursor:
                params["filter[lastModifiedDate][ge]"] = cursor
            payload = client.get("comments", params)
            batch = payload.get("data", [])
            for item in batch:
                seen[item["id"]] = item
                last_modified = item["attributes"].get("lastModifiedDate") or last_modified
            if len(batch) < PAGE_SIZE:
                return list(seen.values())
            page += 1

        # Hit 20 pages — advance the cursor and go round again.
        if not last_modified or last_modified == cursor:
            return list(seen.values())
        cursor = last_modified


def comment_detail(client: Client, comment_id: str, raw_dir: Path) -> dict:
    """Detail endpoint: inline comment body + attachment file URLs. Cached."""
    cached = raw_dir / f"{comment_id}.json"
    if cached.exists():
        try:
            return json.loads(cached.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass  # corrupt cache, refetch
    payload = client.get(f"comments/{comment_id}", {"include": "attachments"})
    cached.parent.mkdir(parents=True, exist_ok=True)
    cached.write_text(json.dumps(payload, indent=1), encoding="utf-8")
    return payload


# --------------------------------------------------------------------------
# attachments and text extraction
# --------------------------------------------------------------------------

SAFE = re.compile(r"[^A-Za-z0-9._-]+")


def safe_name(name: str, fallback: str) -> str:
    name = SAFE.sub("_", (name or "").strip())[:120]
    return name or fallback


def attachment_urls(detail: dict) -> list[tuple[str, str]]:
    """[(fileUrl, suggested filename)] across all attachments on a comment."""
    out = []
    for inc in detail.get("included", []) or []:
        attrs = inc.get("attributes", {})
        title = attrs.get("title") or "attachment"
        for fmt in attrs.get("fileFormats") or []:
            url = fmt.get("fileUrl")
            if not url:
                continue
            ext = os.path.splitext(url.split("?")[0])[1] or ".bin"
            out.append((url, safe_name(title, "attachment") + ext))
    return out


def extract_text(path: Path) -> str:
    """PDF (pypdf, pdfplumber fallback), DOCX, or plain text. Never raises."""
    suffix = path.suffix.lower()
    try:
        if suffix == ".pdf":
            try:
                from pypdf import PdfReader
                pages = [p.extract_text() or "" for p in PdfReader(str(path)).pages]
                text = "\n".join(pages).strip()
                if len(text) > 40:
                    return text
            except Exception:
                pass
            try:
                import pdfplumber
                with pdfplumber.open(str(path)) as pdf:
                    return "\n".join((p.extract_text() or "") for p in pdf.pages).strip()
            except Exception:
                return ""
        if suffix in (".docx", ".doc"):
            try:
                import docx
                return "\n".join(p.text for p in docx.Document(str(path)).paragraphs).strip()
            except Exception:
                return ""
        if suffix in (".txt", ".htm", ".html", ".rtf"):
            return path.read_text(encoding="utf-8", errors="ignore").strip()
    except Exception:
        return ""
    return ""


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

CSV_FIELDS = [
    "docket_id", "comment_id", "title", "organization", "submitter_name",
    "submitter_type", "posted_date", "received_date", "page_count",
    "n_attachments", "inline_chars", "attachment_chars", "total_chars",
    "url", "text_file",
]


def process_docket(client: Client, docket_id: str, out: Path,
                   fetch_attachments: bool, dry_run: bool) -> list[dict]:
    print(f"\n=== {docket_id} ===", flush=True)
    documents = docket_documents(client, docket_id)
    print(f"  {len(documents)} document(s) in docket", flush=True)

    comment_stubs: dict[str, dict] = {}
    for doc in documents:
        object_id = doc["attributes"].get("objectId")
        if not object_id:
            continue
        found = comments_for_object(client, object_id)
        if found:
            print(f"  {doc['id']}: {len(found)} comment(s)", flush=True)
        for c in found:
            comment_stubs[c["id"]] = c

    print(f"  {len(comment_stubs)} unique comment(s) total", flush=True)
    if dry_run:
        return []

    raw_dir, att_dir, txt_dir = out / "raw", out / "attachments", out / "text"
    for d in (raw_dir, att_dir, txt_dir):
        d.mkdir(parents=True, exist_ok=True)

    rows = []
    for i, comment_id in enumerate(sorted(comment_stubs), 1):
        print(f"  [{i}/{len(comment_stubs)}] {comment_id}", flush=True)
        detail = comment_detail(client, comment_id, raw_dir)
        attrs = detail.get("data", {}).get("attributes", {})

        inline = (attrs.get("comment") or "").strip()
        pieces = [inline] if inline else []
        files = attachment_urls(detail)

        if fetch_attachments:
            for url, filename in files:
                dest = att_dir / comment_id / filename
                if not dest.exists():
                    client.download(url, dest)
                if dest.exists():
                    body = extract_text(dest)
                    if body:
                        pieces.append(f"\n\n[[attachment: {filename}]]\n{body}")
                    else:
                        print(f"    ~ no text extracted from {filename} "
                              f"(likely scanned; needs OCR)", flush=True)

        text = "\n".join(pieces).strip()
        text_path = txt_dir / f"{comment_id}.txt"
        if text:
            text_path.write_text(text, encoding="utf-8")

        attachment_chars = max(len(text) - len(inline), 0)
        rows.append({
            "docket_id": docket_id,
            "comment_id": comment_id,
            "title": attrs.get("title") or "",
            "organization": attrs.get("organization") or "",
            "submitter_name": " ".join(
                x for x in (attrs.get("firstName"), attrs.get("lastName")) if x
            ),
            "submitter_type": attrs.get("submitterType") or "",
            "posted_date": attrs.get("postedDate") or "",
            "received_date": attrs.get("receiveDate") or "",
            "page_count": attrs.get("pageCount") or "",
            "n_attachments": len(files),
            "inline_chars": len(inline),
            "attachment_chars": attachment_chars,
            "total_chars": len(text),
            "url": f"https://www.regulations.gov/comment/{comment_id}",
            "text_file": str(text_path.relative_to(out)) if text else "",
        })
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--docket", action="append", dest="dockets",
                    help="docket ID (repeatable); defaults to the three FDA AI dockets")
    ap.add_argument("--key", default=os.environ.get("REGULATIONS_GOV_API_KEY"),
                    help="regulations.gov API key (or set REGULATIONS_GOV_API_KEY)")
    ap.add_argument("--out", default="fda_ai_dockets", help="output directory")
    ap.add_argument("--no-attachments", action="store_true",
                    help="metadata + inline text only; skip PDF/DOCX download")
    ap.add_argument("--dry-run", action="store_true",
                    help="report comment counts without downloading anything")
    args = ap.parse_args()

    if not args.key:
        print("No API key. Get one free at https://api.data.gov/signup, then:\n"
              "  export REGULATIONS_GOV_API_KEY=your_key\n"
              "DEMO_KEY works but is capped at 10 requests/hour shared globally, "
              "which is not enough for a docket.", file=sys.stderr)
        return 2

    dockets = args.dockets or DEFAULT_DOCKETS
    out = Path(args.out).expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)
    client = Client(args.key)

    all_rows: list[dict] = []
    for docket_id in dockets:
        try:
            all_rows.extend(process_docket(
                client, docket_id, out,
                fetch_attachments=not args.no_attachments,
                dry_run=args.dry_run,
            ))
        except Exception as exc:
            print(f"  ! {docket_id} failed: {exc}", file=sys.stderr)

    if args.dry_run or not all_rows:
        return 0

    csv_path = out / "comments.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(all_rows)

    jsonl_path = out / "comments.jsonl"
    with jsonl_path.open("w", encoding="utf-8") as fh:
        for row in all_rows:
            record = dict(row)
            tf = row["text_file"]
            record["text"] = (out / tf).read_text(encoding="utf-8", errors="ignore") if tf else ""
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")

    empty = sum(1 for r in all_rows if r["total_chars"] == 0)
    with_att = sum(1 for r in all_rows if r["n_attachments"])
    print(f"\n{len(all_rows)} comments -> {csv_path}")
    print(f"{with_att} have attachments; {empty} yielded no text "
          f"(scanned images or withheld — check those by hand)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
