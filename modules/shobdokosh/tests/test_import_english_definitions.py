import importlib.util
from pathlib import Path
import unittest


SPEC = importlib.util.spec_from_file_location(
    "english_definition_importer", Path(__file__).resolve().parents[1] / "scripts/import_english_definitions.py"
)
IMPORTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(IMPORTER)


class EnglishDefinitionTests(unittest.TestCase):
    def test_narrative_and_examples_stay_in_one_definition(self):
        raw = "এমন [[মেরুদণ্ডী প্রাণী]], যার চোয়াল আছে—যেমন [[সরীসৃপ]], [[স্তন্যপায়ী]]।"
        self.assertEqual(IMPORTER.clean_definition(raw),
                         "এমন মেরুদণ্ডী প্রাণী, যার চোয়াল আছে—যেমন সরীসৃপ, স্তন্যপায়ী।")

    def test_labels_links_and_qualifiers_are_preserved(self):
        self.assertEqual(IMPORTER.clean_definition("{{lb|en|সাহিত্যিক}} {{l|bn|তরী}}, [[নৌকা]] {{q|ছোট}}।"),
                         "(সাহিত্যিক) তরী, নৌকা (ছোট)।")

    def test_unknown_template_and_inflection_relation_do_not_become_definitions(self):
        for raw in ["{{এর বহুবচন|en|book}}", "{{invented|বাংলা}}", "[[book]] এর বহুবচন।",
                    "[[নৌকা]] এর বিকল্প বানান।", "দেখুন [[নৌকা]]", "{{ux|en|I see a book|আমি বই দেখি}}"]:
            self.assertIsNone(IMPORTER.clean_definition(raw), raw)

    def test_other_scripts_and_malformed_orthography_are_rejected(self):
        self.assertIsNone(IMPORTER.clean_definition("सहসম্বন্ধ কমানো।"))
        self.assertIsNone(IMPORTER.clean_definition("কিছু বিৃঙ্খলা করা।"))
        self.assertIsNone(IMPORTER.clean_definition("[[হত্তয়া]]"))
        self.assertIsNone(IMPORTER.clean_definition("ভিেওয়পিকটইউর বিষয়ক নির্দিষ্ট ধারণা, অবস্থা বা প্রক্রিয়া।"))

    def test_display_templates_preserve_definition_prose_and_taxon_names(self):
        self.assertEqual(IMPORTER.clean_definition(
            "{{sid|en|Q25265}} {{lb|en|প্রাণীবিজ্ঞান}} [[বিড়াল]] পরিবার ({{taxfmt|Felidae|family}})-র যে কোনো সদস্য। {{C|en|স্তন্যপায়ী}}"),
            "(প্রাণীবিজ্ঞান) বিড়াল পরিবার (Felidae)-র যে কোনো সদস্য।")
        self.assertEqual(IMPORTER.clean_definition("{{non-gloss|বিস্ময় প্রকাশ করতে ব্যবহৃত একটি শপথ।}}"),
                         "বিস্ময় প্রকাশ করতে ব্যবহৃত একটি শপথ।")
        self.assertEqual(IMPORTER.clean_definition("{{tlb|en|সকর্মক|সাহিত্যিক}} শীতল করা।"),
                         "(সকর্মক; সাহিত্যিক) শীতল করা।")

    def test_bangla_metadata_does_not_make_an_english_body_a_bangla_definition(self):
        fixtures = {
            "actively": "actively-এর প্রায়োগিক অর্থ: in an active manner।",
            "amplitude": "amplitude-এর প্রায়োগিক অর্থ: (physics) the maximum displacement of a periodic wave।",
            "Abrasax": "{{lb|en|ঐতিহাসিক}} A gem engraved with the word Abrasax or Abraxas.",
        }
        for title, raw in fixtures.items():
            text = "=={{ভাষা|en}}==\n===বিশেষ্য===\n# " + raw
            self.assertEqual(list(IMPORTER.page_definitions(title, text)), [], title)

    def test_short_bangla_bodies_and_scientific_names_survive_english_qualifiers(self):
        for raw, expected in [
            ("{{lb|en|colloquial}} ভারত", "(colloquial) ভারত"),
            ("{{lb|en|botany}} এক ধরনের ফুল ({{taxfmt|Rosa alba|species}})।",
             "(botany) এক ধরনের ফুল (Rosa alba)।"),
            ("metal-এর প্রায়োগিক অর্থ: এক ধরনের ধাতু।", "metal-এর প্রায়োগিক অর্থ: এক ধরনের ধাতু।"),
            ("(এক ধরনের ধাতু)।", "(এক ধরনের ধাতু)।"),
        ]:
            self.assertEqual(IMPORTER.clean_definition(raw), expected)

    def test_wrong_language_etymologies_and_quotes_are_not_meanings(self):
        text = """=={{ভাষা|fr}}==
===বিশেষ্য===
# ভুল ভাষার অর্থ।
=={{ভাষা|en}}==
===ব্যুৎপত্তি===
# ব্যুৎপত্তি মাত্র।
===বিশেষ্য===
# হার্ডওয়্যারের একজন [[বিক্রেতা]]।
## ছোট দোকানদার।
#: উদ্ধৃত উদাহরণ।
#* উদ্ধৃতি।
====অনুবাদ====
# অন্য ভাষার অনুবাদ।
"""
        self.assertEqual(list(IMPORTER.page_definitions("ironmonger", text)), [
            ("noun", "হার্ডওয়্যারের একজন বিক্রেতা।"), ("noun", "ছোট দোকানদার।")])

    def test_redirects_and_non_english_titles_cannot_supply_definitions(self):
        text = "=={{ভাষা|en}}==\n===বিশেষ্য===\n# বই।"
        self.assertEqual(list(IMPORTER.page_definitions("বই", text)), [])
        self.assertEqual(list(IMPORTER.page_definitions("book", "#REDIRECT [[another]]\n" + text)), [])

    def test_reviewed_misleading_source_definition_is_omitted_as_a_whole(self):
        text = "=={{ভাষা|en}}==\n===বিশেষ্য===\n# হত্যা, খুন, [[পাচার]]।"
        self.assertEqual(list(IMPORTER.page_definitions("murder", text)), [])


if __name__ == "__main__":
    unittest.main()
