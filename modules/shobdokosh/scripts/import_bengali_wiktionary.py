#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Import explicit English translations from an official Bengali Wiktionary dump.

Only translation templates in translation headings inside an explicitly marked
Bengali language section are accepted. Bengali-only definitions, interwiki
links, quotations and etymological links cannot produce translations.

The source is a pinned, checksum-verified 40.8 MiB Wikimedia dump. Python 3
standard library only. Retain the downloaded .bz2 and pass --source to reproduce
this snapshot after Wikimedia rotates old dumps out of its download service.
"""

import argparse
import bz2
import hashlib
import json
import re
import tempfile
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DUMP_DATE = "20261001"
DUMP_NAME = f"bnwiktionary-{DUMP_DATE}-pages-articles.xml.bz2"
DUMP_URL = f"https://dumps.wikimedia.org/bnwiktionary/{DUMP_DATE}/{DUMP_NAME}"
DUMP_SHA1 = "632e9b8b684f8386b4e37e645303febb21509337"
DEFAULT_EXISTING = [ROOT / f"dist/data/{name}" for name in (
    "dictionary.json", "expanded-dictionary.json", "literary-dictionary.json", "featured.json",
)]
BENGALI = re.compile(r"[\u0980-\u09ff]")
BENGALI_HEADWORD = re.compile(r"^[\u0980-\u09ff\u200c\u200d '\-]+$")
LANGUAGE_HEADING = re.compile(r"^==(?!=)\s*(.*?)\s*(?<!\=)==\s*$", re.M)
BENGALI_LANGUAGE = re.compile(r"\{\{\s*ভাষা\s*\|\s*bn\s*\}\}|বাংলা")
SUBHEADING = re.compile(r"^(={3,})\s*(.*?)\s*\1\s*$")
ENGLISH_TEMPLATE = re.compile(
    r"\{\{\s*(?:t[+\-]?|trad|অনুবাদ)\s*\|\s*en\s*\|\s*([^|{}]+)(?:\|[^{}]*)?\}\}", re.I,
)
PARTS_OF_SPEECH = {
    "বিশেষ্য": "noun", "নামবাচক বিশেষ্য": "proper noun", "বিশেষণ": "adjective",
    "ক্রিয়া": "verb", "ক্রিয়াবিশেষণ": "adverb", "ক্রিয়া বিশেষণ": "adverb",
    "সর্বনাম": "pronoun", "অব্যয়": "particle", "প্রবাদ": "proverb",
    "বাগধারা": "phrase", "নির্দেশক": "determiner", "সংখ্যা": "numeral",
}


def clean(text):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", text or "")).strip()


def lookup_key(text):
    return re.sub(r"[\u200b-\u200d\ufeff]", "", clean(text)).casefold()


def valid_english(text):
    if not re.search(r"[A-Za-z]", text) or len(text) > 180 or len(text.split()) > 20:
        return False
    if re.search(r"[{}\[\]<>|=\n]", text) or BENGALI.search(text):
        return False
    return all(not char.isalpha() or "LATIN" in unicodedata.name(char, "") for char in text)


def bengali_sections(text):
    headings = list(LANGUAGE_HEADING.finditer(text))
    for number, heading in enumerate(headings):
        if BENGALI_LANGUAGE.fullmatch(heading.group(1)):
            end = headings[number + 1].start() if number + 1 < len(headings) else len(text)
            yield text[heading.end():end]


def section_translations(section):
    """Yield only explicit templates; an English mention is never enough."""
    in_translation = False
    translation_level = None
    pos = None
    for line in section.splitlines():
        heading = SUBHEADING.fullmatch(line.strip())
        if heading:
            level, title = len(heading.group(1)), clean(heading.group(2))
            title = re.sub(r"^\[\[(.*?)\]\]$", r"\1", title)
            if title in PARTS_OF_SPEECH:
                pos = PARTS_OF_SPEECH[title]
            elif "ব্যুৎপত্তি" in title:
                pos = None
            if "অনুবাদ" in title:
                in_translation, translation_level = True, level
            elif translation_level is not None and level <= translation_level:
                in_translation, translation_level = False, None
            continue
        if in_translation:
            for match in ENGLISH_TEMPLATE.finditer(line):
                english = clean(match.group(1))
                if valid_english(english):
                    yield english, pos


def page_translations(title, text):
    title = clean(title)
    if not BENGALI.search(title) or not BENGALI_HEADWORD.fullmatch(title):
        return
    text = re.sub(r"<!--.*?-->|<(?:nowiki|pre|code)\b[^>]*>.*?</(?:nowiki|pre|code)>", "", text, flags=re.S | re.I)
    for section in bengali_sections(text):
        for english, pos in section_translations(section):
            yield english, title, pos


def load_existing(paths):
    pairs = set()
    for path in paths:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        entries = data if isinstance(data, list) else data["entries"]
        pairs.update((lookup_key(entry["en"]), lookup_key(word))
                     for entry in entries for word in entry["bn"])
    return pairs


def source_checksum(source):
    checksum = hashlib.sha1()
    with Path(source).open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            checksum.update(chunk)
    return checksum.hexdigest()


def build(source, existing_paths=DEFAULT_EXISTING):
    checksum = source_checksum(source)
    if checksum != DUMP_SHA1:
        raise ValueError(f"Source checksum mismatch: expected {DUMP_SHA1}, got {checksum}")
    existing = load_existing(existing_paths)
    entries = {}
    counts = Counter()
    with bz2.open(source, "rb") as handle:
        for _, element in ET.iterparse(handle, events=["end"]):
            if not element.tag.endswith("}page"):
                continue
            namespace = element.tag[:-4]
            title = element.findtext(namespace + "title") or ""
            if element.findtext(namespace + "ns") != "0":
                element.clear()
                continue
            counts["mainNamespacePages"] += 1
            text = element.findtext(".//" + namespace + "text") or ""
            revision = element.findtext(namespace + "revision/" + namespace + "id")
            selected = list(page_translations(title, text))
            if selected:
                counts["bengaliPagesWithExplicitEnglishTranslations"] += 1
            for english, bengali, pos in selected:
                counts["validExplicitTranslationTemplates"] += 1
                pair = (lookup_key(english), lookup_key(bengali))
                if pair in existing:
                    counts["excludedExistingPairs"] += 1
                    continue
                key = (*pair, pos or "")
                if key in entries:
                    counts["excludedRepeatedSourcePairs"] += 1
                    continue
                identifier = hashlib.sha256("\0".join(key).encode()).hexdigest()[:20]
                query = urllib.parse.urlencode({"title": title, "oldid": revision})
                entry = {"id": "bn-wikt-" + identifier, "en": english, "bn": [bengali],
                         "sourceKind": "direct", "sourceName": "Bengali Wiktionary contributors",
                         "sourceUrl": "https://bn.wiktionary.org/w/index.php?" + query,
                         "sourceLicense": "CC-BY-SA-4.0", "sourcePage": title,
                         "sourceRevision": revision}
                if pos:
                    entry["pos"] = pos
                entries[key] = entry
            element.clear()
    result = sorted(entries.values(), key=lambda entry: (entry["en"].casefold(), entry["bn"], entry["id"]))
    new_heads = {word for entry in result for word in entry["bn"]}
    known_heads = {bengali for _, bengali in existing}
    counts["englishHeadwords"] = len({entry["en"].casefold() for entry in result})
    counts["bengaliHeadwords"] = len(new_heads)
    counts["additionalBengaliHeadwords"] = len({lookup_key(word) for word in new_heads} - known_heads)
    return {"meta": {
        "source": "Bengali Wiktionary contributors; explicit English translation templates",
        "url": "https://bn.wiktionary.org/", "license": "CC BY-SA 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
        "entryCount": len(result), "sourceDumpDate": "2026-10-01", "sourceUrl": DUMP_URL,
        "sourceSha1": checksum,
        "attribution": "Bengali Wiktionary contributors. Every entry links to its source revision; page histories identify the contributing authors. Shobdokosh extracts explicit English translation templates, normalizes text, filters and deduplicates the mappings.",
        "description": "Only explicit English translation templates within translation headings of Bengali language sections are imported. Bengali-only definitions, unrelated languages, quotations and etymologies are not translated. This community data may contain errors or omissions and does not establish complete Tagore coverage.",
        "licenseNotice": "This adapted dataset remains under CC BY-SA 4.0; see sources/BN_WIKTIONARY_NOTICES.md and LICENSE-CC-BY-SA-4.0.txt.",
        "statistics": dict(counts),
    }, "entries": result}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="retained official .xml.bz2 dump")
    parser.add_argument("--existing", type=Path, nargs="+", default=DEFAULT_EXISTING)
    parser.add_argument("--output", type=Path, default=ROOT / "dist/data/bn-wiktionary-dictionary.json")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="shobdokosh-bn-wiktionary-") as temporary:
        source = args.source or Path(temporary) / DUMP_NAME
        if not source.exists():
            request = urllib.request.Request(DUMP_URL, headers={
                "User-Agent": "Shobdokosh-dictionary/1.0 (offline Bengali dictionary importer)",
            })
            with urllib.request.urlopen(request, timeout=90) as response, source.open("wb") as output:
                while chunk := response.read(1024 * 1024):
                    output.write(chunk)
        dictionary = build(source, args.existing)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(dictionary, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "entries": len(dictionary["entries"]),
                      **dictionary["meta"]["statistics"]}, indent=2))


if __name__ == "__main__":
    main()
