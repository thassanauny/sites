#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Build an attributed Bengali literary word inventory, never a definition list.

The researcher's pinned bulk archive avoids thousands of requests to NLTR.
Supplemental Wikisource letters are pinned to revision IDs after discovery.
Downloaded source texts stay in an external cache; only counts, hashes, titles,
and references are written into the app. Python 3 standard library only.
"""

import argparse
import csv
import hashlib
import io
import json
import re
import time
import unicodedata
import urllib.parse
import urllib.error
import urllib.request
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "resources/tagore/sources.json"
REVISIONS = ROOT / "resources/tagore/wikisource-revisions.json"
USER_AGENT = "ShobdokoshDictionaryCorpus/1.0 (Bengali literary vocabulary research)"
TOKEN = re.compile(r"[\u0980-\u09ff]+")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value, *, compact=False):
    temporary = path.with_suffix(path.suffix + ".tmp")
    options = {"separators": (",", ":")} if compact else {"indent": 2}
    temporary.write_text(json.dumps(value, ensure_ascii=False, **options) + "\n")
    temporary.replace(path)


def normalize(text):
    return unicodedata.normalize("NFC", text).replace("\u200c", "").replace("\u200d", "")


def tokenize(text):
    """Preserve nukta/conjuncts; discard Bengali numerals and standalone marks."""
    return [word for word in TOKEN.findall(normalize(text))
            if any(unicodedata.category(char).startswith("L") for char in word)
            and not any(char.isdigit() for char in word)]


def fetch(url, cache, filename, expected_hash=None):
    path = cache / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        data = path.read_bytes()
    else:
        error = None
        for attempt in range(3):
            try:
                request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(request, timeout=60) as response:
                    data = response.read()
                path.write_bytes(data)
                break
            except Exception as exc:
                error = exc
                if attempt < 2:
                    delay = 2 ** attempt
                    if isinstance(exc, urllib.error.HTTPError) and exc.code == 429:
                        delay = max(30, int(exc.headers.get("Retry-After", "30")))
                    time.sleep(delay)
        else:
            raise RuntimeError(f"Could not retrieve {url}: {error}") from error
    if expected_hash and sha256(data) != expected_hash:
        raise ValueError(f"Source hash mismatch: {path}; expected {expected_hash}")
    return data


def wiki_parse(page, cache, revision=None):
    parameters = {"action": "parse", "format": "json", "prop": "text|links|revid", "disabletoc": 1}
    parameters["oldid" if revision else "page"] = revision or page
    url = "https://bn.wikisource.org/w/api.php?" + urllib.parse.urlencode(parameters)
    key = str(revision) if revision else sha256(page.encode())[:24]
    raw = fetch(url, cache, "wikisource/" + key + ".json")
    data = json.loads(raw)
    if "error" in data:
        raise ValueError(f"Wikisource {page}: {data['error']}")
    pinned_cache = cache / "wikisource" / (str(data["parse"]["revid"]) + ".json")
    if not pinned_cache.exists():
        pinned_cache.write_bytes(raw)
    return data["parse"]


class LiteraryText(HTMLParser):
    """Extract transcription content while omitting reader chrome and headings."""
    DROP_CLASSES = {"headertemplate", "footertemplate", "ws-noexport", "noprint",
                    "pagenum", "mw-editsection", "prp-pagequalityheader"}
    VOID_TAGS = {"br", "hr", "img", "input", "meta", "link", "wbr", "source", "area",
                 "base", "col", "embed", "param", "track"}

    def __init__(self):
        super().__init__()
        self.stack = []
        self.parts = []
        self.in_transcription = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = set(attrs.get("class", "").split())
        parent = self.stack[-1] if self.stack else (None, False, False)
        inside = parent[1] or "prp-pages-output" in classes
        blocked = parent[2] or tag in {"script", "style", "noscript"} or bool(classes & self.DROP_CLASSES)
        if tag not in self.VOID_TAGS:
            self.stack.append((tag, inside, blocked))
        if tag in {"p", "div", "br", "tr", "h1", "h2", "h3"}:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.VOID_TAGS:
            return
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break
        if tag in {"p", "div", "tr"}:
            self.parts.append("\n")

    def handle_data(self, text):
        if self.stack and self.stack[-1][1] and not self.stack[-1][2]:
            self.parts.append(text)


def supplemental_records(cache, manifest):
    pinned = json.loads(REVISIONS.read_text()) if REVISIONS.exists() else None
    if pinned:
        chapters = pinned["chapters"]
    else:
        chapters = []
        for book in manifest.get("supplementalBooks", []):
            page = wiki_parse(book["page"], cache)
            titles = [link["*"] for link in page["links"]
                      if link["ns"] == 0 and link["*"].startswith(book["page"] + "/")
                      and "exists" in link]
            if not titles:
                raise ValueError(f"No chapter transcriptions for {book['page']}")
            for title in sorted(set(titles)):
                chapters.append({"title": title, "collection": book["page"]})

    def load(chapter):
        parsed = wiki_parse(chapter["title"], cache, chapter.get("revision"))
        parser = LiteraryText()
        parser.feed(parsed["text"]["*"])
        content = "".join(parser.parts).strip()
        if len(tokenize(content)) < 10:
            raise ValueError(f"Empty or unexpectedly short transcription: {chapter['title']}")
        revision = parsed["revid"]
        digest = sha256(content.encode())
        if chapter.get("textSha256") and chapter["textSha256"] != digest:
            raise ValueError(f"Transcription hash mismatch: {chapter['title']}")
        return {"name": chapter["title"].split("/")[-1], "collection": chapter["collection"],
                "genre": "পত্রসাহিত্য", "content": content, "sourceId": "wikisource",
                "url": "https://bn.wikisource.org/w/index.php?" + urllib.parse.urlencode({"oldid": revision}),
                "sourceRevision": revision, "sourceTitle": parsed["title"], "textSha256": digest}

    # Keep origin load modest; every chapter is cached and pinned after discovery.
    records = []
    for chapter in chapters:
        cache_key = str(chapter["revision"]) if chapter.get("revision") else sha256(chapter["title"].encode())[:24]
        cached = (cache / "wikisource" / (cache_key + ".json")).exists()
        records.append(load(chapter))
        if not cached:
            time.sleep(1)
    if not pinned:
        write_json(REVISIONS, {"chapters": [
            {"title": r["sourceTitle"], "collection": r["collection"],
             "revision": r["sourceRevision"], "textSha256": r["textSha256"]}
            for r in records]})
    return records


def build(cache, output, include_letters=True):
    manifest = json.loads(MANIFEST.read_text())
    source = manifest["bulkSource"]
    archive = fetch(source["downloadUrl"], cache, "complete-works-v2.zip", source["sha256"])
    csv.field_size_limit(20_000_000)
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        csv_data = zipped.read("csv/all_collection.csv")
        records = list(csv.DictReader(io.StringIO(csv_data.decode("utf-8-sig"))))
    if len(records) != source["expectedRecordCount"]:
        raise ValueError(f"Unexpected bulk record count: {len(records)}")
    for i, record in enumerate(records, 2):
        record.update({"sourceId": "rabindranet-v2", "sourceRow": i,
                       "url": source["url"]})
    if include_letters:
        records.extend(supplemental_records(cache, manifest))

    words = Counter()
    word_sources = defaultdict(list)
    word_genres = defaultdict(Counter)
    works = []
    genre_records = Counter()
    genre_tokens = Counter()
    collection_set = set()
    source_records = Counter()
    primary_inventory = MANIFEST.parent / "nltr-category-inventory.json"
    collection_urls = {}
    if primary_inventory.exists():
        for category in json.loads(primary_inventory.read_text())["categories"]:
            for entry in category["entries"]:
                collection_urls.setdefault(normalize(entry["title"]), entry["url"])
    for record in records:
        content = record.pop("content")
        digest = sha256(content.encode())
        identity = "\0".join([record["sourceId"], record["collection"], record["name"], digest])
        work_id = sha256(identity.encode())[:16]
        counts = Counter(tokenize(content))
        words.update(counts)
        for word, count in counts.items():
            word_genres[word][record["genre"]] += count
            if len(word_sources[word]) < 2:
                word_sources[word].append(work_id)
        work = {"id": work_id, "title": record["name"], "collection": record["collection"],
                "genre": record["genre"], "url": record["url"], "sha256": digest,
                "tokenCount": sum(counts.values()), "sourceId": record["sourceId"]}
        for field in ("sourceRevision", "sourceTitle", "sourceRow"):
            if field in record:
                work[field] = record[field]
        if normalize(record["collection"]) in collection_urls:
            work["collectionUrl"] = collection_urls[normalize(record["collection"])]
        works.append(work)
        genre_records[work["genre"]] += 1
        genre_tokens[work["genre"]] += work["tokenCount"]
        source_records[work["sourceId"]] += 1
        collection_set.add(work["collection"])

    timestamp = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    source_urls = [source["url"], source["originalDigitization"]]
    coverage_scope = manifest["coverageScope"]
    if source_records.get("wikisource"):
        source_urls.extend("https://bn.wikisource.org/wiki/" + urllib.parse.quote(book["page"].replace(" ", "_"))
                           for book in manifest.get("supplementalBooks", []))
        coverage_scope += f" Supplemented with {source_records['wikisource']} revision-pinned published literary letters from Bengali Wikisource."
    metadata = {"schemaVersion": 1, "author": "Rabindranath Tagore", "language": "bn",
                "retrievedAt": timestamp, "documentCount": len(works),
                "collectionCount": len(collection_set), "tokenCount": sum(words.values()),
                "uniqueWordCount": len(words), "recordCountsBySource": dict(source_records),
                "genres": [{"genre": genre, "records": count, "tokens": genre_tokens[genre]}
                           for genre, count in sorted(genre_records.items())],
                "sourceUrls": source_urls, "referenceUrls": manifest["sourceUrls"], "coverageScope": coverage_scope,
                "coverageStatus": "broad-source-corpus-not-complete-author-bibliography",
                "limitations": manifest["limitations"], "normalization":
                "NFC; remove ZWJ/ZWNJ; Bengali-script word runs; exclude numerals and isolated marks; preserve inflections and names",
                "archiveSha256": source["sha256"], "sourceCsvSha256": sha256(csv_data)}
    result = {"meta": metadata,
              "words": [{"word": word, "count": count, "exampleSources": word_sources[word],
                         "countsByGenre": dict(sorted(word_genres[word].items()))}
                        for word, count in sorted(words.items(), key=lambda item: (-item[1], item[0]))],
              "works": works}
    output.parent.mkdir(parents=True, exist_ok=True)
    write_json(output, result, compact=True)
    inventory = {"meta": metadata, "collections": sorted(collection_set), "works": works}
    write_json(MANIFEST.parent / "inventory.json", inventory)
    print(json.dumps({"output": str(output), "bytes": output.stat().st_size, "meta": metadata},
                     ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path, default=Path.home() / ".cache/shobdokosh/tagore")
    parser.add_argument("--output", type=Path, default=ROOT / "resources/tagore/vocabulary.json")
    parser.add_argument("--skip-letters", action="store_true", help="Use only the pinned research bulk corpus")
    arguments = parser.parse_args()
    build(arguments.cache_dir, arguments.output, not arguments.skip_letters)


if __name__ == "__main__":
    main()
