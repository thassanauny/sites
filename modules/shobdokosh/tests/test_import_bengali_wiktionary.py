"""Run with python3 -m unittest discover -s tests -p 'test_import_*.py'."""

import importlib.util
from pathlib import Path
import unittest


SPEC = importlib.util.spec_from_file_location(
    "bn_wiktionary_importer", Path(__file__).resolve().parents[1] / "scripts/import_bengali_wiktionary.py"
)
IMPORTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(IMPORTER)


class ExplicitTranslationTests(unittest.TestCase):
    def parse(self, source, title="গোধূলি"):
        return list(IMPORTER.page_translations(title, source))

    def test_only_bengali_language_section_can_supply_translations(self):
        result = self.parse("""=={{ভাষা|as}}==
===অনুবাদ===
ইংরেজি: {{t|en|Assamese meaning}}
=={{ভাষা|bn}}==
===বিশেষ্য===
# সন্ধ্যার আলো।
====অনুবাদ====
ইংরেজি: {{t|en|twilight}}, {{t+|en|dusk}}
=={{ভাষা|hi}}==
===অনুবাদ===
{{t|en|Hindi meaning}}
""")
        self.assertEqual(result, [("twilight", "গোধূলি", "noun"), ("dusk", "গোধূলি", "noun")])

    def test_bengali_only_gloss_and_other_english_mentions_cannot_become_meanings(self):
        self.assertEqual(self.parse("""=={{ভাষা|bn}}==
===ব্যুৎপত্তি===
{{t|en|unrelated etymological term}}
===বিশেষ্য===
# বাংলা ভাষার একটি দীর্ঘ ব্যাখ্যা।
===সমার্থক শব্দ===
{{t|en|unrelated synonym mention}}
[[en:twilight]]
"""), [])

    def test_translation_scope_ends_at_a_sibling_heading(self):
        result = self.parse("""==বাংলা==
===বিশেষ্য===
====অনুবাদ====
{{t|en|twilight}}
====তথ্যসূত্র====
{{t|en|not a translation}}
""")
        self.assertEqual(result, [("twilight", "গোধূলি", "noun")])

    def test_comments_and_literal_examples_are_not_live_translations(self):
        result = self.parse("""=={{ভাষা|bn}}==
===অনুবাদ===
<!-- {{t|en|commented example}} -->
<nowiki>{{t|en|literal example}}</nowiki>
<pre>{{t|en|another example}}</pre>
{{t|en|twilight}}
""")
        self.assertEqual(result, [("twilight", "গোধূলি", None)])

    def test_unrelated_languages_and_malformed_targets_are_rejected(self):
        result = self.parse("""=={{ভাষা|bn}}==
===অনুবাদ===
{{t|fr|crépuscule}}
{{t|en|বাংলা শব্দ}}
{{t|en|слово}}
{{t|en|<script>}}
{{t|en|twilight|tr=unrelated transcription}}
""")
        self.assertEqual(result, [("twilight", "গোধূলি", None)])
        self.assertEqual(self.parse("==বাংলা==\n===অনুবাদ===\n{{t|en|twilight}}", title="English"), [])

    def test_different_parts_of_speech_keep_their_source_context(self):
        result = self.parse("""=={{ভাষা|bn}}==
===বিশেষ্য===
====অনুবাদ====
{{t|en|glow}}
===ক্রিয়া===
====অনুবাদ====
{{t|en|shine}}
""")
        self.assertEqual(result, [("glow", "গোধূলি", "noun"), ("shine", "গোধূলি", "verb")])


if __name__ == "__main__":
    unittest.main()
