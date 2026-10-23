#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
# SPDX-License-Identifier: GPL-2.0-only
"""Build the supplementary, offline English/Bangla dictionary.

Uses the Ankur community dictionary carried by the original Ridmik Dictionary
(GPL-2.0) and full Bengali Wiktionary glosses via Kaikki (CC BY-SA 4.0).
Unlike the base importer, descriptive English glosses are retained verbatim;
they are definitions, not invented short translations. These independent
sources retain their own licenses and attribution on every entry.

Python 3 standard library only. The Ridmik snapshot is pinned; Kaikki changes
over time, so retain a local source export to reproduce a particular build.
"""

import argparse
import hashlib
import json
import re
import sqlite3
import tempfile
import unicodedata
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RIDMIK_REVISION = "fcff400f2c18d4ef28cf0b9972a0b6b50eb3dde7"
RIDMIK_REPOSITORY = "https://github.com/rafi-kamal/Bangla-Dictionary"
RIDMIK_RAW = f"https://raw.githubusercontent.com/rafi-kamal/Bangla-Dictionary/{RIDMIK_REVISION}/"
BENGALI_URL = "https://kaikki.org/dictionary/Bengali/kaikki.org-dictionary-Bengali.jsonl"
BENGALI = re.compile(r"[\u0980-\u09ff]")
HEADWORD = re.compile(r"^[\u0980-\u09ff\u200c\u200d '-]+$")
UNRESOLVED_RELATION = re.compile(r"^(?:alternative(?: spelling| form)?|variant(?: spelling| form)?|"
                                 r"obsolete spelling|archaic spelling|synonym|initialism|"
                                 r"abbreviation|plural|singular|genitive|objective form) of\b", re.I)
PARTS_OF_SPEECH = {
    "noun": "noun", "verb": "verb", "adj": "adjective", "adv": "adverb",
    "num": "numeral", "pron": "pronoun", "intj": "interjection",
    "conj": "conjunction", "prep": "preposition", "postp": "postposition",
    "det": "determiner", "phrase": "phrase", "particle": "particle",
    "name": "proper noun", "proverb": "proverb", "classifier": "classifier",
    "prefix": "prefix", "suffix": "suffix", "character": "letter",
}


def clean(value):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", value or "")).strip()


def download(url, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "Shobdokosh dictionary builder"})
    with urllib.request.urlopen(request, timeout=90) as response:
        with target.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)


def digest(path):
    checksum = hashlib.sha256()
    with Path(path).open("rb") as source:
        while chunk := source.read(1024 * 1024):
            checksum.update(chunk)
    return checksum.hexdigest()


