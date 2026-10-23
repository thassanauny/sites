# Avro phonetic engine

`avro-phonetic.js` contains the jsAvroPhonetic rule engine by Rifat Nabi and
OmicronLab, as distributed by Sarim Khan's ibus-avro project under the Mozilla
Public License 2.0. Copyright and license notices are retained in the source.

- Upstream: <https://github.com/sarim/ibus-avro>
- Pinned commit: `dd521a139af0b4bb64eaeeca44fef03f5fb770cf`
- Source: <https://github.com/sarim/ibus-avro/blob/dd521a139af0b4bb64eaeeca44fef03f5fb770cf/avrolib.js>
- License: [Mozilla Public License 2.0](./MPL-2.0.txt)
- SHA-256 of unmodified upstream source: `c8362c0044fbed67a7d63d7a42869103d3e3cad2cb7e922120178829945b0a7b`

The only modification to the upstream file is an appended ES-module default
export, labelled in the source. The full, readable modified source is distributed
beside this notice as `avro-phonetic.js`, under the same MPL-2.0 terms. No build,
external service, downloaded dictionary, or runtime network connection is needed.

The app's separate `transliteration.js` wrapper preserves punctuation, digits,
and existing Bangla instead of converting Avro's standalone punctuation and digit
shortcuts. Backtick and `^` remain available within Roman words as Avro controls.
A separate whole-word table accepts 80 familiar lowercase spellings in 34 word
families, including `sundor`, `shundor`, `sundar` and `shundar` → সুন্দর. It also
covers common variants for জীবন, প্রকৃতি, পৃথিবী, শিক্ষা and other words.
These are selected spelling conveniences; they are not global sound replacements
or guesses for every possible Banglish spelling. Distinct words such as
`shob` → শব, `sob` → সব, `bhasa` → ভাসা and `chad` → ছাদ remain separate.
Words containing uppercase letters, backtick or `^` bypass the table and use the
upstream Avro rules. Meaningful letter case remains available: `t`/`T`, `n`/`N`,
`sh`/`Sh` and `o`/`O` differ. Existing Bangla and punctuation remain unchanged.
Phonetic conversion does not translate sentences or automatically resolve every
possible Banglish spelling; users can edit Bangla directly when needed.
