# Supplementary dictionary: sources and licenses

`../expanded-dictionary.json` is an aggregate of independently licensed
datasets. Every entry has `sourceName`, `sourceUrl`, and `sourceLicense` fields;
the aggregate does not relicense one source under the other source's terms.
This notice supplements the application's `THIRD_PARTY_NOTICES.md`.

## Ankur / Ridmik community dictionary

- Original project: <https://github.com/rafi-kamal/Bangla-Dictionary>.
- Author: Rafi Kamal (December 2012); underlying dictionary credited by the
  original README to the Ankur English-to-Bengali dictionary project.
- Snapshot: `fcff400f2c18d4ef28cf0b9972a0b6b50eb3dde7`.
- Original source database: `ankur-ridmik/dictionary.sqlite` (upstream
  `assets/dictionary`), kept unmodified alongside the original
  `ankur-ridmik/README.md` and `ankur-ridmik/COPYING.txt`.
- License: GNU General Public License, version 2. The full original notice and
  terms are in `ankur-ridmik/COPYING.txt`; see also
  <https://www.gnu.org/licenses/old-licenses/gpl-2.0.html>.

Shobdokosh's adaptation normalizes Unicode and whitespace, splits the small
number of comma/semicolon-separated Bangla equivalents, removes empty or
malformed records and pairs already present in the base dictionary, assigns
stable IDs, and serializes the original English/Bangla mappings for offline
lookup. No examples, pronunciation or part of speech are invented. This
adaptation remains under GPL version 2. The original database is included as
corresponding source. The standard-library build script is
`scripts/import_expanded_dictionary.py` in the application source tree; its
complete source is also included here as `import_expanded_dictionary.py`.

The original community database contains spelling mistakes and unusual senses;
it is not a professionally edited dictionary. Its labels and omissions are
preserved except for the normalization described above.

## Bengali Wiktionary via Kaikki / Wiktextract

- Attribution: Wiktionary contributors, extracted by Tatu Ylonen and the
  Wiktextract project and published by Kaikki.org.
- Dictionary: <https://kaikki.org/dictionary/Bengali/>.
- Original data:
  <https://kaikki.org/dictionary/Bengali/kaikki.org-dictionary-Bengali.jsonl>.
- License: Creative Commons Attribution-ShareAlike 4.0 International:
  <https://creativecommons.org/licenses/by-sa/4.0/>. The application's bundled
  full license text is `../LICENSE-CC-BY-SA-4.0.txt`.
- Each entry links to its original Wiktionary page, whose revision history
  identifies the contributing authors.

Shobdokosh's adaptation retains full English definitions omitted by the base
dictionary's short-gloss filter, including descriptions of literary words,
proper nouns, proverbs, affixes and letters. Unicode and whitespace are
normalized. Explicit spelling variants are resolved through their own source
lemma links. Grammatical forms are not assigned their lemma's meaning:
for example, a genitive of “you” cannot safely be translated as “you”.
Unresolved references and records without English meanings are excluded.
New IDs, source metadata and source links are added. These adapted Wiktionary
records remain under CC BY-SA 4.0.

## Reproduction and scope

The aggregate's `meta.sources` includes source revisions and SHA-256 checksums.
Run from the application directory:

```sh
uv run scripts/import_expanded_dictionary.py \
  --bengali-source /path/to/retained-bengali.jsonl
```

Without a local Bengali export, the script downloads the latest Kaikki export;
upstream changes may change the result. The Ridmik download remains pinned.
The base dictionary must also match the build being reproduced because pairs
already present there are omitted from this supplementary file.

Searchable English strings include descriptive glosses, and Bengali headword
counts include phrases. Raw word-list entries without translations are never
counted as dictionary meanings. No claim of complete coverage of Rabindranath
Tagore's literature is made by this dataset.

MinhasKamal's much larger 93k mapping files were evaluated but not imported:
sample records contained obvious incorrect translations and their detailed
lexicographical provenance was not documented. Unlicensed scraped dictionary
collections and machine-generated guesses are not included.
