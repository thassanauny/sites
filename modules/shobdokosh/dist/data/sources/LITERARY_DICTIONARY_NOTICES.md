# Literary and reading glossary

`../literary-dictionary.json` contains 135 selected literary and reading senses,
including poetry, fiction, older prose and frequent grammatical words. The
latest additions include অলক, উন্মেষ, কুহেলি, নিদাঘ, পান্থ, বিহঙ্গ and যবনিকা.
It is a targeted supplement for Bengali literature, including Rabindranath
Tagore, not a complete concordance of any author's writings or a complete
account of every word's senses.

## Wording and references

The short English explanations were written for Shobdokosh on 23 October 2026.
Their lexical facts were checked individually against the reference linked in
each entry's `sourceUrl`. Dictionary articles, examples, poems and quoted
literary passages from those references are not reproduced. Source dictionaries
retain their rights; these references do not imply that the source databases
are openly licensed or authorize bulk reuse.

Most factual checks use the Bangladesh government's Accessible Dictionary:
<https://accessibledictionary.gov.bd/>. A query may lead to a larger entry
containing the target as a subentry. The JSON records `sourceHeadword` where a
subentry or different source spelling is involved:

- চিরন্তন is checked under চির, and শ্যামল under শ্যাম.
- তেমনি is checked under তেমন, and অবশেষে under অবশেষ.
- বসুন্ধরা is checked under বসু.
- The source uses অবগুন্ঠন; the supplement also accepts অবগুণ্ঠন.
- Some source queries preserve precomposed য়; displayed headwords are normalized
  to NFC for consistent searching.
- পরশ and পরাণ are explicitly identified as poetic forms referring to স্পর্শ
  and প্রাণ; those target entries were also read before writing the glosses.
- কিছুই is explained from the কিছু entry with an explicit context note:
  its meaning becomes “nothing at all” when negation is present.
- The negative নি is checked against its colloquial cross-reference to নাই,
  rather than the unrelated prefix or musical-note senses.
- নাহি is an older negative form; it is not treated as a positive form of
  “to be”, despite a missing negative word in one source English gloss.
- কঙ্কণ explicitly refers to কাঁকন; the latter article was also checked.
- বিরহিণী is explicitly identified as the feminine form of বিরহী. মহীয়সী
  is the feminine form of মহীয়ান, and মৃন্ময়ী is the feminine of মৃন্ময়;
  their definitions preserve those grammatical relationships.
- কুহেলিকা/কুহেলি/কুহেলী, কুহু/কুহূ, রজনী/রজনি and the other added
  variants occur together in their reference articles.
- The শেফালি entry uses the verified general flower sense. The reference's
  scientific name is not repeated; no botanical identification is inferred
  from it.

হিয়া and তরু are checked against their Bengali Wiktionary entries:
<https://en.wiktionary.org/wiki/হিয়া#Bengali> and
<https://en.wiktionary.org/wiki/তরু#Bengali>.
নহে is checked against the definition and present-tense conjugation of নহা:
<https://en.wiktionary.org/wiki/নহা#Bengali>.
The corresponding entry has an original explanation describing the older
negative form rather than inheriting an unrelated positive verb meaning.

## Editorial scope

The entries focus on meanings useful for reading. For example, the sky sense
of অম্বর is selected; the headword's other meanings are not claimed absent.
মর্মর has separate entries for rustling and marble so those senses stay clear.
The later additions also keep the coral and young-growth senses of প্রবাল,
the detached and melancholy senses of উদাস, and the physical and emotional
senses of মলিন separate. The older meanings of অপরূপ and অরূপ are not claimed
absent by selecting their wonderful and formless senses here.
অনিমেষ, মঞ্জরী, তরণী, মুরলী and ধূলি include only spelling variants explicitly
identified by their references.

The meanings are explanations, not automatic translations of sentences.
Grammatical words such as একটা, কিছুই, নি and গো can require different English
wording in different contexts; their notes preserve that distinction.

`tests/literary-dictionary.test.mjs` checks native and English lookup, the
distinct homonymous meanings, important negative/function words and attribution.
The application-wide coverage audit measures this supplement together with
the other dictionaries; no claim of complete Tagore coverage follows from
the presence of these selected words.
