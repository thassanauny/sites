# Native Bengali dictionary source and license

This dataset adapts explicit Bengali definitions from **Bengali Wiktionary
contributors**, using the official 1 October 2026 Wikimedia content dump:

- Source: <https://bn.wiktionary.org/>
- Pinned dump: <https://dumps.wikimedia.org/bnwiktionary/20261001/bnwiktionary-20261001-pages-articles.xml.bz2>
- Dump SHA-1: `632e9b8b684f8386b4e37e645303febb21509337`
- Wikimedia terms: <https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use>
- License: [Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/).
- Local license: [LICENSE-CC-BY-SA-4.0.txt](../LICENSE-CC-BY-SA-4.0.txt).

Every entry retains the original page title, revision identifier and permanent
revision URL. The source page's history provides attribution to its contributing
authors. This filtered, rendered, normalized and grouped adaptation remains under
CC BY-SA 4.0. The application code has its own separate license.

`native-bengali.json` is a **monolingual Bengali dictionary**, not an English
translation dataset. Its `en` field is empty. `definitionsBn` contains genuine
source meaning lines grouped by source headword and part of speech. No machine
translation, generated headwords or inferred English meanings are added.

The extractor accepts numbered definitions and older bullet definitions under
explicit Bengali part-of-speech or meaning headings. It also accepts explicit
idiom meanings under ভাবার্থ. It excludes quotations and example lists,
etymologies, other-language sections, redirects, relation-only forms, unexpanded
templates, malformed markup and English-only definitions. Normal synonyms used
as actual definitions are retained. Bengali source phrases and proverbs remain
phrases; metadata distinguishes single-word and multiword headwords and counts
unique normalized heads separately from grouped senses and definition lines.
It does not omit a native definition merely because another dictionary already
has an English equivalent for its headword.

A reproducible 100-entry semantic/structural review exposed three bounded source
defects that are excluded: generic filler ending “সংক্রান্ত নির্দিষ্ট ভাব,
অবস্থা বা প্রক্রিয়া”, empty labels such as “অর্থ:”, and fourteen reviewed finite
verb forms incorrectly labelled as adverbs while repeating a root verb's broad
senses. Relation-only colloquial/spelling-form references are also omitted; an
independent meaning accompanied by a form note remains a valid definition.
Twenty-four reviewed conjugations of কাটা that contain only template-like
tense/person descriptions are also omitted as form-only records, rather than
counted as additional lexical words. The reviewed placeholder “প্রচলিত sense”
is also excluded because it provides no meaning.

Community dictionary definitions can contain errors, unusual senses or dated
language. Source labels and qualifiers are preserved, and the revision link
allows verification. This collection does not establish complete coverage of
any author or of all Bengali literature.

Rebuild from the original source:

```sh
uv run scripts/import_native_bengali.py --source /path/to/bnwiktionary-20261001-pages-articles.xml.bz2
```

Omit `--source` to download that same checksum-pinned official dump. Optional
`--review-sample /path/to/sample.json` writes a reproducible 100-entry review
sample (seed `20261023`).
