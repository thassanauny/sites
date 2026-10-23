#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Extract native Bengali definitions from the checksum-pinned official dump.

This is a monolingual dictionary, not a generated bilingual word list. Only
explicit definition lists in Bengali language sections are accepted. The
source's examples, quotations, etymologies and other-language sections are
not definitions, and relation-only forms are not counted as lexical entries.
"""

import argparse
from collections import Counter, defaultdict
import hashlib
import html
import json
from pathlib import Path
import random
import re
import sys
import tempfile
import urllib.parse
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parent))
from import_reading_dictionary import (  # noqa: E402
    BN, DUMP_NAME, DUMP_SHA1, DUMP_URL, HEADING, POS, ROOT,
    checksum, clean, key, pages, sections,
)


NATIVE_POS = {**POS, "শব্দগুচ্ছ": "phrase", "পদান্বয়ী অব্যয়": "postposition",
              "অনুসর্গ": "postposition", "উপসর্গ": "prefix", "প্রত্যয়": "suffix",
              "আবেগসূচক অব্যয়": "interjection", "সর্বনাম বিশেষণ": "determiner",
              "ধ্বন্যাত্মক অব্যয়": "interjection", "যোজক": "conjunction"}
MEANING_HEADINGS = {"অর্থ", "সংজ্ঞা", "ভাবার্থ", "অভিধানগত অর্থ", "শব্দার্থ"}
HEAD_POS = {"noun": "noun", "proper noun": "proper noun", "adjective": "adjective",
            "verb": "verb", "adverb": "adverb", "pronoun": "pronoun",
            "particle": "particle", "phrase": "phrase", "proverb": "proverb",
            "suffix": "suffix", "prefix": "prefix", "interjection": "interjection"}
LINK = re.compile(r"\[\[([^\[\]]+)\]\]")
TEMPLATE = re.compile(r"\{\{([^{}]+)\}\}")
RELATION = re.compile(
    r"(?:^(?:দেখুন|দ্রষ্টব্য|আরও দেখুন|see(?: also)?|cf\.?)[ :।]|"
    r"(?:এর|শব্দের)\s+(?:বিকল্প (?:রূপ|বানান)|বানানভেদ|ভুল বানান|বহুবচন|একবচন|"
    r"স্ত্রীলিঙ্গ(?: রূপ)?|পুংলিঙ্গ(?: রূপ)?|সংক্ষিপ্ত রূপ)|"
    r"\b(?:alternative (?:form|spelling)|plural|singular|inflection|conjugation|"
    r"feminine|masculine|female equivalent|obsolete spelling|variant spelling) of\b)", re.I,
)
RELATION_TEMPLATES = re.compile(
    r"\{\{\s*(?:alternative|alt(?:\s|sp|form)|form of|inflection|plural|singular|"
    r"feminine|masculine|obsolete spelling|archaic (?:spelling|form)|"
    r"pronunciation spelling|abbreviation|acronym|clipping|ellipsis|syn(?:onym)?(?:\s|\|)|"
    r"এর (?:বিকল্প|বানানভেদ|ভুল বানান|বহুবচন|একবচন|সংক্ষিপ্ত))", re.I,
)
RELATION_ONLY = re.compile(
    r"^[^।;]{1,85}(?:কথ্য|আঞ্চলিক|বিকৃত|সাধু|চলিত|অশুদ্ধ|প্রচলিত)"
    r"(?: (?:ও|অধিকতর|প্রচলিত|বিকৃত|আঞ্চলিক))* রূপ[।.]?$"
)
# These source pages give finite forms the POS 'adverb' and repeat the root's
# broad verb senses. They are neither reliable adverb definitions nor extra
# lexical heads. Exclude the bounded reviewed defect, not suffixes in general.
REVIEWED_INVALID_POS = {(word, "adverb") for word in (
    "এঁটেছিলাম", "এঁটেছিলেন", "এঁটেছে", "এঁটেছেন",
    "এনেছিলাম", "এনেছিলেন", "এনেছে", "এনেছেন",
    "করছিলাম", "করছিলেন", "করছে", "করছেন", "করবেন", "করলাম",
)}
REVIEWED_FORM_ONLY = {(word, "verb") for word in (
    "কাটছিলে", "কাটছিলেন", "কাটছিস", "কাটছে", "কাটছেন", "কাটত", "কাটতাম",
    "কাটতিস", "কাটতে", "কাটতে-কাটতে", "কাটতেন", "কাটব", "কাটবি", "কাটবে",
    "কাটবেন", "কাটল", "কাটলাম", "কাটলি", "কাটলে", "কাটলেন", "কাটান",
    "কাটিস", "কাটেন", "কাটো",
)}


def valid_headword(title):
    """Allow actual dictionary phrases and punctuation, never a generated form."""
    return (bool(BN.search(title)) and len(title) <= 180 and len(title.split()) <= 24
            and not re.search(r"[A-Za-z{}\[\]<>|:=/\\]", title)
            and not title.startswith(("#", "*")))


def heading_name(raw):
    raw = re.sub(r"^\[\[(.*?)\]\]$", r"\1", clean(raw))
    return re.sub(r"^\{\{\s*([^{}|]+)\s*\}\}$", r"\1", raw).strip()


def definition_lines(section):
    """Read numbered senses and old-style bullets under explicit meaning headings."""
    fallback = set()
    for name, pos in NATIVE_POS.items():
        if re.search(r"\{\{\s*" + re.escape(name) + r"\s*\|\s*bn(?:\||\}\})", section):
            fallback.add(pos)
    for value in re.findall(r"\{\{\s*head\|bn\|([^|{}]+)", section):
        if value in HEAD_POS:
            fallback.add(HEAD_POS[value])
    # Idiom pages consistently use this headword template and ভাবার্থ.
    if re.search(r"\{\{\s*বাগধারা\s*\|\s*bn(?:\||\}\})", section):
        fallback.add("phrase")
    default = next(iter(fallback)) if len(fallback) == 1 else ""
    pos, in_meanings = "", False
    for line in section.splitlines():
        if heading := HEADING.fullmatch(line.strip()):
            name = heading_name(heading.group(2))
            if name in NATIVE_POS:
                pos, in_meanings = NATIVE_POS[name], True
            elif name in MEANING_HEADINGS:
                pos, in_meanings = pos or default, True
            else:
                in_meanings = False
            continue
        if not in_meanings:
            continue
        match = re.match(r"^#{1,5}(?![#:*])\s*(.+)$", line)
        if not match:
            match = re.match(r"^\*(?![:*#])\s*(.+)$", line)
        if match:
            yield pos, match.group(1).strip()


def render_definition(raw):
    """Render known inline markup; reject unknown templates instead of guessing."""
    if RELATION_TEMPLATES.search(raw):
        return None
    labels = []

    def template(match):
        parts = [value.strip() for value in match.group(1).split("|")]
        name, args = parts[0].lower(), parts[1:]
        positional = [arg for arg in args if "=" not in arg]
        named = dict(arg.split("=", 1) for arg in args if "=" in arg)
        if name in {"lb", "label", "লেবেল"} and positional and positional[0] == "bn":
            values = [value.replace("_", " ") for value in positional[1:] if value != "_"]
            labels.extend(values)
            return ""
        if name in {"q", "qualifier", "qual"}:
            labels.extend(value.replace("_", " ") for value in positional)
            return ""
        if name in {"l", "m", "link", "mention"} and len(positional) >= 2:
            return named.get("alt") or (positional[2] if len(positional) > 2 and positional[2] else positional[1])
        if name == "w" and positional:
            return positional[1] if len(positional) > 1 and positional[1] else positional[0]
        if name in {"gloss", "gl"} and positional:
            return "(" + positional[0] + ")"
        if name in {"n-g", "non-gloss definition"} and positional:
            return positional[0]
        if name in {"taxlink", "taxfmt"} and positional:
            return positional[2] if len(positional) > 2 and positional[2] else positional[0]
        if name in {"senseid", "anchor"}:
            return ""
        # Place/name/form templates require expansion rules or a referenced
        # lemma; their presence alone is not a native-language definition.
        return match.group(0)

    body = re.sub(r"<!--.*?-->", "", raw, flags=re.S)
    body = re.sub(r"<ref\b[^>]*(?:/>|>.*?</ref\s*>)", "", body, flags=re.S | re.I)
    for _ in range(6):
        rendered = TEMPLATE.sub(template, body)
        if rendered == body:
            break
        body = rendered
    if re.search(r"[{}<>]", body):
        return None

    def link(match):
        parts = match.group(1).split("|")
        target = parts[0]
        if re.match(r"(?:file|image|category|বিষয়শ্রেণী|চিত্র|ফাইল):", target, re.I):
            return ""
        return (parts[-1] if len(parts) > 1 else target.split("#", 1)[0]).replace("_", " ")

    body = LINK.sub(link, body)
    body = re.sub(r"\[(?:https?://\S+)\s+([^\]]+)\]", r"\1", body)
    body = re.sub(r"'{2,}", "", body)
    body = clean(html.unescape(body))
    body = re.sub(r"^[#*:;\s]+", "", body).strip()
    if (not body or len(body) > 1800 or re.search(r"[{}\[\]<>|]", body)
            or re.search(r"https?://", body) or RELATION.search(body) or RELATION_ONLY.fullmatch(body)
            or re.fullmatch(r"(?:অর্থ|সংজ্ঞা|ভাবার্থ|বিশেষ্য|বিশেষণ)\s*[:।.]?", body)
            or re.fullmatch(r"প্রচলিত\s+sense[।.]?", body, re.I)
            or "সংক্রান্ত নির্দিষ্ট ভাব, অবস্থা বা প্রক্রিয়া" in body):
        return None
    letters = [char for char in body if char.isalpha()]
    bengali = [char for char in letters if BN.fullmatch(char)]
    if len(bengali) < 2 or len(bengali) < len(letters) * 0.4:
        return None
    labels = list(dict.fromkeys(clean(html.unescape(label)) for label in labels if label))
    if any(re.search(r"[{}\[\]<>|]", label) for label in labels):
        return None
    prefix = "(" + "; ".join(labels) + ") " if labels else ""
    return prefix + body, labels


def extract_page(title, text, revision):
    title = clean(title)
    if not valid_headword(title):
        return []
    grouped = defaultdict(lambda: {"definitions": [], "labels": []})
    for language, section in sections(text):
        if language != "bn":
            continue
        for pos, raw in definition_lines(section):
            if (title, pos) in REVIEWED_INVALID_POS | REVIEWED_FORM_ONLY:
                continue
            value = render_definition(raw)
            if value:
                definition, labels = value
                group = grouped[pos]
                if definition not in group["definitions"]:
                    group["definitions"].append(definition)
                group["labels"].extend(label for label in labels if label not in group["labels"])
    entries = []
    for pos, group in grouped.items():
        fingerprint = key(title) + "\0" + pos
        query = urllib.parse.urlencode({"title": title, "oldid": revision})
        entry = {"id": "native-bn-" + hashlib.sha256(fingerprint.encode()).hexdigest()[:20],
                 "en": "", "bn": [title], "headword": title, "language": "bn",
                 "definitionsBn": group["definitions"],
                 "sourceKind": "native", "sourceName": "Bengali Wiktionary contributors",
                 "sourceUrl": "https://bn.wiktionary.org/w/index.php?" + query,
                 "sourcePage": title, "sourceRevision": revision,
                 "sourceLicense": "CC-BY-SA-4.0"}
        if pos:
            entry["pos"] = pos
        if group["labels"]:
            entry["sourceLabels"] = group["labels"]
        entries.append(entry)
    return entries


def build(source):
    if checksum(source, "sha1") != DUMP_SHA1:
        raise ValueError("Source does not match the pinned official dump checksum")
    entries, stats, seen = [], Counter(), set()
    for title, text, revision in pages(source):
        if not valid_headword(clean(title)):
            continue
        selected = extract_page(title, text, revision)
        if selected:
            stats["sourcePagesWithDefinitions"] += 1
        for entry in selected:
            if entry["id"] in seen:
                continue
            seen.add(entry["id"])
            entries.append(entry)
            stats["definitionCount"] += len(entry["definitionsBn"])
            stats["pos:" + entry.get("pos", "unspecified")] += 1
    entries.sort(key=lambda entry: (key(entry["headword"]), entry.get("pos", ""), entry["id"]))
    heads = {key(entry["headword"]) for entry in entries}
    stats["bengaliHeadwords"] = len(heads)
    stats["englishHeadwords"] = 0
    stats["singleWordHeadwords"] = sum(" " not in head for head in heads)
    stats["multiwordHeadwords"] = sum(" " in head for head in heads)
    return {"meta": {
        "source": "Bengali Wiktionary contributors; native Bengali definitions",
        "url": "https://bn.wiktionary.org/", "license": "CC BY-SA 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
        "entryCount": len(entries), "sourceUrl": DUMP_URL,
        "sourceDumpDate": "2026-10-01", "sourceSha1": DUMP_SHA1,
        "description": "Native Bengali dictionary meanings, not generated English translations. Each real source headword retains its explicit Bengali definitions grouped by part of speech. Source-defined phrases and proverbs are counted separately from single-word headwords. Examples, quotations, other-language sections, relation-only forms and unrenderable template lines are excluded. Community entries can contain errors; literary completeness is not claimed.",
        "attribution": "Bengali Wiktionary contributors. Every entry links to its source revision and contributing authors through page history. Shobdokosh filters, renders, normalizes and groups the source definitions.",
        "licenseNotice": "This adaptation remains under CC BY-SA 4.0; see sources/NATIVE_BENGALI_NOTICES.md and LICENSE-CC-BY-SA-4.0.txt.",
        "statistics": dict(stats),
        "reviewedExclusions": [
            "Systematic generic filler ending ‘সংক্রান্ত নির্দিষ্ট ভাব, অবস্থা বা প্রক্রিয়া’ is not a usable meaning.",
            "Empty definition labels such as ‘অর্থ:’ and relation-only spelling/form references are omitted.",
            "Fourteen reviewed finite verb forms carrying incorrect adverb POS and copied root definitions are omitted.",
            "Twenty-four reviewed conjugations of কাটা with only generated tense/person descriptions are omitted as form-only records.",
        ],
    }, "entries": entries}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "dist/data/native-bengali.json")
    parser.add_argument("--review-sample", type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="shobdokosh-native-bn-") as temporary:
        source = args.source or Path(temporary) / DUMP_NAME
        if not source.exists():
            request = urllib.request.Request(DUMP_URL, headers={"User-Agent": "Shobdokosh-native-dictionary/1.0 (offline source extraction)"})
            with urllib.request.urlopen(request, timeout=90) as response, source.open("wb") as output:
                while chunk := response.read(1024 * 1024):
                    output.write(chunk)
        dictionary = build(source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(dictionary, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    if args.review_sample:
        sample = random.Random(20261023).sample(dictionary["entries"], min(100, len(dictionary["entries"])))
        args.review_sample.write_text(json.dumps(sample, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "entries": len(dictionary["entries"]), **dictionary["meta"]["statistics"]}, indent=2))


if __name__ == "__main__":
    main()
