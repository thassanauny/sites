# Dictionary data attribution

Built-in phonetic typing uses the separately licensed jsAvroPhonetic engine
under MPL-2.0; see `dist/vendor/NOTICE.md` and `dist/vendor/MPL-2.0.txt` for the
pinned source and modifications. The CC BY-SA terms below apply to the base Wiktionary dataset.
Supplementary sources retain the separate terms described below.

The bundled `dist/data/dictionary.json` is adapted from the English edition of
**Wiktionary**, written by Wiktionary contributors, using structured exports
published by **Kaikki.org** and produced by **Wiktextract** (Tatu Ylonen and
contributors).

The adapted dictionary dataset is distributed under the **Creative Commons
Attribution-ShareAlike 4.0 International license (CC BY-SA 4.0)**. The full license
is included in `dist/data/LICENSE-CC-BY-SA-4.0.txt` and is available at
<https://creativecommons.org/licenses/by-sa/4.0/>.

## Sources and provenance

- English headwords with explicit Bengali translations:
  <https://kaikki.org/dictionary/English/>
  (Wiktionary dump dated 2026-10-01, extracted 2026-10-21).
- Bengali headwords with English glosses:
  <https://kaikki.org/dictionary/Bengali/>
  (Wiktionary dump dated 2026-09-02, extracted 2026-10-03).
- Wiktionary copyright terms:
  <https://en.wiktionary.org/wiki/Wiktionary:Copyrights>.
- Wiktextract documentation and source:
  <https://github.com/tatuylonen/wiktextract>.

Exports were retrieved on **2026-10-23**. The dataset contains **18,334 senses**,
**11,023 distinct English search terms** and **7,964 distinct Bangla headwords**.
These are different measures; the sense count is not a count of distinct words.
Source export URLs and SHA-256 fingerprints are retained in the dataset metadata.

For an original entry and its contributor history, open
`https://en.wiktionary.org/wiki/` followed by the URL-encoded English or Bangla
headword, then select the page history. For example:
<https://en.wiktionary.org/wiki/পানি>.

## Changes made for Shobdokosh · শব্দকোষ

- Selected explicit English-to-Bengali translations and short English glosses
  of Bengali headwords for lookup in both directions.
- Split short synonym glosses into searchable English terms while preserving
  the original gloss and available usage qualifiers in `definition`.
- Excluded proper-name entries, affixes, grammatical form/spelling references,
  long descriptive glosses and unsupported or empty translations.
- Normalized Unicode and whitespace, grouped matching senses and Bangla
  alternatives, and assigned stable identifiers.
- Marked explicit bilingual translations as `sourceKind: "direct"` and English
  terms derived from Bengali glosses as `sourceKind: "gloss"`. Direct
  translations rank first, followed by unqualified senses and the source order
  of their Bangla headwords; source order is a heuristic, not a frequency score.
- Excluded quoted glosses and malformed English fragments from reverse lookup.
- Retained English IPA where available; the `pronunciation` field always refers
  to the English word. No audio or quotation examples are bundled.

This is community dictionary data and can contain errors, older vocabulary,
dialect words or incomplete coverage. The base importer does not generate definitions or translations. Kaikki's postprocessed exports may themselves contain
extraction errors. Original contributors do not endorse this app.

## Rebuilding the dataset

Run `uv run scripts/import_dictionary.py` to stream the source exports and
regenerate the bundled JSON. This downloads approximately 575 MB and requires
no third-party Python packages. To reproduce a particular source snapshot,
archive the original JSONL/JSONL.gz exports and pass their paths using
`--english-source` and `--bengali-source`; the upstream URLs change over time.

Preserve this attribution, the license, source links and the notice of changes
when redistributing the dataset or an adaptation. This notice describes the
dictionary data; application code has its own licensing terms.

## Additional curated word senses

The অর্ঘ and অর্ঘ্য entries in `dist/data/featured.json` have original, concise English
explanations of lexical senses verified against the Bangla Academy–based
Accessible Dictionary: offering or ritual article, price/cost, and worship.
The source also lists অর্ঘ্য for offerings used in worship and gifts
presented to an honoured person as a mark of respect (tribute/gift). These curated
entries are separate from the imported Wiktionary dataset above.

Source: <https://accessibledictionary.gov.bd/bengali-to-bengali/?alp=&page=63>
and <https://accessibledictionary.gov.bd/bengali-to-english/?q=%E0%A6%85%E0%A6%B0%E0%A7%8D%E0%A6%98>.


## Supplementary dictionaries

