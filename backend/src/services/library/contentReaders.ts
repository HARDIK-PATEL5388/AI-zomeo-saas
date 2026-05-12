/*
 * Pluggable content-reader registry for the library reader.
 *
 * The library route stores chapter *metadata* in the DB and resolves *content*
 * through a format-keyed reader. This file owns the interface and the registry.
 *
 * Today only one reader is registered (`mat`) — it returns a clear placeholder
 * because the legacy .mat file cipher hasn't been decoded yet. When a decoder
 * is implemented, it ships as a new reader and replaces the placeholder via
 * `registerReader('mat', realMatReader)` — no schema changes, no route changes,
 * no frontend changes.
 */
import { existsSync, openSync, fstatSync, readSync, closeSync } from 'node:fs'
import { resolve } from 'node:path'

export interface ChapterRef {
  /** Book filesystem code, e.g. 'Blackie'. Lower-cased before path resolution. */
  fsCode: string
  /** Byte offset into the content file where this chapter begins. */
  fileOffset: number
  /** Byte offset where the NEXT chapter begins. Use Infinity for "to EOF". */
  nextFileOffset: number
  /** Chapter display name (e.g. 'Ars'). Useful for error messages. */
  chapterName: string
}

export interface BookContentReader {
  /** Format key, e.g. 'mat'. Must match the format string passed to `read()`. */
  readonly format: string
  /**
   * Return the chapter body as a single string. Implementations should NEVER
   * throw for "data missing" cases — return a clear placeholder string
   * instead, so the UI always renders something readable.
   */
  read(ref: ChapterRef): Promise<string>
}

const REGISTRY = new Map<string, BookContentReader>()

export function registerReader(reader: BookContentReader): void {
  REGISTRY.set(reader.format, reader)
}

export function getReader(format: string): BookContentReader | undefined {
  return REGISTRY.get(format)
}

/**
 * Locate the legacy Books/ folder. Override with env BOOKS_DIR for tests
 * or alternate deploys. Default: <repoRoot>/Books.
 */
function booksDir(): string {
  if (process.env.BOOKS_DIR) return process.env.BOOKS_DIR
  // backend/src/services/library/ -> backend/src/services -> backend/src -> backend -> repoRoot
  return resolve(__dirname, '../../../../Books')
}

/**
 * Resolve the on-disk path for a book's .mat file.
 * fs_code is case-mixed in the seed ('Blackie'); the legacy filenames are
 * always lowercase ('blackie.mat'). Returns null if no file exists.
 */
export function resolveMatPath(fsCode: string): string | null {
  if (!fsCode) return null
  const lower = fsCode.toLowerCase()
  const path = resolve(booksDir(), `${lower}.mat`)
  return existsSync(path) ? path : null
}

/**
 * Resolve the on-disk path for a book's .ndx (offset-translation) file.
 */
function resolveNdxPath(fsCode: string): string | null {
  if (!fsCode) return null
  const lower = fsCode.toLowerCase()
  const path = resolve(booksDir(), `${lower}.ndx`)
  return existsSync(path) ? path : null
}

/**
 * Decrypt one byte of a legacy .mat buffer.
 *
 * Ported verbatim from the legacy native addon at
 * F:\MiteshPC\HompathLatestCode\HompathElectron\Core\DataAccessLayer\FileRead.cpp,
 * line 821-825:
 *
 *   buffer[i] = (((((buffer[i] ^ 'G') + 12) ^ 'P') + 40) ^ '2') - 10;
 *
 * C arithmetic on `char` is signed but truncates on assignment; we keep every
 * intermediate masked to 8 bits, which matches the C behaviour exactly.
 */
function decryptByte(b: number): number {
  let v = (b ^ 0x47) & 0xff       // ^ 'G'
  v = (v + 12) & 0xff
  v = (v ^ 0x50) & 0xff           // ^ 'P'
  v = (v + 40) & 0xff
  v = (v ^ 0x32) & 0xff           // ^ '2'
  v = (v - 10) & 0xff
  return v
}

/**
 * Read a 32-bit little-endian unsigned int from `path` at `byteOffset`.
 * Used to translate the stored chapter offset into the real byte position
 * inside the .mat file (the legacy app does the same in
 * FileRead::getIndexFromNDX).
 */
function readUInt32LEAt(path: string, byteOffset: number): number {
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(4)
    readSync(fd, buf, 0, 4, byteOffset)
    return buf.readUInt32LE(0)
  } finally {
    closeSync(fd)
  }
}

// ------------------------------------------------------------------
// Real .mat reader — ports the legacy native-addon pipeline.
// ------------------------------------------------------------------
// Pipeline (from Core/DataAccessLayer/DataRead.cpp::getDataFromLibraryOfBookInChapter):
//   1. Translate stored chapter offset → real mat byte position via .ndx
//      (4-byte LE int at that offset in .ndx).
//   2. Same translation for the next chapter's stored offset, giving the
//      end of the slice. Missing/zero next-offset means "read to EOF".
//   3. Read mat[currentIndex .. nextIndex] raw bytes.
//   4. Apply per-byte decrypt (see decryptByte).
//
// Decoded content uses the legacy delimiters:
//   `$ <Title> [<Code>]`  — chapter header
//   `#<Heading>`          — section header
//   blank line            — paragraph break
class MatReader implements BookContentReader {
  readonly format = 'mat'

  async read(ref: ChapterRef): Promise<string> {
    const matPath = resolveMatPath(ref.fsCode)
    const ndxPath = resolveNdxPath(ref.fsCode)
    if (!matPath || !ndxPath) {
      return `[Content unavailable: source file not found for '${ref.fsCode}']`
    }

    // 1+2. Translate offsets via .ndx
    const currentIndex = readUInt32LEAt(ndxPath, ref.fileOffset)
    let nextIndex = 0
    if (Number.isFinite(ref.nextFileOffset)) {
      nextIndex = readUInt32LEAt(ndxPath, ref.nextFileOffset)
    }

    // 3. Read mat slice
    const matFd = openSync(matPath, 'r')
    try {
      const fileLength = fstatSync(matFd).size
      const length =
        nextIndex > 0 && nextIndex <= fileLength
          ? nextIndex - currentIndex
          : fileLength - currentIndex
      if (length <= 0) return ''
      const buf = Buffer.alloc(length)
      readSync(matFd, buf, 0, length, currentIndex)

      // 4. Decrypt in place
      for (let i = 0; i < length; i++) buf[i] = decryptByte(buf[i])

      return buf.toString('utf8')
    } finally {
      closeSync(matFd)
    }
  }
}

registerReader(new MatReader())
