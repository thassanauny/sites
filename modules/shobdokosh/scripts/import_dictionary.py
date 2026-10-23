#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Build the offline lexicon using openly licensed Wiktionary/Kaikki exports.

Python 3 standard library only. With no arguments this streams about 575 MB
from Kaikki. For repeatable builds, keep the original exports and pass their
paths using --english-source and --bengali-source. JSONL and JSONL.gz work.
The upstream export URLs are refreshed periodically; stable IDs depend on the
entry's English lemma, part of speech and source sense, not export ordering.
"""

import argparse
import gzip
import hashlib
import io
import json
import re
import unicodedata
import urllib.request
from collections import defaultdict
from contextlib import contextmanager
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ENGLISH_URL = "https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz"
BENGALI_URL = "https://kaikki.org/dictionary/Bengali/kaikki.org-dictionary-Bengali.jsonl"
BENGALI_SCRIPT = re.compile(r"[\u0980-\u09ff]")
PARTS_OF_SPEECH = {
    "noun": "noun", "verb": "verb", "adj": "adjective", "adv": "adverb",
    "num": "numeral", "pron": "pronoun", "intj": "interjection",
    "conj": "conjunction", "prep": "preposition", "postp": "postposition",
    "det": "determiner", "phrase": "phrase", "particle": "particle",
}
RELATIONSHIP = re.compile(
    r"\b(?:spelling|form|inflection|conjugation|plural|singular|participle|"
    r"pronunciation|synonym|abbreviation|initialism|ellipsis|diminutive) of\b|"
    r"^(?:used to|a type of|a kind of|a variety of|one who|someone who|"
    r"a person who|the act of|the state of|relating to|pertaining to)",
    re.IGNORECASE,
)


def clean(value):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", value)).strip()


@contextmanager
def source_lines(location):
    if location.startswith("https://"):
        request = urllib.request.Request(location, headers={
            "User-Agent": "Shobdokosh offline dictionary importer (Wiktionary attribution retained)"
        })
        handle = urllib.request.urlopen(request, timeout=60)
    else:
        handle = open(location, "rb")
    with handle:
        buffered = io.BufferedReader(handle, 1024 * 1024)
        if location.endswith(".gz"):
            with gzip.GzipFile(fileobj=buffered) as compressed:
                yield compressed
        else:
            yield buffered


def ipa(record):
    sounds = [sound for sound in record.get("sounds", []) if sound.get("ipa")]
    preferred = sorted(sounds, key=lambda sound: (
        not sound["ipa"].startswith("/"),
        not any(tag in sound.get("tags", []) for tag in ["General-American", "Received-Pronunciation"]),
    ))
    return clean(preferred[0]["ipa"]) if preferred else None


def short_gloss_terms(gloss, pos):
    """Keep short direct glosses; never infer translations from definition links.

    Commas and semicolons separate synonym glosses. Parenthetical qualifiers
    remain in the definition, while the English search lemma uses the term.
    Complex descriptions and grammatical relationships are deliberately skipped.
    """
    if RELATIONSHIP.search(gloss) or len(gloss) > 180 or re.search(r'["“”]', gloss):
        return []
    # Split only outside parentheses so descriptions cannot become false lemmas.
    gloss = re.split(
        r"[,;]\s*(?:especially|particularly|typically|including|such as|"
        r"used to|used for|used in|which|who|that is|i\.e\.|e\.g\.)\b",
        gloss, maxsplit=1, flags=re.IGNORECASE,
    )[0]
    pieces = re.split(r"[,;](?![^()]*\))", gloss)
    terms = []
    for piece in pieces:
        term = clean(re.sub(r"\([^()]*\)", "", piece)).strip(" .:;!?")
        if pos == "verb" and term.lower().startswith("to "):
            term = term[3:]
        if term.lower().startswith(("a ", "an ", "the ")):
            if len(term.split()) > 3:
                continue
            term = term.split(" ", 1)[1]
        if (not term or len(term) > 56 or len(term.split()) > 4
                or RELATIONSHIP.search(term) or BENGALI_SCRIPT.search(term)
                or re.match(r"^(?:or |and |especially |particularly |usually |"
                            r"often |normally |generally |for |with |from |"
                            r"in |on |at |as |by |which |who )", term, re.IGNORECASE)
                or re.search(r"[{}\[\]<>:=/\n]", term)
                or not term[0].isalpha() or not term[-1].isalpha()
                or not all(char.isalpha() or char in " '-’" for char in term)
                or not re.search(r"[A-Za-z]", term)):
            continue
        terms.append(term)
    return terms


def build(english_source, bengali_source):
    entries = {}
    pronunciations = {}
    bengali_order = {}
    statistics = defaultdict(int)
    fingerprints = {}

    def add(en, bn, pos, definition, pronunciation=None, source_kind="gloss"):
        en, bn, definition = clean(en), clean(bn), clean(definition)
        if not en or not BENGALI_SCRIPT.search(bn):
            return
        key = (en.casefold(), pos, definition)
        if key not in entries:
            entry_id = hashlib.sha256("\0".join(key).encode()).hexdigest()[:16]
            entries[key] = {"id": entry_id, "en": en, "bn": [], "pos": pos,
                            "sourceKind": source_kind}
            if definition:
                entries[key]["definition"] = definition
        entry = entries[key]
        if source_kind == "direct":
            entry["sourceKind"] = "direct"
        if bn not in entry["bn"]:
            entry["bn"].append(bn)
        if pronunciation:
            entry.setdefault("pronunciation", pronunciation)

    digest = hashlib.sha256()
    with source_lines(english_source) as lines:
        for line in lines:
            # Avoid parsing 1.5 million irrelevant English records.
            if b'"code": "bn"' not in line and b'"lang": "Bengali"' not in line:
                continue
            record = json.loads(line)
            if record.get("lang_code") != "en":
                continue
            translations = [t for t in record.get("translations", []) if t.get("code") == "bn"]
            if not translations:
                continue
            digest.update(line)
            statistics["englishRecords"] += 1
            pos = PARTS_OF_SPEECH.get(record.get("pos"))
            if not pos:
                continue
            pronunciation = ipa(record)
            if pronunciation:
                pronunciations.setdefault(clean(record["word"]).casefold(), pronunciation)
            for translation in translations:
                if translation.get("word"):
                    add(record["word"], translation["word"], pos,
                        translation.get("sense", ""), pronunciation, "direct")
    fingerprints["englishSelectedRecordsSha256"] = digest.hexdigest()
    statistics["directTranslationEntries"] = len(entries)

    digest = hashlib.sha256()
    with source_lines(bengali_source) as lines:
        for source_index, line in enumerate(lines):
            digest.update(line)
            record = json.loads(line)
            bengali_order.setdefault(clean(record["word"]), source_index)
            pos = PARTS_OF_SPEECH.get(record.get("pos"))
            if record.get("lang_code") != "bn" or not pos or not BENGALI_SCRIPT.search(record["word"]):
                continue
            statistics["bengaliRecords"] += 1
            for sense in record.get("senses", []):
                if (not sense.get("glosses") or sense.get("form_of") or sense.get("alt_of")
                        or set(sense.get("tags", [])) & {"alt-of", "form-of", "no-gloss"}):
                    continue
                gloss = sense["glosses"][-1]
                definition = sense.get("raw_glosses", [gloss])[-1]
                for term in short_gloss_terms(gloss, record["pos"]):
                    add(term, record["word"], pos, definition,
                        pronunciations.get(clean(term).casefold()))
    fingerprints["bengaliExportSha256"] = digest.hexdigest()

    result = sorted(entries.values(), key=lambda entry: (
        entry["en"].casefold(), entry["pos"], entry.get("definition", ""), entry["id"]
    ))
    # Prefer explicit bilingual translations, then unqualified early source
    # headwords. The early Wiktionary Bangla headwords are usually common words;
    # source position is a ranking heuristic, not a linguistic frequency claim.
    result.sort(key=lambda entry: (
        entry["en"].casefold(),
        entry["sourceKind"] != "direct",
        entry.get("definition", "").startswith("("),
        min(bengali_order.get(word, 10**9) for word in entry["bn"]),
        entry["pos"], entry["id"],
    ))
    for entry in result:
        entry["bn"].sort(key=lambda word: (bengali_order.get(word, 10**9), word))
    statistics["englishHeadwords"] = len({e["en"].casefold() for e in result})
    statistics["bengaliHeadwords"] = len({word for e in result for word in e["bn"]})
    return {
        "meta": {
            "source": "Wiktionary contributors via Kaikki.org / Wiktextract",
            "url": "https://kaikki.org/dictionary/Bengali/",
            "license": "CC BY-SA 4.0",
            "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
            "entryCount": len(result),
            "description": "Explicit English-to-Bengali translations plus short English glosses of Bengali headwords; normalized and grouped for offline lookup in both directions. Community dictionary data may contain errors or omissions.",
            "attribution": "Wiktionary contributors; data extracted by Tatu Ylonen and the Wiktextract project and published by Kaikki.org. Shobdokosh filters, normalizes and regroups the data.",
            "sourceUrls": [ENGLISH_URL, BENGALI_URL],
            "sourceEntryUrlTemplate": "https://en.wiktionary.org/wiki/{word}",
            "licenseNotice": "This adapted dictionary dataset is distributed under CC BY-SA 4.0. See THIRD_PARTY_NOTICES.md and LICENSE-CC-BY-SA-4.0.txt.",
            "statistics": dict(statistics),
            "fingerprints": fingerprints,
        },
        "entries": result,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--english-source", default=ENGLISH_URL)
    parser.add_argument("--bengali-source", default=BENGALI_URL)
    parser.add_argument("--output", type=Path, default=ROOT / "dist/data/dictionary.json")
    args = parser.parse_args()
    dictionary = build(args.english_source, args.bengali_source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(dictionary, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "entries": len(dictionary["entries"]),
                      **dictionary["meta"]["statistics"]}, indent=2))


if __name__ == "__main__":
    main()