- `dist/data/expanded-dictionary.json`: 14,906 additional senses from the
  Ankur dictionary carried by Ridmik (GPL version 2) and full Wiktionary glosses
  via Kaikki (CC BY-SA 4.0). Each entry retains its own source and license.
  [Detailed attribution, modifications and reproduction](dist/data/sources/EXPANDED_DICTIONARY_NOTICES.md).
  The original database, upstream README and GPL text are bundled under
  `dist/data/sources/ankur-ridmik/`; the adaptation script is supplied alongside
  them in `dist/data/sources/import_expanded_dictionary.py`.
- `dist/data/bn-wiktionary-dictionary.json`: explicit English translations in
  Bengali-language entries from the Bengali edition of Wiktionary, under
  CC BY-SA 4.0. Each entry retains its source revision and page history link.
  [Source, extraction rules and reproduction](dist/data/sources/BN_WIKTIONARY_NOTICES.md).
- `dist/data/literary-dictionary.json`: 135 selected literary and reading senses
  with original concise English explanations, individually checked against
  the reference linked on each entry. Source dictionary prose is not bundled.
  [Editorial method and references](dist/data/sources/LITERARY_DICTIONARY_NOTICES.md).
- `dist/data/reading-dictionary.json`: 8,161 additional source senses: explicit English definitions
  of Bengali headwords and short Bengali equivalents of English headwords from
  the official Bengali Wiktionary snapshot, under CC BY-SA 4.0. Source sections,
  part of speech and definition context are preserved where reliable; obvious
  reference fragments and examples are excluded.
  [Extraction rules, attribution and reproduction](dist/data/sources/READING_DICTIONARY_NOTICES.md).
- `dist/data/featured.json`: 28 selected entries with original explanations.
  Additional জীর্ণ senses include worn-out, dilapidated, emaciated, digested,
  corroded and decrepit, verified against the
  [Accessible Dictionary](https://accessibledictionary.gov.bd/bengali-to-english/?q=জীর্ণ).
- `dist/data/native-bengali.json`: 76,714 source records, containing 71,874
  normalized Bengali source headwords and 96,673 source-provided Bengali definitions
  from the official Bengali Wiktionary snapshot (CC BY-SA 4.0). No English
  translation is invented for these records.
  [Extraction rules, attribution and reproduction](dist/data/sources/NATIVE_BENGALI_NOTICES.md).
- `dist/data/english-bangla-definitions.json`: 36,770 source records for 30,395
  normalized English headwords, with 44,623 whole Bengali definitions from
  the same snapshot (CC BY-SA 4.0). Definition examples and isolated nouns
  are not promoted into reverse Bengali translation headwords.
  [Extraction rules, attribution and reproduction](dist/data/sources/ENGLISH_DEFINITIONS_NOTICES.md).

The two source-definition files use `shobdokosh/dictionary-rows@1`, a compact
transport format. Repeated language, attribution and license fields are stored
once; source URLs are reconstructed from the retained source title and exact
revision. Definition text is unchanged by packing. `dist/dictionary-format.js`
decodes this format. The original object-format import output can be regenerated
with `scripts/import_native_bengali.py` and `scripts/import_english_definitions.py`;
then run `npm run vocabulary` to pack both files and rebuild the count summary.

The combined app reports **115,998 distinct defined lexical headwords**:
**96,932 single words** and **19,066 phrases** across both languages. It contains
156,880 source records. Counts normalize Unicode, case and whitespace, deduplicate
multiple senses, and exclude names-only and nonlexical-only records. Descriptive
English gloss strings are not counted as English source headwords. The exact
inputs and SHA-256 fingerprints are in `dist/data/vocabulary-summary.json`.

Raw word lists without meanings are not counted as dictionary senses. English
search strings include phrases and full glosses, so their total must not be
advertised as a count of distinct English words. Community entries can contain
errors and omissions.

## Tagore occurrence inventory

The developer-only audit reports dictionary lookup coverage for a frozen source
inventory: 3,438 RabindraNet research-corpus records and 59 published letters
from Bengali Wikisource. Records can contain introductions or grouped songs;
this is not a count of distinct works, and it does not verify a complete author
bibliography. Only derived frequencies, titles, hashes and references are
redistributed; literary texts are downloaded into an external build cache.

See [source provenance, scope and build commands](resources/tagore/README.md).
The report distinguishes exact headword presence, inferred related base forms,
and unresolved forms. Neither exact headword presence nor a base-form match
establishes every contextual literary meaning. No complete Tagore coverage is
claimed.
