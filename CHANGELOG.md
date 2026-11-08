# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-08

First release: dataset profiling, redacted PII scan and Datasheet export.

### Added

- `dataset_inspect`: bounded CSV/TSV/JSON/JSONL profiling (columns, inferred
  types, missingness, sampled cardinality), PII detection by column name and
  value pattern, license/ethics inputs, and structural issues.
- `dataset_pii`: grouped redacted findings with a risk level and next actions.
- `dataset_card`: Datasheet-style Markdown/JSON card with missing-section
  warnings and SARIF output.
- REP integration: the analysis (never the rows) is stored as evidence; the
  dataset itself is a sha256 artifact.
- 12 tests, including a no-raw-values assertion on the record.

### Notes

- PII evidence is redacted at the pattern level; raw values are never written.
- A clean scan is a sample result, not proof of anonymity.
- Tabular formats only; no Excel/Parquet or disclosure control.
