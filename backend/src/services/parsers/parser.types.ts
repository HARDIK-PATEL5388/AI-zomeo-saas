// Repertory parser contract.
// Each book in rep_books carries a `parser_type` (added in migration 010);
// the upload pipeline resolves a RepertoryParser from the parserRegistry and
// delegates validation, preview, and import to it.
//
// All parsers normalize into the same rep_* tables — no parser-specific schema.

import type { Pool, PoolClient } from 'pg'

export type FileStatus = 'SYNCED' | 'UNCHANGED' | 'MISSING' | 'FAILED'

export interface FileSummary {
  file: string
  status: FileStatus
  hash?: string
  added?: number
  updated?: number
  skipped?: number
  error?: string
  durationMs?: number
}

export interface ValidationIssue { file: string; problem: string }
export interface ValidationResult { ok: boolean; issues: ValidationIssue[] }

export interface FilePreview {
  file: string
  totalRows: number
  parsedRows: number
  newRows: number
  existingRows: number
  toUpdateRows: number
  unchangedRows: number
  skippedRows: number
}

export interface FileSpec {
  /** Exact file name the wizard expects (e.g. "Complete.tab", "QRepV4.csv"). */
  name: string
  required: boolean
  /** Minimum number of columns the first non-empty row must have. */
  minColumns?: number
  /** One-line label shown in the wizard checklist. */
  description?: string
}

export interface ParserContext {
  /** Resolved book row id from rep_books. */
  bookId: number
  /** Same id, but the canonical book code (used for file_versions dedup). */
  bookCode: string
  /**
   * Every file uploaded for this import, keyed by basename. Lets a parser
   * consult sibling files (e.g. an enrichment lookup table) while only the
   * "current" file's transaction is open. Read-only; do not mutate.
   */
  files: Map<string, Buffer>
  /** Per-job log callback. Optional; safe to call on missing files. */
  onProgress?: (file: string, message: string) => void
}

export interface RepertoryParser {
  /** Stable identifier — also the value stored in rep_books.parser_type. */
  id: string
  /** Human-readable name shown in the wizard's parser dropdown. */
  name: string
  /** One-line explanation. */
  description: string
  /** Files this parser accepts. The wizard uses this to render Step 2. */
  fileSpec: FileSpec[]
  /** FK-safe order in which importToBook will process the supplied files. */
  importOrder: string[]

  /** Pure check: file presence + minimum columns. Never touches the DB. */
  validate(files: Map<string, Buffer>): ValidationResult

  /**
   * Preview = how many rows would insert vs update vs stay unchanged,
   * scoped to the target book. Read-only.
   */
  preview(
    files: Map<string, Buffer>,
    bookId: number | null,
    pool: Pool,
  ): Promise<FilePreview[]>

  /**
   * Import one file. The orchestrator opens a transaction and writes the
   * rep_file_versions row; the parser only reads the buffer and emits its
   * own UPSERTs against the supplied client. Throw to roll back this file.
   *
   * Files outside this parser's importOrder must throw `Unknown file: X`.
   */
  importFile(
    client: PoolClient,
    fileName: string,
    buffer: Buffer,
    ctx: ParserContext,
  ): Promise<{ added: number; updated: number; skipped: number }>
}
