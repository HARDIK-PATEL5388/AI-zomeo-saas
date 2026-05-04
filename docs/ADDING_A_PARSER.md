# Adding a new repertory parser

> **Audience:** future contributor adding Kent / Murphy / Allen / Boericke /
> a Jeremy variant / any other repertory format.
>
> **Promise of the architecture:** a new repertory = **one new file** in
> `backend/src/services/parsers/` + **one line** in `parserRegistry.ts`.
> No database migration, no UI changes, no edits to the orchestrator,
> the browser, or the analysis engine.
>
> Phase 11 of the multi-book rollout proved this end-to-end with a throw-away
> `demoFlat` parser: created the file, registered it, the parser-type select
> in the wizard auto-listed it, an import landed in `rep_*` tables, the
> browser tree rendered the new book, and removing the file reverted the
> system completely. Total touched files for the demo: **2**.

---

## What stays untouched when you add a parser

- `backend/database/migrations/` — no new SQL.
- `backend/src/routes/repertoryUpload.ts` — no new endpoints.
- `backend/src/services/repertoryUploadService.ts` — no orchestrator changes; it resolves the parser by id and delegates.
- `frontend/src/app/(app)/repertory-upload/page.tsx` — wizard reads `GET /api/repertory-upload/parsers` and `GET /required?parser=<id>`; new parsers appear in the dropdown automatically.
- `frontend/src/app/(app)/repertory/page.tsx` — browser reads `/browse/books`, `/browse/chapters`, `/browse/rubrics`, `/browse/search` against any `book_id`; data lands in the same tables, so the tree renders without code changes.
- `backend/src/services/analysisV2Service.ts` — analysis joins by `rubric_id` (book-agnostic surrogate); a fresh book's rubrics participate in mixed-book repertorization automatically.

---

## What you write

### Step 1 — Implement the parser
Create `backend/src/services/parsers/<myParser>.ts` exporting an object that satisfies `RepertoryParser` (defined in `parser.types.ts`):

```ts
import type { Pool, PoolClient } from 'pg'
import { chunk } from '../tabParser'
import type {
  RepertoryParser, ValidationResult, ValidationIssue,
  FilePreview, ParserContext, FileSpec,
} from './parser.types'

const FILE_SPECS: FileSpec[] = [
  { name: 'rubrics.csv', required: true, minColumns: 4, description: 'chapter,rubric,remedy,grade' },
  // optional: { name: 'aliases.csv', required: false, minColumns: 2, description: 'old:new abbrevs' },
]
const IMPORT_ORDER = FILE_SPECS.map(f => f.name)

function validate(files: Map<string, Buffer>): ValidationResult { /* ... */ return { ok: true, issues: [] } }
async function preview(files: Map<string, Buffer>, bookId: number | null, pool: Pool): Promise<FilePreview[]> { /* ... */ return [] }
async function importFile(client: PoolClient, fileName: string, buffer: Buffer, ctx: ParserContext)
  : Promise<{ added: number; updated: number; skipped: number }> { /* ... */ return { added: 0, updated: 0, skipped: 0 } }

export const myParser: RepertoryParser = {
  id: 'my_parser',
  name: 'My Repertory',
  description: 'short blurb for the wizard',
  fileSpec: FILE_SPECS,
  importOrder: IMPORT_ORDER,
  validate, preview, importFile,
}
```

### Step 2 — Register
Append two lines to `backend/src/services/parsers/parserRegistry.ts`:

```ts
import { myParser } from './myParser'
// ...
registerParser(myParser)
```

That's it. `tsx watch` reloads, the new parser is live.

---

## The contract (interface boundaries)

**The orchestrator owns:**
- The pg pool, the per-file transaction, MD5 dedup, rep_upload_jobs / rep_file_versions row lifecycle, and the per-job log stream.
- It opens `BEGIN`, calls `parser.importFile(client, fileName, buf, ctx)`, then `COMMIT` (or `ROLLBACK` on throw).

**The parser owns:**
- File format (extension, delimiter, encoding, validation rules).
- The mapping from raw rows to `rep_*` table rows (UPSERTs against `client`).
- Idempotency — a re-run with the same input must produce the same DB state.

**Shared rules:**
- `rep_remedies` is shared across books. Look up by canonical abbreviation (lowercased + trailing periods stripped — see `canonAbbrev` in `jeremyQRep.ts`). Insert only if absent. Allocate `rem_code = MAX(rem_code) + 1`.
- `rep_book_chapters`, `rep_rubrics`, `rep_rubric_remedies`, `rep_xrefs`, `rep_polar_pairs`, `rep_papasub`, `rep_page_refs`, `rep_library_index` all carry `book_id` as the leading column of their composite PK. Always include `book_id = ctx.bookId` in INSERTs.
- Two parsers MAY use the same `ext_id` for a rubric — the PK is `(book_id, ext_id)`, so namespaces don't collide.
- Conflict targets must include `book_id` for any UPSERT into a per-book table.
- Pre-deduplicate rows in memory before bulk INSERT. Postgres rejects two rows hitting the same `ON CONFLICT` target in one statement.

