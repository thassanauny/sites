# Bengali Wiktionary: explicit English translations

`../bn-wiktionary-dictionary.json` is adapted from Bengali Wiktionary
contributors and remains under **Creative Commons Attribution-ShareAlike 4.0
International** (CC BY-SA 4.0).

- Project: <https://bn.wiktionary.org/>.
- Official source snapshot: 1 October 2026,
  <https://dumps.wikimedia.org/bnwiktionary/20261001/bnwiktionary-20261001-pages-articles.xml.bz2>.
- Official dump status and checksums:
  <https://dumps.wikimedia.org/bnwiktionary/20261001/dumpstatus.json>.
- Source SHA-1: `632e9b8b684f8386b4e37e645303febb21509337`.
- License: <https://creativecommons.org/licenses/by-sa/4.0/>.
- The full license is bundled at `../LICENSE-CC-BY-SA-4.0.txt`.
- Wikimedia licensing and attribution rules:
  <https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use#7._Licensing_of_Content>.

Each adapted entry includes `sourcePage`, `sourceRevision` and a `sourceUrl`
link to the actual source revision. The page history identifies the authors
who contributed the source material. Preserve these links, this attribution,
the license and this notice of modifications when redistributing the dataset.

## Adaptation

Shobdokosh imports explicit English translation templates such as
`{{t|en|word}}`, only when they appear under a translation heading inside an
explicitly marked Bengali language section. The source page must have a Bengali
headword. Other language sections, Bengali-only definitions, etymological
mentions, quotations, interwiki links, comments and literal code examples
cannot create translations.

The adaptation normalizes Unicode and whitespace, validates Latin-script
English lookup strings, carries forward the nearest reliable part-of-speech
heading when available, assigns stable IDs and removes pairs already present
in the base, expanded, literary and everyday dictionaries. No English meanings
are invented for untranslated Bengali words. English phrases and qualifiers
already present in explicit translation templates are retained.

This is community dictionary data: a source-provided translation can be
imprecise or mistaken. The adaptation is a selective extraction, not an
endorsement of every underlying sense. A Bengali Wiktionary article count
does not equal a count of Bengali words with English translations, and this
supplement does not prove complete coverage of Tagore's literature.

## Reproduction

From the application directory:

```sh
uv run scripts/import_bengali_wiktionary.py \
  --source /path/to/bnwiktionary-20261001-pages-articles.xml.bz2
```

With no `--source`, the script downloads the pinned official dump. Retain the
original `.bz2` if future reproduction is needed: Wikimedia rotates old dump
snapshots out of its service. The importer verifies the official SHA-1 before
reading any entries. Reproduction also requires the same four existing
dictionary inputs, because deduplication depends on their contents; use
`--existing` to pass retained copies explicitly.

The standard-library parser tests are in
`tests/test_import_bengali_wiktionary.py`, and offline dataset/search checks are
in `tests/bn-wiktionary-dictionary.test.mjs`.
