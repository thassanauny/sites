# English words with Bengali definitions

Source: Bengali Wiktionary contributors, the official Wikimedia
[2026-10-01 Bengali Wiktionary pages-articles dump](https://dumps.wikimedia.org/bnwiktionary/20261001/bnwiktionary-20261001-pages-articles.xml.bz2).
The retained source has SHA-1 `632e9b8b684f8386b4e37e645303febb21509337`.

Every record retains its original English page title, revision ID and a link to
the corresponding source revision. Page histories provide author attribution.
The adapted definitions remain under
[Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
The bundled `../LICENSE-CC-BY-SA-4.0.txt` contains the license text.

Shobdokosh extracts full, numbered Bengali definitions under recognized English
part-of-speech sections. It removes presentation markup, preserves usage labels,
groups repeated definitions for the same source page and part of speech, and
omits unsupported templates, relation-only entries, unrelated sections and
quotation lines. Safe display templates preserve their actual written prose or
scientific names; metadata and category templates do not become meaning text.
Some reviewed source errors, malformed text and generic bot placeholders are
omitted. English-only prose whose only Bengali text is a leading usage label
or the boilerplate “-এর প্রায়োগিক অর্থ:” is excluded; real Bengali definition
bodies and embedded scientific names remain intact.

The Bengali text is source-authored definition prose. It is not an automatically
generated translation or a list of Bengali reverse-search headwords. Examples,
linked nouns and other words embedded in definitions are never split into new
translation pairs. Community content may still contain errors, dated language
or incomplete meanings.

Reproduce with Python 3 standard-library tools:

```sh
uv run scripts/import_english_definitions.py --source /path/to/bnwiktionary-20261001-pages-articles.xml.bz2
```

The output embeds source/checksum details, record counts, distinct normalized
English headword counts and the number of retained source definitions.