def build(base_path, ridmik_path, bengali_path):
    base = json.loads(Path(base_path).read_text(encoding="utf-8"))["entries"]
    existing_pairs = {(clean(entry["en"]).casefold(), clean(word))
                      for entry in base for word in entry["bn"]}
    existing_glosses = {(clean(word), entry.get("pos", ""), clean(entry.get("definition", "")))
                        for entry in base for word in entry["bn"]}
    entries = {}
    counts = Counter()

    def add(en, bn, pos, definition, source, word=None, inherited_from=None):
        en, bn, definition = clean(en), clean(bn), clean(definition)
        if not en or not BENGALI.search(bn) or not HEADWORD.fullmatch(bn):
            counts["excludedInvalidHeadword"] += 1
            return
        # Source phrases remain phrases. Never create translations by joining
        # unrelated snippets, reading etymology, or following example links.
        if (en.casefold(), bn) in existing_pairs:
            counts["excludedExistingPairs"] += 1
            return
        key = (source, en.casefold(), bn, pos, definition)
        if key in entries:
            return
        identifier = hashlib.sha256("\0".join(key).encode()).hexdigest()[:20]
        entry = {"id": f"expanded-{identifier}", "en": en, "bn": [bn],
                 "sourceKind": "gloss" if source == "wiktionary" else "community"}
        if pos:
            entry["pos"] = pos
        if definition:
            entry["definition"] = definition
        if source == "wiktionary":
            entry.update({"sourceName": "Wiktionary contributors",
                          "sourceUrl": "https://en.wiktionary.org/wiki/" + urllib.parse.quote(word or bn),
                          "sourceLicense": "CC-BY-SA-4.0"})
        else:
            entry.update({"sourceName": "Ankur / Ridmik Dictionary",
                          "sourceUrl": f"{RIDMIK_REPOSITORY}/tree/{RIDMIK_REVISION}",
                          "sourceLicense": "GPL-2.0-only"})
        if inherited_from:
            entry["lemma"] = inherited_from
        entries[key] = entry
        counts[source + "Entries"] += 1

    with sqlite3.connect(f"file:{Path(ridmik_path).resolve()}?mode=ro", uri=True) as database:
        for en, bn in database.execute("SELECT en_word,bn_word FROM words ORDER BY en_word,bn_word"):
            counts["ridmikSourceRows"] += 1
            en, bn = clean(en), clean(bn)
            if not en or not bn or not re.search(r"[A-Za-z]", en) or len(en) > 100:
                counts["excludedEmptyOrInvalidRows"] += 1
                continue
            # The original database occasionally separates independent Bengali
            # equivalents with commas; preserve each as a searchable headword.
            for equivalent in re.split(r"[,;]", bn):
                add(en, equivalent, "", "", "ankur")

    records = []
    with Path(bengali_path).open(encoding="utf-8") as source:
        for line in source:
            record = json.loads(line)
            if record.get("lang_code") == "bn" and HEADWORD.fullmatch(clean(record.get("word"))):
                records.append(record)
    counts["wiktionarySourceRecords"] = len(records)
    by_lemma = defaultdict(list)
    for record in records:
        by_lemma[clean(record["word"])].append(record)

    def meanings(word, pos=None, visited=frozenset()):
        if word in visited or len(visited) > 5:
            return
        for record in by_lemma.get(word, []):
            if pos and record.get("pos") != pos:
                continue
            for sense in record.get("senses", []):
                glosses = sense.get("glosses", [])
                if not glosses or "no-gloss" in sense.get("tags", []):
                    continue
                if sense.get("form_of"):
                    # A genitive of "you" means "your", not "you". A lemma's
                    # gloss cannot safely stand in for a grammatical meaning.
                    continue
                relations = sense.get("alt_of", [])
                if relations:
                    for relation in relations:
                        yield from meanings(clean(relation.get("word")), record.get("pos"), visited | {word})
                elif not UNRESOLVED_RELATION.search(clean(glosses[-1])):
                    yield clean(glosses[-1]), clean(sense.get("raw_glosses", glosses)[-1])

    for record in records:
        word = clean(record["word"])
        source_pos = record.get("pos")
        pos = PARTS_OF_SPEECH.get(source_pos)
        if not pos:
            continue
        for sense in record.get("senses", []):
            glosses = sense.get("glosses", [])
            if not glosses or "no-gloss" in sense.get("tags", []):
                continue
            definition = clean(sense.get("raw_glosses", glosses)[-1])
            if (word, pos, definition) in existing_glosses:
                counts["excludedAlreadyCoveredGlosses"] += 1
                continue
            if sense.get("form_of"):
                counts["excludedGrammaticalForms"] += 1
                continue
            relations = sense.get("alt_of", [])
            if relations:
                resolved = False
                for relation in relations:
                    target = clean(relation.get("word"))
                    for gloss, _ in meanings(target, source_pos, frozenset({word})):
                        add(gloss, word, pos, definition, "wiktionary", word, target)
                        resolved = True
                if not resolved:
                    counts["excludedUnresolvedForms"] += 1
            else:
                gloss = clean(glosses[-1])
                if UNRESOLVED_RELATION.search(gloss):
                    counts["excludedUnresolvedForms"] += 1
                else:
                    add(gloss, word, pos, definition, "wiktionary", word)

    result = sorted(entries.values(), key=lambda entry: (entry["en"].casefold(), entry["bn"], entry["id"]))
    counts["englishHeadwords"] = len({entry["en"].casefold() for entry in result})
    counts["bengaliHeadwords"] = len({word for entry in result for word in entry["bn"]})
    counts["additionalBengaliHeadwords"] = len(
        {word for entry in result for word in entry["bn"]} - {word for entry in base for word in entry["bn"]})
    return {"meta": {
        "source": "Ankur / Ridmik community dictionary and Wiktionary contributors via Kaikki",
        "url": RIDMIK_REPOSITORY,
        "license": "GPL-2.0-only (Ankur/Ridmik entries); CC-BY-SA-4.0 (Wiktionary entries)",
        "licenseUrl": "./sources/EXPANDED_DICTIONARY_NOTICES.md",
        "entryCount": len(result),
        "description": "Additional community dictionary mappings and previously omitted full English glosses of Bengali words. Source spelling variants are resolved only through explicit Wiktionary lemma links; grammatical forms without their own meaning are omitted. English lookup strings include full descriptive glosses. Community data may contain errors or omissions. This is an independent source aggregate; licenses are recorded per entry. Coverage of all Tagore works is not claimed.",
        "statistics": dict(counts),
        "sources": [{"id": "ankur", "name": "Ankur / Ridmik Dictionary", "url": RIDMIK_REPOSITORY,
                     "revision": RIDMIK_REVISION, "license": "GPL-2.0-only",
                     "licenseUrl": "https://www.gnu.org/licenses/old-licenses/gpl-2.0.html",
                     "sourcePath": "./sources/ankur-ridmik/dictionary.sqlite",
                     "sha256": digest(ridmik_path)},
                    {"id": "wiktionary", "name": "Wiktionary contributors via Kaikki / Wiktextract",
                     "url": BENGALI_URL, "license": "CC-BY-SA-4.0",
                     "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
                     "sha256": digest(bengali_path)}],
    }, "entries": result}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, default=ROOT / "dist/data/dictionary.json")
    parser.add_argument("--ridmik-source", type=Path)
    parser.add_argument("--bengali-source", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "dist/data/expanded-dictionary.json")
    args = parser.parse_args()
    source_dir = ROOT / "dist/data/sources/ankur-ridmik"
    source_dir.mkdir(parents=True, exist_ok=True)
    ridmik_path = args.ridmik_source or source_dir / "dictionary.sqlite"
    if not ridmik_path.exists():
        download(RIDMIK_RAW + "assets/dictionary", ridmik_path)
    for name in ["COPYING.txt", "README.md"]:
        if not (source_dir / name).exists():
            download(RIDMIK_RAW + name, source_dir / name)
    with tempfile.TemporaryDirectory(prefix="shobdokosh-expansion-") as temporary:
        bengali_path = args.bengali_source or Path(temporary) / "bengali.jsonl"
        if not bengali_path.exists():
            download(BENGALI_URL, bengali_path)
        dictionary = build(args.base, ridmik_path, bengali_path)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(dictionary, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "entries": len(dictionary["entries"]),
                      **dictionary["meta"]["statistics"]}, indent=2))


if __name__ == "__main__":
    main()