---

## Data shape your parser writes into

| Table | Required columns | Conflict target |
|---|---|---|
| `rep_book_chapters` | `(book_id, name, code, sort_order)` | `(book_id, name)` |
| `rep_rubrics` | `(book_id, ext_id, parent_ext_id, depth, chapter_id, chapter, rubric_text, full_path)` | `(book_id, ext_id)` |
| `rep_remedies` (shared) | `(rem_code, abbreviation, full_name, common_name)` | `(rem_code)` |
| `rep_rubric_remedies` | `(book_id, rubric_ext_id, rem_code, grade)` | `(book_id, rubric_ext_id, rem_code)` |
| `rep_xrefs` (optional) | `(book_id, xref_id, pair_id, rubric_ext_id_1, rubric_ext_id_2, rel_type)` | `(xref_id)` |
| `rep_polar_pairs` (optional) | `(book_id, ext_id_1, ext_id_2)` | `(book_id, ext_id_1, ext_id_2)` |

Anything outside these tables means you're inventing a Jeremy-specific table — don't.

---

## Wizard, browser, and analysis behavior you get for free

- **Wizard Step 0 → "Create new book"** — your parser id appears in the parser-type select. The user picks it; the new `rep_books` row gets `parser_type = 'my_parser'`.
- **Wizard Step 1 → "Upload Files"** — the file checklist is rendered from your `fileSpec`; `<input accept>` is built from the file extensions you declared.
- **Wizard Step 2 → Validate / Preview** — the orchestrator calls `parser.validate` and `parser.preview` for the resolved parser id and renders the result.
- **Wizard Step 3 → Import** — per-file transaction loop calls `parser.importFile` for each file in `importOrder`.
- **Repertory Browser** — your book is listed in `/browse/books` automatically; click → chapters → rubrics → remedies works the same way as Complete.
- **Search** — both `?book=my_parser_book` and the all-books default (no `book` param) include your data; result rows carry `book_code` + `book_name`.
- **Analysis** — `case_rep_rubrics` references rubrics by surrogate `rubric_id` (auto-allocated by `rep_rubrics_rubric_id_seq`). A case can mix rubrics from any book; `runAnalysis` aggregates remedies by `rem_code` across them.

---

## Phase 11 proof of the recipe

Steps run live against `mydb`:

1. **Created** `backend/src/services/parsers/demoFlat.ts` (~120 lines, `id: 'demo_flat'`, single file `demo.csv`).
2. **Added** two lines to `parserRegistry.ts`. `tsc --noEmit`: clean.
3. `GET /api/repertory-upload/parsers` → 3 parsers listed: `complete_tab`, `jeremy_qrep`, `demo_flat (1 required file)`.
4. `GET /required?parser=demo_flat` → `files: ["demo.csv"]`, `fileSpec: [...]` returned dynamically.
5. `POST /books {code:'demo', parserType:'demo_flat'}` → 201, row created with `parser_type='demo_flat'`.
6. `POST /validate` with a 10-row CSV → `valid:true, parser:'demo_flat'`.
7. `POST /import-async` → job 50 → `done` in 124 ms; `+13` rows (2 chapters + 3 rubrics + 8 remedy links — the 13 sums chapter inserts + rubric inserts + rrem inserts).
8. `GET /browse/books` → demo book appears as the 4th entry, `chapter_count=2, rubric_count=3`.
9. `GET /browse/chapters?book=demo` → `Mind`, `Sleep` (2 chapters).
10. `GET /browse/rubrics/<joyful_id>` → 4 graded remedies, `coff./sulph.` at grade 4, `puls.` at grade 3, `nat-m.` at grade 2 — and the `rem_code`s match the existing Complete rep_remedies rows (`701 coff., 1854 puls., 1581 nat-m., 2120 sulph.`). **Zero new `rep_remedies` rows inserted** — the demo book reused Complete's catalog.
11. **Reverted** by deleting the demo book + dropping the parser file + reverting the registry. Final `/parsers`: only `complete_tab` and `jeremy_qrep`. Database back to baseline.

Total persistent code change for the demo: **0 lines**. The architecture supports adding any new repertory format with the recipe above.

---

## Common future cases

| Repertory | Likely parser id | File shape | Anything special? |
|---|---|---|---|
| Kent (.tab) | `complete_tab` | already handled — same 8 .tab files as Complete | nothing new; just `parserType: 'complete_tab'` when creating the book |
| Murphy (.tab) | `complete_tab` | same as above | same |
| Allen (CSV) | new `allen_csv` | flat `chapter,rubric,remedy,grade` | one new parser file; ~80 lines following the demoFlat skeleton above |
| Boericke (CSV) | new `boericke_csv` | similar — Materia Medica style hierarchical | start with Allen's, add depth/parent handling if rubrics nest |
| Jeremy variant | new `jeremy_qrep_v5` | follow `jeremyQRep.ts` as the template | swap file names + column indexes; share `canonAbbrev` logic |

In every case: **one file under `parsers/`, one line in `parserRegistry.ts`. No migration. No UI changes.**
