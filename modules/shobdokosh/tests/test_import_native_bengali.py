import importlib.util
from pathlib import Path
import unittest


SPEC = importlib.util.spec_from_file_location(
    "native_bengali_importer", Path(__file__).resolve().parents[1] / "scripts/import_native_bengali.py"
)
IMPORTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(IMPORTER)


class NativeBengaliExtractionTests(unittest.TestCase):
    def extract(self, source, title="নির্ঝর"):
        return IMPORTER.extract_page(title, source, "123456")

    def test_real_definitions_group_by_part_of_speech_without_english_translation(self):
        result = self.extract("""=={{ভাষা|bn}}==
===বিশেষ্য===
# [[ঝরনা]]।
# পাহাড় থেকে নেমে আসা [[জলধারা]]।
===বিশেষণ===
# নিরন্তর প্রবাহমান।
""")
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["en"], "")
        self.assertEqual(result[0]["definitionsBn"], ["ঝরনা।", "পাহাড় থেকে নেমে আসা জলধারা।"])
        self.assertEqual(result[1]["pos"], "adjective")
        self.assertEqual(result[0]["sourceRevision"], "123456")
        self.assertIn("oldid=123456", result[0]["sourceUrl"])
        self.assertNotIn("definitionBn", result[0])

    def test_examples_etymology_quotations_and_other_languages_cannot_become_definitions(self):
        result = self.extract("""=={{ভাষা|bn}}==
===ব্যুৎপত্তি===
# এটি ব্যুৎপত্তি, সংজ্ঞা নয়।
===বিশেষ্য===
# প্রকৃত অর্থ।
#: এটি ব্যবহারের উদাহরণ।
#* এটি উৎস থেকে উদ্ধৃতি।
====উদাহরণ====
# এটিও উদাহরণ।
=={{ভাষা|as}}==
===বিশেষ্য===
# এটি অন্য ভাষার অর্থ।
""")
        self.assertEqual(result[0]["definitionsBn"], ["প্রকৃত অর্থ।"])

    def test_explicit_idiom_meanings_and_older_bullet_definitions_are_supported(self):
        result = self.extract("""==বাংলা==
===ভাবার্থ===
{{বাগধারা|bn}}
# দুই পক্ষের মন রেখে চলা।
""", "ঢেঁকির তসুলি")
        self.assertEqual(result[0]["pos"], "phrase")
        self.assertEqual(result[0]["definitionsBn"], ["দুই পক্ষের মন রেখে চলা।"])
        result = self.extract("""==বাংলা==
===বিশেষ্য===
* [[গল্প]]
* [[আখ্যান]]
""", "কাহিনী")
        self.assertEqual(result[0]["definitionsBn"], ["গল্প", "আখ্যান"])

    def test_labels_known_inline_templates_and_scientific_names_remain_readable(self):
        rendered = IMPORTER.render_definition("{{lb|bn|অপ্রচলিত}} {{q|কাব্যিক}} এক ধরনের [[ফুল]] ({{taxlink|Rosa alba|species}})।")
        self.assertEqual(rendered, ("(অপ্রচলিত; কাব্যিক) এক ধরনের ফুল (Rosa alba)।", ["অপ্রচলিত", "কাব্যিক"]))
        self.assertEqual(IMPORTER.render_definition("{{n-g|পুরুষের প্রদত্ত নামবিশেষ।}}"), ("পুরুষের প্রদত্ত নামবিশেষ।", []))

    def test_relation_only_lines_and_unrenderable_templates_are_excluded(self):
        for raw in [
            "{{alternative spelling of|bn|অর্ঘ্য}}", "অর্ঘ্য শব্দের বিকল্প বানান।",
            "দেখুন: [[অর্ঘ্য]]", "{{অজানা টেমপ্লেট|এখানে সংজ্ঞা আছে}}",
            "[[stream]]", "{{lb|bn|কাব্যিক}} form of [[stream]]",
            "অর্থ:", "‘অসুবিধা'-র কথ্য রূপ।",
            "অলঙ্কৃত, বাগাড়ম্বরপূর্ণ সংক্রান্ত নির্দিষ্ট ভাব, অবস্থা বা প্রক্রিয়া।",
        ]:
            self.assertIsNone(IMPORTER.render_definition(raw), raw)

    def test_nested_meaning_senses_survive_but_nested_examples_do_not(self):
        result = self.extract("""==বাংলা==
===বিশেষ্য===
# প্রবাহিত জলধারা।
## বিশেষ ধরনের ঝরনা।
##: এই বাক্য উদাহরণ।
##* উদ্ধৃতির বাক্য।
""")
        self.assertEqual(result[0]["definitionsBn"], ["প্রবাহিত জলধারা।", "বিশেষ ধরনের ঝরনা।"])

    def test_reviewed_placeholder_is_not_a_native_definition(self):
        source = "==বাংলা==\n===বিশেষ্য===\n# {{lb|bn|figurative}} প্রচলিত sense"
        self.assertEqual(self.extract(source, "অক্ষরজ্ঞান"), [])
        result = self.extract(source + "\n# অক্ষর চিনতে বা পড়তে পারার জ্ঞান।", "অক্ষরজ্ঞান")
        self.assertEqual(result[0]["definitionsBn"], ["অক্ষর চিনতে বা পড়তে পারার জ্ঞান।"])

    def test_references_and_formatting_are_removed_without_inventing_meanings(self):
        self.assertEqual(IMPORTER.render_definition("'''শ্রেষ্ঠ''' [[রাজা]]।<ref name=\"a\" />"), ("শ্রেষ্ঠ রাজা।", []))
        self.assertEqual(IMPORTER.render_definition("{{w|রাজা|রাজার}} [[অধিকার]]।"), ("রাজার অধিকার।", []))
        self.assertIsNone(IMPORTER.render_definition("<code>এটি কোড</code>"))

    def test_ids_are_stable_and_duplicate_definitions_do_not_inflate_senses(self):
        source = "==বাংলা==\n===বিশেষ্য===\n# ঝরনা।\n# ঝরনা।"
        first = self.extract(source)
        second = self.extract(source + "\n# পাহাড়ি জলধারা।")
        self.assertEqual(first[0]["id"], second[0]["id"])
        self.assertEqual(first[0]["definitionsBn"], ["ঝরনা।"])
        self.assertEqual(len(second), 1)

    def test_reviewed_finite_forms_with_wrong_adverb_pos_are_not_extra_lemmas(self):
        result = self.extract("==বাংলা==\n===ক্রিয়াবিশেষণ===\n# গাওয়া; গড়ে তোলা।", "করছেন")
        self.assertEqual(result, [])
        result = self.extract("==বাংলা==\n===ক্রিয়াবিশেষণ===\n# অনভিপ্রেত কিছু ঘটে এমন আশঙ্কায়।", "পাছে")
        self.assertEqual(result[0]["headword"], "পাছে")
        result = self.extract("==বাংলা==\n===ক্রিয়া===\n# ভবিষ্যতে কিছু কাটব, আমি দ্বারা।", "কাটব")
        self.assertEqual(result, [])


if __name__ == "__main__":
    unittest.main()
