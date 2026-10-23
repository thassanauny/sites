import importlib.util
from pathlib import Path
import unittest


SPEC = importlib.util.spec_from_file_location(
    "reading_importer", Path(__file__).resolve().parents[1] / "scripts/import_reading_dictionary.py"
)
IMPORTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(IMPORTER)


class ReadingExtractionTests(unittest.TestCase):
    def test_genuine_equivalents_are_grouped_and_qualifiers_retained(self):
        words, context, labels = IMPORTER.bn_equivalents(
            "{{lb|en|অপ্রচলিত}} [[তরী]], [[নৌকা]]।", {"তরী", "নৌকা"})
        self.assertEqual(words, ["তরী", "নৌকা"])
        self.assertEqual(context, "(অপ্রচলিত) তরী, নৌকা।")
        self.assertEqual(labels, ["অপ্রচলিত"])

    def test_examples_are_not_mistaken_for_translations(self):
        words, _, _ = IMPORTER.bn_equivalents(
            "এমন [[মেরুদণ্ডী প্রাণী]], যার চোয়াল আছে—যেমন [[সরীসৃপ]], [[স্তন্যপায়ী]]।",
            {"মেরুদণ্ডী প্রাণী", "সরীসৃপ", "স্তন্যপায়ী"})
        self.assertEqual(words, [])

    def test_isolated_narrative_links_cannot_become_noun_fragments(self):
        for raw in [
            "[[হার্ডওয়্যার]], [[সরঞ্জাম]] এবং [[সামগ্রী]]র একজন [[বিক্রেতা]]।",
            "গুণ বা শক্তির অভাবযুক্ত; [[দুর্বল]]; [[পাতলা]]।",
            "[[দক্ষিণ-পূর্ব এশিয়া]]; [[ব্রুনাই]], [[থাইল্যান্ড]] অবস্থিত এশিয়ার উপঅঞ্চল।",
        ]:
            words, _, _ = IMPORTER.bn_equivalents(raw, {
                "হার্ডওয়্যার", "সরঞ্জাম", "সামগ্রী", "বিক্রেতা", "গুণ", "শক্তি", "দুর্বল", "পাতলা",
                "দক্ষিণ-পূর্ব এশিয়া", "ব্রুনাই", "থাইল্যান্ড",
            })
            self.assertEqual(words, [], raw)

    def test_unattested_lemmas_and_corrupted_spellings_are_rejected(self):
        self.assertEqual(IMPORTER.bn_equivalents("[[অজানা শব্দ]]", set())[0], [])
        self.assertFalse(IMPORTER.valid_bn("বিৃঙ্খলা"))
        self.assertFalse(IMPORTER.valid_bn("হত্তয়া"))
        self.assertFalse(IMPORTER.valid_bn("ত্তজন করা"))

    def test_short_whole_meanings_and_productive_verb_phrases_stay_intact(self):
        self.assertEqual(IMPORTER.bn_equivalents("মৃদু বাতাস।", {"মৃদু বাতাস"})[0], ["মৃদু বাতাস"])
        self.assertEqual(IMPORTER.bn_equivalents("[[সজ্জিত]] করা।", {"সজ্জিত"})[0], ["সজ্জিত করা"])

    def test_long_thesaurus_lists_are_omitted(self):
        raw = ", ".join("[[শব্দ" + digit + "]]" for digit in "১২৩৪৫৬৭৮৯")
        self.assertEqual(IMPORTER.bn_equivalents(raw, {"শব্দ" + digit for digit in "১২৩৪৫৬৭৮৯"})[0], [])

    def test_explicit_english_glosses_survive_without_generated_translation(self):
        result = IMPORTER.english_gloss("{{lb|bn|poetic}} [[heart]], [[mind]]")
        self.assertEqual(result, ("heart, mind", "(poetic) heart, mind", ["poetic"]))
        self.assertIsNone(IMPORTER.english_gloss("এটি কেবল একটি বাংলা সংজ্ঞা"))
        self.assertIsNone(IMPORTER.english_gloss("alternative spelling of heart"))
        self.assertIsNone(IMPORTER.english_gloss("{{এর বহুবচন|bn|কথা}}"))

    def test_stray_leading_list_markers_are_removed_but_internal_hashes_survive(self):
        self.assertEqual(IMPORTER.english_gloss("#*: A district")[0], "A district")
        self.assertEqual(IMPORTER.english_gloss("programming in C#")[0], "programming in C#")

    def test_attested_pos_guard_rejects_bare_nouns_for_verbs_but_preserves_real_phrases(self):
        known = {"অবক্ষয়": {"noun"}, "সুবহ": {"noun", "adjective"}, "গুজরান": {"noun"}}
        self.assertFalse(IMPORTER.pos_compatible("অবক্ষয়", "verb", known))
        self.assertFalse(IMPORTER.pos_compatible("গুজরান", "verb", known))
        self.assertTrue(IMPORTER.pos_compatible("সুবহ", "adjective", known))
        self.assertTrue(IMPORTER.pos_compatible("হ্রাস করা", "verb", known))
        self.assertTrue(IMPORTER.pos_compatible("অজানা", "adjective", known))

    def test_wrong_sections_quotes_and_literal_templates_are_excluded(self):
        source = """=={{ভাষা|bn}}==
===বিশেষ্য===
# [[heart]]
#* quoted [[unrelated]]
====উদাহরণ====
# [[not a meaning]]
=={{ভাষা|as}}==
===বিশেষ্য===
# [[wrong language]]
"""
        selected = [(lang, list(IMPORTER.definition_lines(section))) for lang, section in IMPORTER.sections(source)]
        self.assertEqual(selected, [("bn", [("noun", "[[heart]]")])])
        self.assertIsNone(IMPORTER.english_gloss("<nowiki>{{l|en|made up}}</nowiki>"))


if __name__ == "__main__":
    unittest.main()
