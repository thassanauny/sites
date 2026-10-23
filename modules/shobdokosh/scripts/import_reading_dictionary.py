#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Build a conservative reading supplement from the official Bengali Wiktionary.

Imports English definition lines beneath Bengali POS headings, and genuine
short Bengali equivalents beneath English POS headings. It does not translate
Bengali prose or pull isolated links out of narrative definitions. Equivalents
from one actual source sense stay together. The checksum-pinned source dump
and all input dictionary fingerprints are retained in the output metadata.
"""

import argparse
import bz2
import hashlib
import json
import random
import re
import tempfile
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DUMP_NAME = "bnwiktionary-20261001-pages-articles.xml.bz2"
DUMP_URL = "https://dumps.wikimedia.org/bnwiktionary/20261001/" + DUMP_NAME
DUMP_SHA1 = "632e9b8b684f8386b4e37e645303febb21509337"
DEFAULT_EXISTING = [ROOT / "dist/data" / name for name in (
    "dictionary.json", "expanded-dictionary.json", "literary-dictionary.json",
    "bn-wiktionary-dictionary.json", "featured.json",
)]
LANG_HEADING = re.compile(r"^==(?!=)\s*(.*?)\s*(?<!\=)==\s*$", re.M)
HEADING = re.compile(r"^(={3,})\s*(.*?)\s*\1\s*$")
BN = re.compile(r"[\u0980-\u09ff]")
BN_TERM = re.compile(r"^[\u0980-\u09ff\u200c\u200d '\-]+$")
LINK = re.compile(r"\[\[([^\[\]]+)\]\]")
POS = {
    "বিশেষ্য": "noun", "নামবাচক বিশেষ্য": "proper noun", "বিশেষণ": "adjective",
    "ক্রিয়া": "verb", "ক্রিয়াবিশেষণ": "adverb", "ক্রিয়া বিশেষণ": "adverb",
    "সর্বনাম": "pronoun", "অব্যয়": "particle", "বাগধারা": "phrase",
    "প্রবাদ": "proverb", "নির্দেশক": "determiner", "সংখ্যা": "numeral",
}
LABEL = re.compile(r"\{\{(?:lb|label|লেবেল)\|(?:bn|en)\|([^{}]+)\}\}", re.I)
QUALIFIER = re.compile(r"\{\{(?:q|qualifier|qual)\|([^{}]+)\}\}", re.I)
EXAMPLE_OR_DESCRIPTION = re.compile(
    r"(?:যেমন|উদাহরণ|প্রভৃতি|ইত্যাদি|যথা|একজন|যিনি|যাহা|যাহার|বিক্রেতা|অন্তর্ভুক্ত|"
    r"নির্দিষ্ট ধারণা|অবস্থা বা প্রক্রিয়া|এর বহুবচন|এর একবচন|ভুল বানান|বিকল্প বানান)"
)
EN_RELATION = re.compile(
    r"^(?:\([^)]*\)\s*)?(?:(?:alternative|variant|obsolete|archaic|nonstandard) "
    r"(?:spelling|form)|plural|singular|inflection|conjugation|synonym|initialism|abbreviation) of\b", re.I,
)
VERB_ENDINGS = {"করা", "করান", "হওয়া", "দেওয়া", "থাকা", "ফেলা", "পাওয়া"}
# Explicit semantic review exclusions. These are omissions, never replacement
# translations. Keep the underlying source visible through the pinned dump.
REVIEWED_EXCLUSIONS = {
    ("that way", "কঠিন"): "The idiomatic source sense does not establish 'hard/difficult'.",
    ("happiness", "স্বাস্থ্য"): "The source list conflates happiness and health.",
    ("genre", "উপায়"): "A genre is a category/style; the source's bare 'means/method' is too broad.",
    ("awesome", "সন্ত্রস্ত"): "The source confuses causing awe with being frightened or awestruck.",
    ("mandatory", "আদেশ"): "The noun mandatory is a person holding a mandate, not the order itself.",
    ("mandatory", "কার্যভার"): "The noun mandatory is a mandate holder, not the assigned charge.",
    ("fly", "মশা"): "Mosquitoes cannot serve as an unqualified everyday equivalent of fly.",
    ("fly", "মশক"): "Mosquitoes cannot serve as an unqualified everyday equivalent of fly.",
    ("reduce", "অনুবাদ করা"): "The source offers an unsupported translation sense without its historical construction.",
    ("earlobe", "কর্ণ"): "The source confuses the ear with the earlobe.",
    ("murder", "পাচার"): "The source confuses killing and smuggling.",
    ("dwindle", "অবক্ষয়"): "The English verb cannot be represented by this bare Bengali noun.",
    ("dwindle", "ভেঙে ফেলা"): "The source offers an uncertain break-apart sense without a historical restriction.",
}


def clean(text):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", text or "")).strip()


def key(text):
    return re.sub(r"[\u200b-\u200d\ufeff]", "", clean(text)).casefold()


def strip_terminal(text):
    return clean(text).strip(" .;।")


def checksum(path, algorithm="sha256"):
    digest = hashlib.new(algorithm)
    with Path(path).open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def pages(source):
    with bz2.open(source, "rb") as handle:
        for _, element in ET.iterparse(handle, events=["end"]):
            if not element.tag.endswith("}page"):
                continue
            ns = element.tag[:-4]
            if element.findtext(ns + "ns") == "0":
                yield (element.findtext(ns + "title") or "",
                       element.findtext(".//" + ns + "text") or "",
                       element.findtext(ns + "revision/" + ns + "id"))
            element.clear()


def sections(text):
    text = re.sub(r"<!--.*?-->|<(?:nowiki|pre|code|ref)\b[^>]*>.*?</(?:nowiki|pre|code|ref)>", "", text, flags=re.S | re.I)
    headings = list(LANG_HEADING.finditer(text))
    for number, heading in enumerate(headings):
        title = clean(heading.group(1))
        language = None
        if re.fullmatch(r"\{\{\s*ভাষা\s*\|\s*bn\s*\}\}|বাংলা", title):
            language = "bn"
        elif re.fullmatch(r"\{\{\s*ভাষা\s*\|\s*en\s*\}\}|ইংরেজি|ইংরেজী", title):
            language = "en"
        if language:
            end = headings[number + 1].start() if number + 1 < len(headings) else len(text)
            yield language, text[heading.end():end]


def definition_lines(section):
    pos, in_meanings = None, False
    for line in section.splitlines():
        if heading := HEADING.fullmatch(line.strip()):
            title = clean(heading.group(2))
            title = re.sub(r"^\[\[(.*?)\]\]$", r"\1", title)
            if title in POS:
                pos, in_meanings = POS[title], True
            elif title in {"অর্থ", "সংজ্ঞা"} and pos:
                in_meanings = True
            else:
                in_meanings = False
            continue
        if in_meanings and re.match(r"^#(?![#:*])", line):
            yield pos, line[1:].strip()


def markup_body(raw, target_language):
    """Return structural text and labels; unknown templates make a line unsafe."""
    labels = []

    def label(match):
        labels.extend(re.sub(r"[{}\[\]<>]", "", plain(value.strip().replace("_", " "))) for value in match.group(1).split("|")
                      if value.strip() and value.strip() != "_")
        return ""

    body = QUALIFIER.sub(label, LABEL.sub(label, raw))
    body = re.sub(r"\{\{(?:gl|gloss)\|([^{}]+)\}\}", r"(\1)", body)
    body = re.sub(r"\{\{l\|" + target_language + r"\|([^|{}]+)(?:\|[^{}]*)?\}\}", r"[[\1]]", body)
    body = re.sub(r"'{2,}", "", body)
    if re.search(r"[{}<>]", body):
        return None, []
    return body.strip(), labels


def plain(text):
    def link(match):
        pieces = match.group(1).split("|")
        value = pieces[-1] if len(pieces) > 1 else pieces[0]
        return value.replace("_", " ") if ":" not in value else ""
    return clean(LINK.sub(link, text).replace("[", "(").replace("]", ")"))


def split_equivalents(body):
    result, start, depth, brackets = [], 0, 0, 0
    for number, char in enumerate(body):
        if body[number:number + 2] == "[[":
            brackets += 1
        if body[number:number + 2] == "]]":
            brackets = max(0, brackets - 1)
        if not brackets:
            if char == "(":
                depth += 1
            elif char == ")":
                depth = max(0, depth - 1)
            elif not depth and char in ",;":
                result.append(body[start:number])
                start = number + 1
    result.append(body[start:])
    return [strip_terminal(piece) for piece in result if strip_terminal(piece)]


def valid_bn(term):
    return (bool(BN.search(term) and BN_TERM.fullmatch(term)) and len(term) <= 55
            and len(term.split()) <= 4 and not re.search(r"[ািীুূৃেৈোৌ]্|[ািীুূৃেৈোৌ]{2}|(?<![ডঢয])়", term)
            and not re.search(r"(?:^| )(?:ত্ত|হত্তয়া|পাত্তয়া|দেত্তয়া)", term))


def pos_compatible(term, pos, attested_pos):
    """Use only an explicit contradictory Bengali POS, never an inferred one."""
    if pos not in {"verb", "adjective"} or " " in term:
        return True
    known = attested_pos.get(key(term), set())
    return not known or pos in known


def bn_equivalents(raw, attested):
    body, labels = markup_body(raw, "bn")
    if not body or EXAMPLE_OR_DESCRIPTION.search(body):
        return [], "", labels
    context = plain(body)
    if len(context) > 800:
        return [], "", labels
    pieces = split_equivalents(body)
    if len(pieces) > 8:
        # Long thesaurus-like lists collapse several senses and often omit
        # crucial restrictions. Prefer a smaller, interpretable definition.
        return [], "", labels
    linked = re.compile(r"^\[\[[^\[\]]+\]\](?: (?:" + "|".join(VERB_ENDINGS) + r"))?$")
    linked_or = re.compile(r"^\[\[[^\[\]]+\]\](?:\s+(?:বা|অথবা)\s+\[\[[^\[\]]+\]\])+$")
    structural = []
    for piece in pieces:
        # Parenthetical qualifiers remain in definitionBn, not in the lemma.
        bare = strip_terminal(re.sub(r"\([^()]*\)", "", piece))
        structural.append((bare, bool(linked.fullmatch(bare) or linked_or.fullmatch(bare))))
    if len(pieces) > 1:
        # Every part must look like a self-contained equivalent. A narrative
        # clause followed by examples cannot donate its isolated linked nouns.
        if any(not marked and ("[[" in part or len(plain(part).split()) > 2)
               for part, marked in structural):
            return [], "", labels
        if not any(marked for _, marked in structural):
            return [], "", labels
    result = []
    for part, marked in structural:
        if not marked and len(pieces) > 1:
            continue
        alternatives = re.split(r"\s+(?:বা|অথবা)\s+", part) if linked_or.fullmatch(part) else [part]
        for alternative in alternatives:
            term = strip_terminal(plain(alternative))
            if re.search(r"(?:^| )(?:যে|যা|যিনি|কোনো|বা|অথবা|এবং|একটি)(?: |$)", term) or not valid_bn(term):
                continue
            # A linked root plus an ordinary verb ending is a real source
            # phrase. Otherwise require an independently attested headword.
            tokens = term.rsplit(" ", 1)
            known = key(term) in attested or (len(tokens) == 2 and tokens[1] in VERB_ENDINGS and key(tokens[0]) in attested)
            if known and term not in result:
                result.append(term)
    prefix = "(" + "; ".join(labels) + ") " if labels else ""
    return result, prefix + context, labels


def english_gloss(raw):
    body, labels = markup_body(raw, "en")
    if not body:
        return None
    gloss = strip_terminal(re.sub(r"^[#*:;\s]+", "", plain(body)))
    if (not re.search(r"[A-Za-z]", gloss) or BN.search(gloss) or EN_RELATION.search(gloss)
            or len(gloss) > 180 or len(gloss.split()) > 25 or re.search(r"[{}\[\]<>|=]", gloss)
            or any(char.isalpha() and "LATIN" not in unicodedata.name(char, "") for char in gloss)):
        return None
    english_labels = [label for label in labels if not BN.search(label)]
    definition = ("(" + "; ".join(english_labels) + ") " if english_labels else "") + gloss
    return gloss, definition, labels


def build(source, existing_paths=DEFAULT_EXISTING):
    if checksum(source, "sha1") != DUMP_SHA1:
        raise ValueError("Source does not match the pinned official dump checksum")
    existing, attested, source_inputs = set(), set(), []
    attested_pos = defaultdict(set)
    for path in existing_paths:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
        entries = value if isinstance(value, list) else value["entries"]
        existing.update((key(entry["en"]), key(word)) for entry in entries for word in entry["bn"])
        attested.update(key(word) for entry in entries for word in entry["bn"])
        source_inputs.append({"name": Path(path).name, "sha256": checksum(path)})
    counts = Counter()
    for title, text, _ in pages(source):
        if BN.search(title) and BN_TERM.fullmatch(clean(title)):
            for language, section in sections(text):
                if language != "bn":
                    continue
                attested.add(key(title))
                for line in section.splitlines():
                    if heading := HEADING.fullmatch(line.strip()):
                        label = re.sub(r"^\[\[(.*?)\]\]$", r"\1", clean(heading.group(2)))
                        if label in POS:
                            attested_pos[key(title)].add(POS[label])
    result, seen = [], set()

    def add(en, terms, pos, gloss, direction, title, revision, labels):
        selected = []
        for term in terms:
            pair = (key(en), key(term))
            if pair in REVIEWED_EXCLUSIONS:
                counts["excludedReviewedSuspectPairs"] += 1
            elif direction == "en-bn" and not pos_compatible(term, pos, attested_pos):
                counts["excludedPosIncompatiblePairs"] += 1
            elif pair in existing or (*pair, pos) in seen:
                counts["excludedExistingOrRepeatedPairs"] += 1
            else:
                selected.append(term)
        if not selected:
            return
        omitted = {key(bn) for english, bn in REVIEWED_EXCLUSIONS if english == key(en)}
        if direction == "en-bn" and omitted:
            # The visible Bengali context must not reintroduce a source
            # equivalent that the semantic review explicitly rejected.
            gloss = "; ".join(piece for piece in split_equivalents(gloss)
                              if key(strip_terminal(piece)) not in omitted)
        fingerprint = "\0".join([direction, key(en), pos, gloss, *sorted(map(key, selected))])
        query = urllib.parse.urlencode({"title": title, "oldid": revision})
        entry = {"id": "reading-" + hashlib.sha256(fingerprint.encode()).hexdigest()[:20],
                 "en": en, "bn": selected, "pos": pos,
                 "sourceKind": "gloss" if direction == "bn-en" else "direct",
                 "sourceName": "Bengali Wiktionary contributors",
                 "sourceUrl": "https://bn.wiktionary.org/w/index.php?" + query,
                 "sourceLicense": "CC-BY-SA-4.0", "sourcePage": title,
                 "sourceRevision": revision, "sourceDirection": direction}
        if direction == "bn-en":
            entry["definition"] = gloss
        else:
            entry["definitionBn"] = gloss
        if labels:
            entry["sourceLabels"] = labels
        result.append(entry)
        seen.update((key(en), key(term), pos) for term in selected)
        counts["bengaliToEnglishSenses" if direction == "bn-en" else "englishToBengaliSenses"] += 1
        counts["bilingualPairs"] += len(selected)

    for title, text, revision in pages(source):
        for language, section in sections(text):
            if language == "bn":
                headword = clean(title)
                if not BN.search(headword) or not BN_TERM.fullmatch(headword):
                    continue
                for pos, raw in definition_lines(section):
                    counts["bengaliDefinitionLinesExamined"] += 1
                    if gloss := english_gloss(raw):
                        en, definition, labels = gloss
                        add(en, [headword], pos, definition, "bn-en", title, revision, labels)
            elif re.fullmatch(r"[A-Za-z][A-Za-z '’.,\-]*", title) and len(title) <= 100:
                for pos, raw in definition_lines(section):
                    counts["englishDefinitionLinesExamined"] += 1
                    if pos == "proper noun":
                        counts["excludedProperNameDefinitions"] += 1
                        continue
                    terms, gloss, labels = bn_equivalents(raw, attested)
                    if terms:
                        add(clean(title), terms, pos, gloss, "en-bn", title, revision, labels)
    result.sort(key=lambda entry: (key(entry["en"]), entry["pos"], entry["bn"], entry["id"]))
    known_heads = {word for _, word in existing}
    heads = {key(word) for entry in result for word in entry["bn"]}
    counts["englishHeadwords"] = len({key(entry["en"]) for entry in result})
    counts["bengaliHeadwords"] = len(heads)
    counts["additionalBengaliHeadwords"] = len(heads - known_heads)
    return {"meta": {
        "source": "Bengali Wiktionary contributors; explicit dictionary definitions",
        "url": "https://bn.wiktionary.org/", "license": "CC BY-SA 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/", "entryCount": len(result),
        "sourceUrl": DUMP_URL, "sourceDumpDate": "2026-10-01", "sourceSha1": DUMP_SHA1,
        "existingDictionaryInputs": source_inputs,
        "description": "Conservative supplementary reading senses: explicit English definitions of Bengali words and independently attested short Bengali equivalents of English words. Equivalents from one source definition stay grouped. Context is retained in definition or definitionBn. Bengali prose is never machine translated. Community data can contain errors and uncommon senses; broad literary coverage is not a claim of completeness.",
        "attribution": "Bengali Wiktionary contributors. Every sense links to its source revision and contributing authors through page history. Shobdokosh filters, normalizes, groups and deduplicates source definitions.",
        "licenseNotice": "This adaptation remains under CC BY-SA 4.0; see sources/READING_DICTIONARY_NOTICES.md and LICENSE-CC-BY-SA-4.0.txt.",
        "statistics": dict(counts),
        "reviewedExclusions": [{"en": en, "bn": bn, "reason": reason} for (en, bn), reason in REVIEWED_EXCLUSIONS.items()],
    }, "entries": result}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--existing", type=Path, nargs="+", default=DEFAULT_EXISTING)
    parser.add_argument("--output", type=Path, default=ROOT / "dist/data/reading-dictionary.json")
    parser.add_argument("--review-sample", type=Path, help="write a reproducible 100-pair semantic review sample")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="shobdokosh-reading-") as temporary:
        source = args.source or Path(temporary) / DUMP_NAME
        if not source.exists():
            request = urllib.request.Request(DUMP_URL, headers={"User-Agent": "Shobdokosh-reading-dictionary/1.0 (offline source extraction)"})
            with urllib.request.urlopen(request, timeout=90) as response, source.open("wb") as output:
                while chunk := response.read(1024 * 1024):
                    output.write(chunk)
        dictionary = build(source, args.existing)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(dictionary, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    if args.review_sample:
        pairs = [{**entry, "reviewedBengaliEquivalent": word} for entry in dictionary["entries"] for word in entry["bn"]]
        sample = random.Random(20261023).sample(pairs, min(100, len(pairs)))
        args.review_sample.write_text(json.dumps(sample, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "entries": len(dictionary["entries"]), **dictionary["meta"]["statistics"]}, indent=2))


if __name__ == "__main__":
    main()
