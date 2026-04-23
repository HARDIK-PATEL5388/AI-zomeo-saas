// Zomeo.ai — TAB File Parser
// Parses Windows-1252 encoded TAB-delimited files from Complete Repertory

import iconv from 'iconv-lite'

/**
 * Parse a TAB file buffer into rows.
 * Complete Repertory files are Windows-1252 encoded with \t delimiters.
 */
export function parseTabBuffer(buffer: Buffer): string[][] {
  const text = iconv.decode(buffer, 'win1252')
  return text
    .split(/\r\n|\r|\n/)
    .filter(line => line.length > 0)
    .map(line => line.split('\t'))
}

/** Safe column accessor — never throws on missing columns. */
export function col(row: string[], idx: number, fallback = ''): string {
  return row[idx]?.trim() ?? fallback
}

/** Safe integer column accessor. */
export function colInt(row: string[], idx: number, fallback = 0): number {
  const v = parseInt(row[idx]?.trim() ?? '')
  return isNaN(v) ? fallback : v
}

/** Chunk an array into batches. */
export function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size))
  }
  return result
}
