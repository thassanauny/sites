#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Retain whole Bengali definitions of English headwords from Bengali Wiktionary.

Definitions are source prose, never translation pairs: the output deliberately
has an empty bn array. Links, examples and words inside a definition do not
become reverse-search headwords. Only numbered definitions under recognized
English part-of-speech headings qualify. Relation-only definitions, quotation
lines, redirects and unknown template markup are omitted.
"""

import argparse
import hashlib
import html
import json
import re
import sys
import urllib.parse
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import import_reading_dictionary as source


ROOT = Path(__file__).resolve().parents[1]
POS = {**source.POS, "সংজ্ঞাবাচক বিশেষ্য": "proper noun", "বিশেষ্য নাম": "proper noun",
       "ক্রিয়া-বিশেষণ": "adverb", "ক্রিয়াপদ": "verb", "বাক্যাংশ": "phrase",
       "পদান্বয়ী বাক্যাংশ": "phrase", "আবেগসূচক অব্যয়": "interjection",
       "সমুচ্চয়ী অব্যয়": "conjunction", "পদান্বয়ী অব্যয়": "preposition",
       "উপসর্গ": "prefix", "প্রত্যয়": "suffix", "সংযোজক": "conjunction",
       "Noun": "noun", "Verb": "verb", "Adjective": "adjective",
       "Adverb": "adverb", "Phrase": "phrase", "Prepositional phrase": "phrase",
       "Interjection": "interjection", "Pronoun": "pronoun", "Determiner": "determiner",
       "Preposition": "preposition", "Conjunction": "conjunction"}
TEMPLATE = re.compile(r"\{\{([^{}]+)\}\}")
RELATION = re.compile(
    r"(?:এর|\bof\b)\s*(?:বহুবচন|একবচন|ভুল বানান|বিকল্প (?:বানান|রূপ)|"
    r"বর্তমান কৃদন্ত|অতীত (?:রূপ|কৃদন্ত)|তৃতীয় পুরুষ)|"
    r"^(?:\([^)]*\)\s*)?(?:(?:alternative|variant|obsolete|archaic|nonstandard) "
    r"(?:spelling|form)|plural|singular|inflection|conjugation|synonym|initialism|abbreviation) of\b", re.I)
REFERENCE_ONLY = re.compile(r"^(?:দেখুন|দ্রষ্টব্য|আরও দেখুন|See(?: also)?|সমার্থক(?: শব্দ)?\s*[:=])\b", re.I)
# Source errors reviewed during the bilingual supplement must not reappear as
# apparently authoritative prose. Omit the source line rather than rewrite it.
REVIEW_EXCLUSIONS = {
    "nothing": {"কি"}, "genre": {"উপায়"}, "earlobe": {"কর্ণ"},
    "murder": {"পাচার", "পাচার করা"}, "happiness": {"স্বাস্থ্য"},
    "awesome": {"সন্ত্রস্ত"}, "mandatory": {"আদেশ", "কার্যভার"},
    "fly": {"মশা", "মশক"}, "reduce": {"অনুবাদ করা"},
    "dwindle": {"ভেঙে ফেলা বা বিচ্ছিন্ন করে ফেলা"},
    "that way": {"কঠিন"},
}


def valid_title(title):
    return (bool(re.search(r"[A-Za-z]", title)) and len(title) <= 120
            and len(title.split()) <= 16 and not source.BN.search(title)
            and not re.search(r"[{}\[\]<>|=\n]", title)
            and all(not char.isalpha() or "LATIN" in source.unicodedata.name(char, "") for char in title))


def definition_lines(section):
    """A subdefinition is prose too; examples (#: and #*) are not definitions."""
    pos, active = None, False
    for line in section.splitlines():
        heading = source.HEADING.fullmatch(line.strip())
        if heading:
            title = source.clean(heading.group(2))
            title = re.sub(r"^\[\[(.*?)\]\]$", r"\1", title)
            if title in POS:
                pos, active = POS[title], True
            elif title in {"অর্থ", "সংজ্ঞা"} and pos:
                active = True
            else:
                active = False
            continue
        match = re.match(r"^#+(?![#*:])\s*(.+)$", line)
        if active and match:
            yield pos, match.group(1)


def template_text(body):
    values = [value.strip() for value in body.split("|")]
    name, args = values[0].casefold().replace("_", " "), values[1:]
    positional = [value for value in args if "=" not in value]
    if name in {"lb", "label", "lbl", "tlb", "লেবেল"} and positional and positional[0] == "en":
        labels = [value.replace("_", " ") for value in positional[1:] if value and value != "_"]
        return "(" + "; ".join(labels) + ") " if labels else ""
    if name in {"q", "qual", "qualifier", "gl", "gloss", "sense"} and positional:
        return "(" + "; ".join(positional) + ")"
    if name in {"l", "m", "link", "mention"} and len(positional) >= 2 and positional[0] in {"bn", "en", "mul"}:
        return positional[2] if len(positional) >= 3 and positional[2] else positional[1]
    if name in {"w", "wikipedia"} and positional:
        return positional[1] if len(positional) >= 2 else positional[0]
    if name in {"defdate", "senseid", "sense id", "sid", "c", "topics", "topic"}:
        return ""
    if name in {"non-gloss", "n-g", "ng", "non-gloss definition"} and positional:
        # This template displays the author's definition prose, including
        # complete idiomatic usage descriptions. It is not a cross-reference.
        return " ".join(positional[1:] if positional[0] == "en" else positional)
    if name in {"u", "vern"} and len(positional) == 1:
        return positional[0]
    if name in {"sub", "sup"} and len(positional) == 1:
        return positional[0]
    if name in {"taxfmt", "taxlink"} and len(positional) >= 2:
        # Only the written taxon name is display text. Rank/category arguments
        # describe presentation and cannot donate another dictionary meaning.
        return positional[0]
    # Unsupported templates are not interpreted as Bengali prose. Reject
    # instead of exposing raw parameters to readers.
    raise ValueError("unsupported template")


def has_bengali_definition_body(value):
    """A Bangla label or bot wrapper cannot turn English prose into Bangla."""
    body = re.sub(r"^[^:\u0980-\u09ff]+-এর\s+প্রায়োগিক\s+অর্থ\s*:\s*", "", value)
    while qualifier := re.match(r"^\([^()]*\)\s*", body):
        remainder = body[qualifier.end():]
        # Parentheses can contain the entire definition; only remove leading
        # qualifiers when actual definition text follows them.
        if not any(char.isalpha() for char in remainder):
            break
        body = remainder
    return bool(re.search(r"[অ-হড়ঢ়য়ৎ]", body))


def clean_definition(raw):
    if not source.BN.search(raw):
        return None
    raw = re.sub(r"<!--.*?-->|<ref\b[^>]*>.*?</ref>|<ref\b[^>]*/>", "", raw, flags=re.S | re.I)
    try:
        for _ in range(12):
            updated, replacements = TEMPLATE.subn(lambda match: template_text(match.group(1)), raw)
            raw = updated
            if not replacements:
                break
    except ValueError:
        return None
    if "{{" in raw or "}}" in raw:
        return None
    raw = re.sub(r"</?(?:sup|sub|small|big|i|b|em|strong)\b[^>]*>", "", raw, flags=re.I)
    raw = re.sub(r"<br\s*/?>", "; ", raw, flags=re.I)
    raw = re.sub(r"'{2,}", "", raw)
    raw = re.sub(r"\[https?://[^\s\]]+\s+([^\]]+)\]", r"\1", raw)
    raw = html.unescape(source.plain(raw))
    raw = source.clean(raw)
    if (not source.BN.search(raw) or len(raw) < 2 or len(raw) > 5000
            or re.search(r"[{}\[\]<>|=]", raw) or "http://" in raw or "https://" in raw
            or RELATION.search(raw) or REFERENCE_ONLY.search(raw)
            or not has_bengali_definition_body(raw)
            or any(char.isalpha() and not ("\u0980" <= char <= "\u09ff")
                   and "LATIN" not in source.unicodedata.name(char, "") for char in raw)
            or re.search(r"[ািীুূৃেৈোৌ]্|[ািীুূৃেৈোৌ]{2}|(?<![ডঢয])়", raw)
            or re.search(r"(?:^|[\s,;])(?:ত্ত|হত্তয়া|পাত্তয়া|দেত্তয়া)", raw)):
        return None
    if "বিষয়ক নির্দিষ্ট ধারণা, অবস্থা বা প্রক্রিয়া" in raw:
        # Bot-generated placeholder text does not explain the source word.
        return None
    return raw


def page_definitions(title, text):
    title = source.clean(title)
    if not valid_title(title) or re.match(r"^\s*#(?:redirect|পুনর্নির্দেশ)", text, re.I):
        return
    for language, section in source.sections(text):
        if language != "en":
            continue
        for pos, raw in definition_lines(section):
            definition = clean_definition(raw)
            if not definition:
                continue
            normalized = source.key(definition).strip(" .;।")
            if any(re.search(r"(?:^|[\s,;])" + re.escape(word) + r"(?:$|[\s,;।])", normalized)
                   for word in REVIEW_EXCLUSIONS.get(source.key(title), set())):
                continue
            yield pos, definition


def build(dump):
    if source.checksum(dump, "sha1") != source.DUMP_SHA1:
        raise ValueError("Official dump checksum mismatch")
    collected = defaultdict(list)
    revisions, spellings, counts = {}, {}, Counter()
    for title, text, revision in source.pages(dump):
        counts["mainNamespacePages"] += 1
        selected = list(page_definitions(title, text))
        if selected:
            counts["sourcePagesWithDefinitions"] += 1
        for pos, definition in selected:
            # Capitalized and lowercase source pages can have distinct senses
            # and revisions. Retain their provenance separately; only the
            # reported headword metric is case-insensitive.
            key = (source.clean(title), pos)
            normalized = source.key(definition)
            if normalized not in {source.key(value) for value in collected[key]}:
                collected[key].append(definition)
            revisions[key], spellings[key] = revision, source.clean(title)
    entries = []
    for key in sorted(collected):
        definitions = collected[key]
        title, revision = spellings[key], revisions[key]
        query = urllib.parse.urlencode({"title": title, "oldid": revision})
        identifier = hashlib.sha256("\0".join(key).encode()).hexdigest()[:20]
        entries.append({
            "id": "en-def-" + identifier, "en": title, "bn": [], "headword": title,
            "language": "en", "sourceKind": "definition", "pos": key[1],
            "definitionsBn": definitions,
            "sourceName": "Bengali Wiktionary contributors",
            "sourceUrl": "https://bn.wiktionary.org/w/index.php?" + query,
            "sourcePage": title, "sourceRevision": revision, "sourceLicense": "CC-BY-SA-4.0",
        })
    counts["entryCount"] = len(entries)
    counts["englishHeadwords"] = len({source.key(entry["en"]) for entry in entries})
    counts["definitionCount"] = sum(len(entry["definitionsBn"]) for entry in entries)
    return {"meta": {
        "source": "Bengali Wiktionary contributors; full Bengali definitions of English headwords",
        "url": "https://bn.wiktionary.org/", "license": "CC BY-SA 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
        "entryCount": len(entries), "englishHeadwords": counts["englishHeadwords"],
        "sourceDumpDate": "2026-10-01", "sourceUrl": source.DUMP_URL,
        "sourceSha1": source.DUMP_SHA1,
        "attribution": "Bengali Wiktionary contributors; each entry links to its source revision and page history. Shobdokosh strips presentation markup, retains whole definitions, filters unsupported markup and relation-only definitions, and groups repeated headword/part-of-speech definitions.",
        "description": "Source-authored Bengali definitions of English words and phrases. The Bengali text is definition prose, not a reverse-search headword or an automatically generated translation. Community definitions may contain errors, outdated wording or omissions.",
        "licenseNotice": "This adapted dataset remains CC BY-SA 4.0; see sources/ENGLISH_DEFINITIONS_NOTICES.md and LICENSE-CC-BY-SA-4.0.txt.",
        "statistics": dict(counts),
    }, "entries": entries}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="retained official XML.bz2 dump")
    parser.add_argument("--output", type=Path, default=ROOT / "dist/data/english-bangla-definitions.json")
    args = parser.parse_args()
    result = build(args.source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps(result["meta"]["statistics"], indent=2))


if __name__ == "__main__":
    main()
