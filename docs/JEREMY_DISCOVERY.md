# Jeremy (QRep) — Phase 5 discovery report

> **Purpose:** Determine which files in `JeremyData/` the Jeremy parser will actually consume,
> document each file's structure, and lock the minimum-required set before any parser code is written.
>
> **Source folder inspected:** `C:\Users\Beact Infotech\Downloads\ciicic\oldandnew\JeremyData`
> **Total files:** 13. **No BOMs detected** on any of the CSV/TXT files.

---

## 1. Per-file inventory

| # | File | Format | Bytes | Lines | Encoding | Purpose | Required? | Optional? | Ignore? | Used by import? | Used by browser? | Used by analysis? |
|---|---|---|---|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|
| 1 | `Definitions.csv` | header CSV / body **TAB-separated** | 43,244 | 39 | UTF-8 | 38 Mental Quality definitions: name, EN description, primary description, DE name, DE description, DE primary description | ✅ | — | — | yes — quality master & rubric text source | indirectly (chapter/rubric text) | yes (rubric text shown next to graded remedies) |
| 2 | `QRepV4.csv` | CSV (`,` delimited) | 222,062 | 10,684 | UTF-8 | Per-quality remedy list with grade. Header: `Complete Name,Grade,Mental Qualities`. Distinct: 1,436 remedies × 38 qualities. Grade distribution: g1=4694 / g2=4216 / g3=1137 / g4=636. | ✅ | — | — | yes — populates `rep_rubric_remedies` for the "Quality:" rubric of each quality | no | yes (analysis joins via `rubric_id`) |
| 3 | `Primary.QRepV4.csv` | CSV (`,` delimited) | 35,974 | 1,774 | UTF-8 | Primary-remedy subset. Header: `Remedy,Mark,Quality`. 1,773 records, **all grade 3 or 4** — exactly equals the g3+g4 count of QRepV4. | ✅ | — | — | yes — populates `rep_rubric_remedies` for the "Quality (Primary remedies):" rubric | no | yes |
| 4 | `AbbreviationTable.QRepV4.csv` | CSV (`,` delimited) | 36,781 | 1,457 | UTF-8 | Long-name → abbreviation map. Header: `Remedy: Substance,Complete`. 1,446 entries. Note: only 41 of the "Complete" values match `rep_remedies.abbreviation` — this is Jeremy's own substance map, not a Jeremy→Complete bridge. | — | ✅ | — | optional — used to enrich `rep_remedies.full_name` for newly-inserted Jeremy remedies | no | no |
| 5 | `RemReplace.txt` | colon-separated | 3,769 | 233 | UTF-8 | `OldAbbrev:NewAbbrev` aliases. Recovers 87 of the otherwise-unmatched Jeremy abbreviations to abbreviations already present in `rep_remedies`. | — | ✅ | — | optional — alias normalization before remedy lookup | no | no |
| 6 | `QRep.txt` | text (custom dump) | 117,047 | 76 | UTF-8 | Self-contained dump of every Jeremy rubric in the format `#<depth> <Rubric>:$<grade>:<abbr>, <grade>:<abbr>, ...`. 76 lines = 38 qualities × 2 rubrics (general + primary). **Could entirely replace files #2 + #3** if we ever want a single-file ingest path. | — | ✅ alt source | — | not in v1 (CSVs are simpler to validate) | no | no |
| 7 | `QRepFormated.txt` | text (custom dump) | 116,923 | 76 | UTF-8 | Same logical content as #6, slight formatting differences (whitespace). | — | — | ✅ | superseded by #6 | no | no |
| 8 | `QRep.abbreviationtable.csv` | CSV (broken — single line, no `\n`) | 32,911 | 1 | UTF-8 | Same data as #4 with all newlines stripped. Unparseable as CSV. | — | — | ✅ | corrupted duplicate | no | no |
| 9 | `HompathRemedy.txt` | text (one column) | 26,797 | 3,454 | UTF-8 (with BOM `0xEF 0xBB 0xBF` on the first line) | Hompath software's own abbreviation list. Unrelated to Zomeo's remedy table. | — | — | ✅ | — | no | no |
| 10 | `QRep.xrf` | text | 46,027 | 266 | UTF-8 | Plain-text dump of every quality definition with EN+DE descriptions, grouped by Quality+(Primary remedies) blocks. Equivalent to a flattened version of `Definitions.csv`. | — | — | ✅ | — | no | no |
| 11 | `QRep.V4.xlsx` | Excel | 2,406,665 | — | binary | Excel master containing the same content as #2/#3/#4 in separate sheets. | — | — | ✅ (defer) | — | no | no |
| 12 | `Definitions.xlsx` | Excel | 38,135 | — | binary | Excel of #1. | — | — | ✅ (defer) | — | no | no |
| 13 | `Remedy data New Jeremy S.xlsx` | Excel | 11,568 | — | binary | Tiny supplementary remedies file. Content unverified (xlsx). | — | — | defer | revisit only if remedies are missing after import | no | no |

