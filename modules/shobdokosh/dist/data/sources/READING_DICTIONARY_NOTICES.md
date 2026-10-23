# Supplementary reading dictionary

`../reading-dictionary.json` is adapted from Bengali Wiktionary contributors
under **Creative Commons Attribution-ShareAlike 4.0 International**:
<https://creativecommons.org/licenses/by-sa/4.0/>.
The full license is bundled at `../LICENSE-CC-BY-SA-4.0.txt`.

The source is Wikimedia's official 1 October 2026 Bengali Wiktionary dump:
<https://dumps.wikimedia.org/bnwiktionary/20261001/bnwiktionary-20261001-pages-articles.xml.bz2>.
Its verified SHA-1 is `632e9b8b684f8386b4e37e645303febb21509337`.
Every sense links to its source page revision; the page history identifies the
contributing authors. Preserve these links, attribution, license and this
modification notice when sharing the adapted dataset.

## Extraction and context

The supplement imports two forms of explicit dictionary content:

- English definition lines under part-of-speech headings in Bengali language
  sections. Their English explanations remain in `definition`.
- Short Bengali equivalents under part-of-speech headings in English language
  sections. Equivalents belonging to one actual source sense stay together in
  one entry; the sanitized original context remains in `definitionBn`.

Bengali prose is not translated automatically. The importer does not infer
meanings from examples, citations, etymologies or isolated links in narrative
definitions. It excludes references to inflected/alternative forms without
actual definitions, other language sections, comments, literal code examples,
malformed markup and overly long descriptions. It also omits English proper
name definitions, whose member lists can be confused with translations.

For English-to-Bengali senses, the extractor accepts standalone linked
equivalents or a complete short meaning. Every Bengali headword must be
independently attested in a Bengali source entry or an established dictionary;
ordinary source verb phrases may use an attested root plus a verb ending.
For single-word English verb or adjective equivalents, an explicitly
contradictory Bengali part of speech causes the pair to be omitted. Multiple
attested senses and words whose Bengali POS is unknown are not guessed away;
ordinary root-plus-verb phrases stay available. For example, bare noun অবক্ষয়
is not imported as a verb meaning for dwindle, while হ্রাস পাওয়া is retained.
The uncommon adjective সুবহ is retained for portable because its Bengali
source entry explicitly means easily carried; its separate morning noun sense
does not invalidate that adjective.
It does not split narrative clauses into noun fragments. Long thesaurus-like
lists with more than eight parts are omitted because they often collapse
several senses without the restrictions needed to interpret them correctly.

Unicode and whitespace are normalized. Source labels are preserved, and source
spelling/context is not silently rewritten into new meanings. Pairs already
present in the five established dictionaries are removed. The output metadata
records their input fingerprints so the exact result can be reproduced.

## Source quality review

The source is community content and can contain mistakes, rare senses and
older wording. Its official hosting does not guarantee the correctness of each
mapping. A reproducible 100-pair review (seed `20261023`) was used to check both
meaning and extraction. Earlier candidate reviews exposed systematic traps:
countries listed within Southeast Asia are not translations of that region;
reptiles listed as examples of jawed vertebrates are not equivalents of
“gnathostome”; hardware mentioned in an ironmonger's definition is not the
ironmonger. Structural filters exclude these cases.

Explicitly reviewed suspect mappings are omitted and recorded with reasons in
the importer's `REVIEWED_EXCLUSIONS` and the dataset metadata. These are
exclusions, not invented replacement translations. For example, the source's
bare mappings of happiness to health, genre to means/method, and awesome to
frightened are not carried forward.
Reviewed rejected equivalents are also removed from the displayed Bengali
context so they cannot reappear there as apparent dictionary meanings; source
revision links still expose the unmodified originals.

This selective review reduces errors; it is not a claim that every underlying
community sense has been independently edited or that the dictionary covers
every word in Bengali writing. The reading supplement is loaded after the
established dictionaries.

## Reproduction and tests

From the application directory:

```sh
uv run scripts/import_reading_dictionary.py \
  --source /path/to/bnwiktionary-20261001-pages-articles.xml.bz2 \
  --review-sample /tmp/reading-review-100.json
uv run --python '>=3.10' python -m unittest discover -s tests -p 'test_import_*.py'
node --test tests/reading-dictionary.test.mjs
```

Without `--source`, the importer downloads the pinned dump and verifies its
checksum. Retain that `.bz2` because Wikimedia eventually rotates old dumps.
Use `--existing` to supply retained copies of the same five dictionary inputs.
The optional review file contains a deterministic sample for semantic checking;
it is not required at runtime.
