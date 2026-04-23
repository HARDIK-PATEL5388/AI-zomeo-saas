// Zomeo.ai — TAB File Validator
// Validates all 7 Complete Repertory TAB files before DB import

import { parseTabBuffer } from './tabParser'

export interface ValidationIssue {
  file: string
  type: string
  row?: number
  col?: number
  message: string
}

interface ColRule {
  name: string
  type: 'integer' | 'string'
  required: boolean
  maxLen?: number
  min?: number
  max?: number
}

interface FileRules {
  minCols: number
  maxCols: number
  minRows: number
  colRules?: Record<number, ColRule>
}

const REQUIRED_FILES = [
  'RemID.tab', 'Remlist.tab', 'REPolar.tab',
  'PapaSub.tab', 'Complete.tab', 'LibraryIndex.tab', 'Pagerefs.tab',
]

const FILE_RULES: Record<string, FileRules> = {
  'RemID.tab': {
    minCols: 2,
    maxCols: 5,
    minRows: 100,
    colRules: {
      0: { name: 'rem_code', type: 'integer', required: true },
      1: { name: 'abbrev', type: 'string', required: true, maxLen: 30 },
    },
  },
  // Remlist.tab = rubric-remedy junction WITH grade (10 cols, 2.8M rows)
  'Remlist.tab': {
    minCols: 2,
    maxCols: 12,
    minRows: 1000,
    colRules: {
      0: { name: 'rubric_ext_id', type: 'integer', required: true },
      1: { name: 'remedy_rem_code', type: 'integer', required: true },
    },
  },
  'REPolar.tab': {
    minCols: 2,
    maxCols: 3,
    minRows: 10,
  },
  // PapaSub.tab = rubric-remedy junction (2 cols: rubric_ext_id, remedy_rem_code)
  'PapaSub.tab': {
    minCols: 2,
    maxCols: 3,
    minRows: 1000,
    colRules: {
      0: { name: 'rubric_ext_id', type: 'integer', required: true },
      1: { name: 'remedy_rem_code', type: 'integer', required: true },
    },
  },
  // Complete.tab = rubric hierarchy (21 cols: ext_id, seq, parent, _, depth, sort, chapter, text...)
  'Complete.tab': {
    minCols: 7,
    maxCols: 25,
    minRows: 10000,
    colRules: {
      0: { name: 'ext_id', type: 'integer', required: true },
      1: { name: 'sequence_id', type: 'integer', required: true },
    },
  },
  'LibraryIndex.tab': { minCols: 2, maxCols: 15, minRows: 10 },
  'Pagerefs.tab': { minCols: 2, maxCols: 5, minRows: 10 },
}

export function getRequiredFiles(): string[] {
  return [...REQUIRED_FILES]
}

export async function validateAllFiles(
  files: Map<string, Buffer>
): Promise<{ ok: boolean; issues: ValidationIssue[] }> {
  const issues: ValidationIssue[] = []

  // Check all required files are present
  for (const required of REQUIRED_FILES) {
    if (!files.has(required)) {
      issues.push({
        file: required,
        type: 'MISSING_FILE',
        message: `${required} is missing from uploaded files`,
      })
    }
  }

  // Validate each file
  for (const [fileName, buffer] of files) {
    const rules = FILE_RULES[fileName]
    if (!rules) continue

    const fileIssues = validateFile(fileName, buffer, rules)
    issues.push(...fileIssues)
  }

  return { ok: issues.length === 0, issues }
}

function validateFile(
  fileName: string,
  buffer: Buffer,
  rules: FileRules
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  // Encoding check — detect UTF-8 BOM
  if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    issues.push({
      file: fileName,
      type: 'WRONG_ENCODING',
      message: 'File has UTF-8 BOM — TAB files must be latin-1 / Windows-1252 encoded',
    })
  }

  const rows = parseTabBuffer(buffer)

  // 1. Minimum row count
  if (rows.length < rules.minRows) {
    issues.push({
      file: fileName,
      type: 'TOO_FEW_ROWS',
      message: `Expected at least ${rules.minRows} rows, got ${rows.length}`,
    })
    return issues
  }

  // 2. Column count per row (sample first 100 rows)
  let colErrors = 0
  for (let i = 0; i < Math.min(rows.length, 100); i++) {
    const row = rows[i]
    if (row.length < rules.minCols) {
      colErrors++
      if (colErrors <= 3) {
        issues.push({
          file: fileName,
          type: 'WRONG_COLUMN_COUNT',
          row: i + 1,
          message: `Row ${i + 1} has ${row.length} columns, expected at least ${rules.minCols}`,
        })
      }
    }
  }

  // 3. Column type validation (sample first 200 rows)
  if (rules.colRules) {
    let typeErrors = 0
    for (let i = 0; i < Math.min(rows.length, 200); i++) {
      const row = rows[i]
      for (const [colIdx, rule] of Object.entries(rules.colRules)) {
        const idx = Number(colIdx)
        const val = row[idx]?.trim()

        if (rule.required && !val) {
          typeErrors++
          if (typeErrors <= 5) {
            issues.push({
              file: fileName,
              type: 'MISSING_REQUIRED_VALUE',
              row: i + 1,
              col: idx,
              message: `Row ${i + 1} col ${idx} (${rule.name}) is empty`,
            })
          }
        }

        if (val && rule.type === 'integer' && isNaN(parseInt(val))) {
          typeErrors++
          if (typeErrors <= 5) {
            issues.push({
              file: fileName,
              type: 'INVALID_TYPE',
              row: i + 1,
              col: idx,
              message: `Row ${i + 1} col ${idx} (${rule.name}) should be integer, got "${val.substring(0, 20)}"`,
            })
          }
        }

        if (val && rule.type === 'string' && rule.maxLen && val.length > rule.maxLen) {
          typeErrors++
          if (typeErrors <= 5) {
            issues.push({
              file: fileName,
              type: 'VALUE_TOO_LONG',
              row: i + 1,
              col: idx,
              message: `Row ${i + 1} col ${idx} value too long (${val.length} > ${rule.maxLen})`,
            })
          }
        }

        if (val && rule.type === 'integer' && rule.min !== undefined) {
          const num = parseInt(val)
          if (num < rule.min || num > rule.max!) {
            typeErrors++
            if (typeErrors <= 5) {
              issues.push({
                file: fileName,
                type: 'OUT_OF_RANGE',
                row: i + 1,
                col: idx,
                message: `Row ${i + 1} col ${idx} value ${num} not in range ${rule.min}–${rule.max}`,
              })
            }
          }
        }
      }
    }
  }

  return issues
}