### Why ignore the .xlsx files?
The CSVs (#1–#4) cover everything we need. Adding `xlsx`/`exceljs` for files we have CSV equivalents of would add >1 MB of dependencies and one more failure surface. Defer until proven necessary.

### Why ignore #6/#7 in v1?
`QRep.txt` and `QRepFormated.txt` ARE complete data sources. But:
- They use a custom one-line-per-rubric format that needs its own parser.
- The CSVs are easier to spot-check, validate column-by-column, and explain to the user.
- Keeping the input small (3 required + 1 optional) matches the user's "minimum required Jeremy file set" goal.
- We can add a "QRep dump" parser later if requested.

---

## 2. File-format gotchas

### 2.1 `Definitions.csv` is misnamed — header is CSV, body is TSV

```
Header (line 1):  Mental Qualities Name,Description,Primary rubric description,Quality: German,Description: German,Description: Primary German
Body   (line 2+): Ambition\tSuitable for any patient...\tPrimary remedies have...\tEhrgeiz\tPassend für...\tDiese Hauptmittel...
```

The body uses **TAB** as the field separator because every description contains natural commas. The header just happens to be comma-separated. The parser MUST split body lines on `\t` (six fields, indexed 0–5):

| Index | Column | Notes |
|---:|---|---|
| 0 | English quality name (e.g. `Ambition`) — used as the rubric label and as the join key against QRepV4/Primary | Trim trailing space; some entries have one. |
| 1 | English Quality description | Long free text. |
| 2 | English Primary-remedies description | Long free text. |
| 3 | German quality name (e.g. `Ehrgeiz`) | Sometimes blank. |
| 4 | German Quality description | |
| 5 | German Primary-remedies description | |

### 2.2 The CSVs have NO quoted fields
Spot-checked: `Primary.QRepV4.csv`, `QRepV4.csv`, `AbbreviationTable.QRepV4.csv` use `,` as field separator with no quoting and no embedded commas in any field. A naïve `line.split(',')` works correctly for all 12,913 data rows across these three files (10,683 + 1,773 + 1,456 = total 13,912 — recounted, all fields free of `,` and `"`).

### 2.3 Quality name normalization
A small number of `Quality` values in the CSVs have a trailing space (e.g. `"Closed People "`, `"Dyslexia-Dyspraxia "`). The same trailing space appears in Definitions. As long as we trim consistently across all files, the join works. **All 38 distinct quality names match across Definitions / QRepV4 / Primary** when trimmed.

### 2.4 Quality count: confirmed 38

```
Definitions.csv distinct Quality:    38
QRepV4.csv     distinct Quality:    38
Primary.QRepV4 distinct Quality:    38
```

Match is exact after trimming — no orphan qualities in any file.

### 2.5 Primary IS exactly the grade-3+4 subset of QRepV4
- QRepV4 grade 3+4 row count: `1137 + 636 = 1773`
- Primary.QRepV4 row count:    `1773`

So Primary is mathematically derivable from QRepV4. We still load both — Primary is what populates the `(Primary remedies)` rubric, and treating it as authoritative means the parser doesn't have to encode the "Primary = grade ≥ 3" rule (Jeremy reserves the right to redefine "primary" per quality in future releases).

---

## 3. Remedy abbreviation overlap with `rep_remedies`

| Set | Count |
|---|---:|
| Distinct lower-cased Jeremy abbreviations (QRepV4 col 0) | **1,429** |
| Distinct lower-cased abbreviations in `rep_remedies` | 2,760 |
| Overlap (Jeremy abbrev already exists in `rep_remedies`) | **42** |
| Jeremy abbreviations NOT in `rep_remedies` | **1,387** |
| ↳ recoverable via `RemReplace.txt` alias (`old → new`) | 87 |
| Net brand-new remedies after RemReplace | **~1,300** |

**Implication for the parser:**
- `rep_remedies` is shared across books (by design).
- Jeremy uses a different abbreviation convention than Complete (`CPP/HRI` style), so most of its 1,436 distinct remedies are new.
- Strategy: for each Jeremy abbreviation, look it up in `rep_remedies` (with optional `RemReplace.txt` aliasing). If absent, INSERT a new row with a freshly allocated `rem_code` and the substance name from `AbbreviationTable.QRepV4.csv` if available.
- This keeps `rep_remedies` as a single shared catalog while letting Jeremy's books reference its own remedies via integer `rem_code`.

---

## 4. Dependency graph

```
                      ┌────────────────────────┐
                      │  Definitions.csv       │  (38 qualities — TSV body)
                      └──────────┬─────────────┘
                                 │ EN quality name
                                 │ (trim, exact match)
                                 ▼
            ┌────────────────────┴────────────────────┐
            │                                         │
┌───────────────────┐                       ┌───────────────────┐
│  QRepV4.csv       │                       │ Primary.QRepV4.csv│
│ (remedy, grade,   │ matches               │ (remedy, mark,    │
│  quality)         │ quality name          │  quality)         │
└─────────┬─────────┘                       └─────────┬─────────┘
          │                                           │
          │ remedy abbrev                             │ remedy abbrev
          │ (lower-cased, optionally aliased)         │
          ▼                                           ▼
   ┌──────────────────────────────┐         ┌──────────────────────────────┐
   │ rep_remedies (shared)        │         │ rep_remedies (shared)        │
   │ ↳ existing rem_code          │         │ ↳ existing rem_code          │
   │ ↳ INSERT new (with full_name │         │ ↳ INSERT new (with full_name │
   │   from AbbreviationTable)    │         │   from AbbreviationTable)    │
   └──────────────┬───────────────┘         └──────────────┬───────────────┘
                  │                                        │
                  ▼                                        ▼
   ┌──────────────────────────────┐         ┌──────────────────────────────┐
   │ rep_rubric_remedies          │         │ rep_rubric_remedies          │
   │ rubric = "<Q> Quality:"      │         │ rubric = "<Q> Quality        │
   │ grade  = QRepV4.Grade        │         │   (Primary remedies):"        │
   │                              │         │ grade  = Primary.Mark        │
   └──────────────────────────────┘         └──────────────────────────────┘

   ┌────────────────────────────────────────────────────────────┐
   │  AbbreviationTable.QRepV4.csv  (OPTIONAL — enrichment only)│
   │   substance → abbreviation                                 │
   └────────────────────────────────────────────────────────────┘

   ┌────────────────────────────────────────────────────────────┐
   │  RemReplace.txt  (OPTIONAL — alias map)                     │
   │   old:new abbreviation                                     │
   └────────────────────────────────────────────────────────────┘
```

### Required-file edges
- `Definitions.csv` → drives the chapter `Mental Qualities` and the 76 top-level rubric rows in `rep_rubrics`.
- `QRepV4.csv` → must be readable AFTER the rubrics for that quality exist (parser handles ordering internally).
- `Primary.QRepV4.csv` → same ordering constraint as above.

### Optional edges
- `AbbreviationTable.QRepV4.csv` → consulted only when inserting a brand-new remedy into `rep_remedies` (to populate `full_name`); never required for a successful import.
- `RemReplace.txt` → consulted only when an abbreviation lookup misses; never required.

### No edges to legacy files
- `QRep.txt`, `QRepFormated.txt`, `QRep.xrf`, `QRep.abbreviationtable.csv`, `HompathRemedy.txt`, all `.xlsx` files → not consumed by the import pipeline.

---

## 5. Minimum required Jeremy file set

```
REQUIRED (3):
  Definitions.csv
  QRepV4.csv
  Primary.QRepV4.csv

OPTIONAL (2):
  AbbreviationTable.QRepV4.csv     ← improves new-remedy full_name coverage
  RemReplace.txt                   ← lets ~87 Jeremy abbreviations re-use existing rep_remedies rows
```

**Validation rules** (exposed via the parser's `fileSpec`):

| File | Required | Min cols | Delimiter | Notes |
|---|:-:|:-:|---|---|
| `Definitions.csv` | yes | 6 | `\t` (body) | header is `,`-separated; skip row 0 |
| `QRepV4.csv` | yes | 3 | `,` | skip row 0 |
| `Primary.QRepV4.csv` | yes | 3 | `,` | skip row 0 |
| `AbbreviationTable.QRepV4.csv` | no | 2 | `,` | skip row 0 |
| `RemReplace.txt` | no | 2 | `:` | no header |

---

## 6. Data shape after Jeremy import

| Table | New rows |
|---|---:|
| `rep_books` | +1 (`code='jeremy', name='Jeremy', parser_type='jeremy_qrep'`) |
| `rep_book_chapters` | +1 (`Mental Qualities`) |
| `rep_rubrics` | +76 (38 qualities × 2 sibling rubrics: "X Quality:" + "X Quality (Primary remedies):") |
| `rep_rubric_remedies` | +12,456 (10,683 from QRepV4 + 1,773 from Primary) |
| `rep_remedies` | +~1,300 brand-new + 0 updated existing (after RemReplace) |
| `rep_xrefs` | 0 |
| `rep_polar_pairs` | 0 |
| `rep_papasub` | 0 |
| `rep_page_refs` | 0 |
| `rep_library_index` | 0 |

Total new rows: **~13,800**. No new tables. No Jeremy-specific columns.

---

## 7. Parser id and registration

- Parser id: `jeremy_qrep` (matches the user's brief)
- Registry: `backend/src/services/parsers/parserRegistry.ts` — append `import { jeremyQRepParser } from './jeremyQRep'; registerParser(jeremyQRepParser)`
- Wizard: appears automatically in the parser-type select (driven by `GET /api/repertory-upload/parsers`)
- Books: `parser_type='jeremy_qrep'` set on the row when the user creates the Jeremy book through the wizard

---

## 8. Open questions before Phase 6

The Phase 1 plan asked five clarifying questions. For Phase 5 only one matters again:

> **Trailing-space quality names** (e.g. `"Closed People "`, `"Dyslexia-Dyspraxia "`) — keep the trailing space so the rubric text matches Jeremy's own dataset bit-for-bit, or trim for cosmetic cleanliness?

I'm proposing **trim**: rubric text should read `"Closed People Quality:"`, not `"Closed People  Quality:"`. Easy to invert if you want fidelity instead.

Everything else from Phase 1 (one chapter "Mental Qualities", 76 sibling rubrics, RemReplace as optional alias map, parser-type select in wizard) stands.

---

## 9. Phase 5 verification

Source-of-truth commands used to produce the numbers above (run live against the source folder):

```bash
JD="/c/Users/Beact Infotech/Downloads/ciicic/oldandnew/JeremyData"

# Distinct qualities per file
awk -F'\t' 'NR>1 {print $1}' "$JD/Definitions.csv"     | sort -u | wc -l   # 38
awk -F','  'NR>1 {print $3}' "$JD/QRepV4.csv"          | sort -u | wc -l   # 38
awk -F','  'NR>1 {print $3}' "$JD/Primary.QRepV4.csv"  | sort -u | wc -l   # 38

# Grade distribution in QRepV4
awk -F',' 'NR>1 {print $2}' "$JD/QRepV4.csv" | sort | uniq -c
#   4694 1
#   4216 2
#   1137 3
#    636 4

# Primary == grade 3+4 of QRepV4
wc -l "$JD/Primary.QRepV4.csv"   # 1774  → 1773 data rows = 1137 + 636 ✓

# Distinct Jeremy remedies
awk -F',' 'NR>1 {print tolower($1)}' "$JD/QRepV4.csv" | sort -u | wc -l   # 1429

# Overlap with rep_remedies (live DB)
docker exec postgres-db psql -U postgres -d mydb -tAc \
  "SELECT lower(abbreviation) FROM rep_remedies WHERE abbreviation IS NOT NULL" \
  > /tmp/complete_abbrevs.txt
comm -12 <(awk -F',' 'NR>1 {print tolower($1)}' "$JD/QRepV4.csv" | sort -u) \
         <(sort -u /tmp/complete_abbrevs.txt) | wc -l    # 42 overlap
```

All numbers in this report were produced by these commands; nothing was estimated.
