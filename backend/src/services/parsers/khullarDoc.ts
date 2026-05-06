// Khullar parser — binary Word .doc condition files (one .doc per condition,
// 93 total). The source ships as legacy MS Word 97–2003 documents in
// `oldandnew/Khullar/Repertory/Repertory/`; we read them directly with the
// `word-extractor` library (pure JS, no Office dependency).
//
// ─── Source grammar (after word-extractor) ─────────────────────────────────
// Each condition file has an optional intro paragraph, then a flat stream of
// "section markers" + rubric titles + remedy lines:
//
//     ACNE :[BACK] :                  ← section marker (level-2 rubric "BACK")
//     Acne :                          ← rubric title — chapter prefix only
//     Carb-v., Nit-ac., Rumx., Sulph. ← remedies attach to the section
//
//     ACNE :[CLINICAL] :              ← section "CLINICAL"
//     Acne, rosacea :                 ← level-3 rubric "rosacea"
//     CALC-SIL., CARB-V., CAUST., LACH., PSOR., RHUS-T.   ← UPPER = grade 3
//     Acne, rosacea, bluish :         ← level-4 (prefix-matches "Acne, rosacea")
//     Lach., Sulph.                   ← Title case = grade 2
//     Acne, rosacea, groups, in :     ← level-4, label "groups, in"
//     CAUST.
//
// Hierarchy is rebuilt by **prefix-matching** each rubric's title against the
// rubric stack. A new title that starts with `<previous>, ` becomes a child
// of `<previous>`; otherwise we pop the stack until we find a prefix-match (or
// fall back to the section as parent). Display label is the suffix after the
// matched parent's title + `, ` (so `Acne, rosacea, bluish` displays as
// "bluish" under "rosacea").
//
// Grade encoding via case (the original print typography is bold/italic;
// word-extractor strips formatting, but case in the source survives):
//   - All-uppercase abbreviation (e.g. `CARB-V.`)  → grade 3
//   - Title case             (e.g. `Carb-v.`)      → grade 2  (default)
//   - all-lowercase          (e.g. `carb-v.`)      → grade 1  (rare)
//
// Each file maps to a single `rep_book_chapters` row; rubrics go into
// `rep_rubrics` with deterministic ext_ids (`chapterIndex * 1_000_000 + n`),
// remedies are looked up by canonical abbreviation in the shared
// `rep_remedies` table (Khullar's `Sulph` reuses Complete's `sulph.` rem_code).

// word-extractor does not ship TypeScript types.
// @ts-expect-error — no .d.ts, runtime API: new WordExtractor().extract(buf|path).getBody()
import WordExtractor from 'word-extractor'
import type { Pool, PoolClient } from 'pg'
import { chunk } from '../tabParser'
import type {
  RepertoryParser, ValidationResult, ValidationIssue,
  FilePreview, ParserContext, FileSpec,
} from './parser.types'

// ─── Chapter contract ──────────────────────────────────────────────────────
// Filename is the contract — the wizard / orchestrator uses .name as the key
// in the form-data Map. .index drives sort_order and ext_id allocation.
// .chapter is the display name written into rep_book_chapters.name and shown
// in the browser tree. The 93 entries below match the legacy Zomeo screenshot's
// "Khullar (93)" alphabetical condition list.
//
// Filenames mirror the source `.doc` basenames verbatim. Display names
// normalise the typos (Cystits → Cystitis, Denttion → Dentition, Menses
// Irregula → Menses Irregular, Gatro Enteritis → Gastro Enteritis,
// HEPATITISLever → Hepatitis (Liver)).
const CHAPTER_FILES: Array<{ index: number; name: string; chapter: string }> = [
  { index:  1, name: 'Acne.doc',                          chapter: 'Acne' },
  { index:  2, name: 'ADENOIDS.doc',                      chapter: 'Adenoids' },
  { index:  3, name: 'ALBUMINURIA.doc',                   chapter: 'Albuminuria' },
  { index:  4, name: 'ANAEMIA.doc',                       chapter: 'Anaemia' },
  { index:  5, name: 'ANGINA.doc',                        chapter: 'Angina' },
  { index:  6, name: 'Aphthous Ulcer Mouth.doc',          chapter: 'Aphthous Ulcer Mouth' },
  { index:  7, name: 'APPETITE LOSS OF.doc',              chapter: 'Appetite Loss Of' },
  { index:  8, name: 'BALDNESS.doc',                      chapter: 'Baldness' },
  { index:  9, name: 'BED WETTING .doc',                  chapter: 'Bed Wetting' },
  { index: 10, name: 'Bronchitis.doc',                    chapter: 'Bronchitis' },
  { index: 11, name: 'CHILBLAINS.doc',                    chapter: 'Chilblains' },
  { index: 12, name: 'CHOLECYSTITIS.doc',                 chapter: 'Cholecystitis' },
  { index: 13, name: 'CIRRHOSIS.doc',                     chapter: 'Cirrhosis' },
  { index: 14, name: 'Cold catarrh & cough catarrh.doc',  chapter: 'Cold Catarrh & Cough' },
  { index: 15, name: 'Colds Tendency.doc',                chapter: 'Colds Tendency' },
  { index: 16, name: 'CONCENTRATION.doc',                 chapter: 'Concentration' },
  { index: 17, name: 'CONJUNCTIVITIS.doc',                chapter: 'Conjunctivitis' },
  { index: 18, name: 'corns.doc',                         chapter: 'Corns' },
  { index: 19, name: 'Cough Lying While.doc',             chapter: 'Cough Lying While' },
  { index: 20, name: 'cough suffocative.doc',             chapter: 'Cough Suffocative' },
  { index: 21, name: 'CROUP.doc',                         chapter: 'Croup' },
  { index: 22, name: 'CYSTITS.DOC',                       chapter: 'Cystitis' },
  { index: 23, name: 'Dandruff.doc',                      chapter: 'Dandruff' },
  { index: 24, name: 'DEAFNESS.doc',                      chapter: 'Deafness' },
  { index: 25, name: 'Denttion.DOC',                      chapter: 'Dentition' },
  { index: 26, name: 'Discolouration Black.doc',          chapter: 'Discolouration Black' },
  { index: 27, name: 'Discolouration Brown .doc',         chapter: 'Discolouration Brown' },
  { index: 28, name: 'Discolouration White .doc',         chapter: 'Discolouration White' },
  { index: 29, name: 'DYSENTRY.doc',                      chapter: 'Dysentery' },
  { index: 30, name: 'DYSMENORRHOEA .doc',                chapter: 'Dysmenorrhoea' },
  { index: 31, name: 'Dyspepsia .doc',                    chapter: 'Dyspepsia' },
  { index: 32, name: 'Enteritis.doc',                     chapter: 'Enteritis' },
  { index: 33, name: 'enuresis.doc',                      chapter: 'Enuresis' },
  { index: 34, name: 'erysipelas.doc',                    chapter: 'Erysipelas' },
  { index: 35, name: 'Exhaustion.doc',                    chapter: 'Exhaustion' },
  { index: 36, name: 'FEELING AS IF.doc',                 chapter: 'Feeling As If' },
  { index: 37, name: 'FISSURE.doc',                       chapter: 'Fissure' },
  { index: 38, name: 'Food poisoning.doc',                chapter: 'Food Poisoning' },
  { index: 39, name: 'Gatro Enteritis.doc',               chapter: 'Gastro Enteritis' },
  { index: 40, name: 'HEPATITISLever.doc',                chapter: 'Hepatitis (Liver)' },
  { index: 41, name: 'Hernia.doc',                        chapter: 'Hernia' },
  { index: 42, name: 'Herpes Zoster.doc',                 chapter: 'Herpes Zoster' },
  { index: 43, name: 'HOARSE VOICE.doc',                  chapter: 'Hoarse Voice' },
  { index: 44, name: 'HYDROCELE.doc',                     chapter: 'Hydrocele' },
  { index: 45, name: 'Impotency.doc',                     chapter: 'Impotency' },
  { index: 46, name: 'Indigestion.doc',                   chapter: 'Indigestion' },
  { index: 47, name: 'INFLUENZA.doc',                     chapter: 'Influenza' },
  { index: 48, name: 'Laryngitis.doc',                    chapter: 'Laryngitis' },
  { index: 49, name: 'Menses Frequent.doc',               chapter: 'Menses Frequent' },
  { index: 50, name: 'Menses Irregula.doc',               chapter: 'Menses Irregular' },
  { index: 51, name: 'Menses Painful.doc',                chapter: 'Menses Painful' },
  { index: 52, name: 'Menses Profuse.doc',                chapter: 'Menses Profuse' },
  { index: 53, name: 'Menses Scanty.doc',                 chapter: 'Menses Scanty' },
  { index: 54, name: 'Menses Suppressed.doc',             chapter: 'Menses Suppressed' },
  { index: 55, name: 'MOUTH ULCER.doc',                   chapter: 'Mouth Ulcer' },
  { index: 56, name: 'Nasal Polyp.doc',                   chapter: 'Nasal Polyp' },
  { index: 57, name: 'Nervous Weakness.doc',              chapter: 'Nervous Weakness' },
  { index: 58, name: 'Obesity.doc',                       chapter: 'Obesity' },
  { index: 59, name: 'Obstinate.doc',                     chapter: 'Obstinate' },
  { index: 60, name: 'ONYCHIA.doc',                       chapter: 'Onychia' },
  { index: 61, name: 'ORCHITIS.doc',                      chapter: 'Orchitis' },
  { index: 62, name: 'Pharyngitis.doc',                   chapter: 'Pharyngitis' },
  { index: 63, name: 'PNEUMONIA.doc',                     chapter: 'Pneumonia' },
  { index: 64, name: 'Prophylactic.doc',                  chapter: 'Prophylactic' },
  { index: 65, name: 'Prostatitis.doc',                   chapter: 'Prostatitis' },
  { index: 66, name: 'Psoriasis.doc',                     chapter: 'Psoriasis' },
  { index: 67, name: 'Pulmonary Infections.doc',          chapter: 'Pulmonary Infections' },
  { index: 68, name: 'Purpura .doc',                      chapter: 'Purpura' },
  { index: 69, name: 'Sacral region.doc',                 chapter: 'Sacral Region' },
  { index: 70, name: 'Scabies.doc',                       chapter: 'Scabies' },
  { index: 71, name: 'Scurvy.doc',                        chapter: 'Scurvy' },
  { index: 72, name: 'Sensation as if.doc',               chapter: 'Sensation As If' },
  { index: 73, name: 'SEPTICEMIA.doc',                    chapter: 'Septicemia' },
  { index: 74, name: 'sinusitis.doc',                     chapter: 'Sinusitis' },
  { index: 75, name: 'SoreThroat.doc',                    chapter: 'Sore Throat' },
  { index: 76, name: 'Stroke.doc',                        chapter: 'Stroke' },
  { index: 77, name: 'Study.doc',                         chapter: 'Study' },
  { index: 78, name: 'Styes.doc',                         chapter: 'Styes' },
  { index: 79, name: 'Sun Stroke.doc',                    chapter: 'Sun Stroke' },
  { index: 80, name: 'Swallowing Difficult.doc',          chapter: 'Swallowing Difficult' },
  { index: 81, name: 'TEETHING.doc',                      chapter: 'Teething' },
  { index: 82, name: 'Tired.doc',                         chapter: 'Tired' },
  { index: 83, name: 'Toothache.doc',                     chapter: 'Toothache' },
  { index: 84, name: 'Tuberculosis.doc',                  chapter: 'Tuberculosis' },
  { index: 85, name: 'Tumor.doc',                         chapter: 'Tumor' },
  { index: 86, name: 'TYPHOID Fever.doc',                 chapter: 'Typhoid Fever' },
  { index: 87, name: 'Urticaria.doc',                     chapter: 'Urticaria' },
  { index: 88, name: 'Vision Weak.doc',                   chapter: 'Vision Weak' },
  { index: 89, name: 'Warts.doc',                         chapter: 'Warts' },
  { index: 90, name: 'Weariness, Exhaustion.doc',         chapter: 'Weariness, Exhaustion' },
  { index: 91, name: 'Wheezing.doc',                      chapter: 'Wheezing' },
  { index: 92, name: 'WHOOPING COUGH.doc',                chapter: 'Whooping Cough' },
  { index: 93, name: 'Worms.doc',                         chapter: 'Worms' },
]

// Match files case-insensitively — the shipped folder mixes `.DOC` with `.doc`.
const FILE_BY_NAME = new Map(CHAPTER_FILES.map(f => [f.name.toLowerCase(), f]))
function findChapter(fileName: string) {
  return FILE_BY_NAME.get(fileName.toLowerCase()) ?? null
}

const FILE_SPECS: FileSpec[] = CHAPTER_FILES.map(f => ({
  name: f.name,
  required: false,
  minColumns: 1,
  description: `Chapter ${f.index}: ${f.chapter}`,
}))

const IMPORT_ORDER = CHAPTER_FILES.map(f => f.name)

// Each chapter owns ext_id range [index*1M+1, (index+1)*1M).
const EXT_ID_BLOCK = 1_000_000

// ─── word-extractor wrapper ────────────────────────────────────────────────
// word-extractor accepts a Buffer in newer versions; if it ever rejects it on
// type alone, we'll fall back to writing a temp file. The .doc files are
// small (≤200 KB on average) so in-memory is fine.
async function extractDocText(buf: Buffer): Promise<string> {
  const x = new WordExtractor()
  const doc = await x.extract(buf)
  // Returns paragraphs separated by `\r` (or sometimes `\r\n`).
  return String(doc.getBody() ?? '')
}

// ─── Grammar ───────────────────────────────────────────────────────────────
// Section header: `ACNE :[BACK] :` with tolerated whitespace variations.
// Captures group 1 = section name. The leading chapter portion accepts commas
// because some Khullar chapters have compound names — e.g. `TYPHOID, FEVER
// :[BACK] :` for the Typhoid Fever chapter.
const SECTION_RE = /^\s*[A-Z][A-Z0-9 ,.'\-]*?\s*:?\s*\[\s*([A-Z0-9][A-Z0-9 \-&]*?[A-Z0-9])\s*\]\s*:?\s*$/

// A single remedy abbreviation with optional trailing periods.
// Matches: `Carb-v.` `CALC-SIL.` `Sulph` `Nat-m.` `Sin-a.` etc.
const REMEDY_TOKEN_RE = /^[A-Za-z][A-Za-z0-9\-]*\.?\.?$/

interface ParsedRubric {
  extId: number
  parentExtId: number | null
  depth: number
  title: string         // display label (suffix relative to parent)
  fullTitle: string     // full path used for prefix-matching child rubrics
  fullPath: string      // chapter > section > ... > title  (browser-friendly)
  remedies: Array<{ grade: number; abbrev: string }>
}
interface ChapterParsed {
  rubrics: ParsedRubric[]
  abbrevs: Set<string>
}

// Strip noise that word-extractor sometimes leaves at line edges.
function cleanLine(s: string): string {
  return s.replace(/ /g, '').replace(/\s+/g, ' ').trim()
}

// Detect a section header line.
function matchSection(line: string): string | null {
  const m = SECTION_RE.exec(line)
  if (!m) return null
  // Normalise the section name to Title Case for display
  const raw = m[1].trim()
  return raw.split(/\s+/).map(w =>
    w.length === 0 ? w :
    w.split('-').map(p => p.charAt(0) + p.slice(1).toLowerCase()).join('-')
  ).join(' ')
}

// A rubric title line ends with `:` and is not a section marker.
// Some rubric lines also end with `.:` (e.g. `agg.:`) so we accept that too.
function isRubricTitle(line: string): boolean {
  return /:\s*$/.test(line) || /\.\s*:\s*$/.test(line)
}
function stripRubricColon(line: string): string {
  return line.replace(/\s*:\s*$/, '').trim()
}

// A remedy line is a sequence of comma-separated remedy tokens.
// We detect by: split on commas, ≥1 token must look like a remedy abbrev.
function matchRemedies(line: string): Array<{ grade: number; abbrev: string }> {
  const parts = line.split(/,/).map(s => s.trim()).filter(Boolean)
  const out: Array<{ grade: number; abbrev: string }> = []
  for (const part of parts) {
    if (!REMEDY_TOKEN_RE.test(part)) continue
    const cleaned = part.replace(/\.+$/, '')
    if (!cleaned) continue
    out.push({ grade: classifyGrade(cleaned), abbrev: cleaned })
  }
  return out
}

// Grade derived from case in the source. UPPER = bolder = grade 3,
// Title case = grade 2 (default), lowercase = grade 1.
function classifyGrade(token: string): number {
  // Strip the optional dash-suffix portion and look at letters.
  const letters = token.replace(/[^A-Za-z]/g, '')
  if (!letters) return 1
  if (letters === letters.toUpperCase()) return 3
  if (letters === letters.toLowerCase()) return 1
  return 2
}

function canonAbbrev(raw: string): string {
  return (raw ?? '').toLowerCase().trim().replace(/\.+$/, '')
}

// Normalise a rubric title's comma-segments into a clean breadcrumb relative
// to its section. The source uses four idiosyncratic conventions:
//
//  1. **Leading chapter prefix.** Most rubrics start with the chapter name:
//       `Acne, rosacea, bluish`            → segs after "Acne" = ["rosacea", "bluish"]
//
//  2. **Bare chapter as path-reset (only when prefixed).** When the chapter
//     name appears AGAIN as a standalone segment after the leading prefix has
//     been consumed, the segments AFTER it form a NEW path that is a sibling
//     of the previous rubric (not a child):
//       `Acne, rosacea, acne, vulgaris`    → effective segs = ["vulgaris"]
//     The "only-when-prefixed" guard prevents `Eruptions, pimples, acne` (no
//     leading "Acne, ") from collapsing to an empty breadcrumb just because
//     the word "acne" is in the rubric label.
//
//  3. **Compound chapter refs.** Some segments are `<chapter> <noun>` (space,
//     not comma) abbreviating a known rubric; strip the chapter prefix:
//       `Acne rosacea, acne vulgaris, chin` → after compound-strip = ["rosacea", "vulgaris", "chin"]
//
//  4. **Leading section-name redundancy.** After the chapter prefix, the
//     source often re-states the section as the first segment:
//       `Acne, face, alcoholics, in`       (under [FACE]) → ["alcoholics", "in"]
//     If the segment equals the active section name, drop it. (Without this,
//     every face-section rubric would be parented under a redundant "face"
//     rubric one level deeper than the screenshot shows.)
function normaliseBreadcrumb(titleNorm: string, chapter: string, sectionName: string | null): string[] {
  const chLc = chapter.toLowerCase()
  // Chapter words — for multi-word chapters ("Typhoid Fever") the source uses
  // either a single combined segment ("Typhoid fever") OR multiple comma-
  // separated segments ("Typhoid, fever"). Both must be recognised as the
  // chapter prefix.
  const chWords = chLc.split(/\s+/).filter(s => s.length > 0)
  const chJoined = chWords.join(' ')   // "typhoid fever"

  let segs = titleNorm.split(',').map(s => s.trim()).filter(s => s.length > 0)

  // (1) + (2): only if the title actually starts with the chapter name.
  let consumedLeadingChapter = false

  // Try multi-segment match first ("Typhoid, fever" = chWords).
  if (chWords.length >= 2 && segs.length >= chWords.length) {
    let match = true
    for (let i = 0; i < chWords.length; i++) {
      if (segs[i].toLowerCase().replace(/\.$/, '') !== chWords[i]) { match = false; break }
    }
    if (match) {
      segs = segs.slice(chWords.length)
      consumedLeadingChapter = true
    }
  }

  // Single-segment / compound match.
  if (!consumedLeadingChapter && segs.length > 0) {
    const firstLc = segs[0].toLowerCase().replace(/\.$/, '')
    if (firstLc === chJoined) {
      segs = segs.slice(1)
      consumedLeadingChapter = true
    } else if (firstLc.startsWith(chJoined + ' ')) {
      // Compound first segment ("Acne rosacea", "Typhoid fever foo") — strip the chapter.
      segs[0] = segs[0].substring(chJoined.length + 1).trim()
      consumedLeadingChapter = true
    }
  }

  // (2) Bare-chapter path-reset (only after a leading prefix was consumed).
  // For multi-word chapters this looks for `chWords` appearing again in order.
  if (consumedLeadingChapter && chWords.length >= 1) {
    let lastResetEnd = -1   // exclusive index of segs after the last reset
    let i = 0
    while (i + chWords.length <= segs.length) {
      let match = true
      for (let j = 0; j < chWords.length; j++) {
        if (segs[i + j].toLowerCase().replace(/\.$/, '') !== chWords[j]) { match = false; break }
      }
      if (match) {
        lastResetEnd = i + chWords.length
        i += chWords.length
      } else {
        i++
      }
    }
    if (lastResetEnd > 0) segs = segs.slice(lastResetEnd)
  }

  // (4) Strip leading section-name segment if redundant.
  if (sectionName && segs.length > 0) {
    const secLc = sectionName.toLowerCase()
    const firstLc = segs[0].toLowerCase().replace(/\.$/, '')
    if (firstLc === secLc) segs = segs.slice(1)
  }

  // (3) Strip compound `<chapter> <noun>` prefix from any remaining segment.
  segs = segs.map(s => {
    const lc = s.toLowerCase()
    if (lc.startsWith(chJoined + ' ')) return s.substring(chJoined.length + 1).trim()
    return s
  }).filter(s => s.length > 0)

  return segs
}

function parseChapterText(meta: { index: number; chapter: string }, body: string): ChapterParsed {
  const rawLines = body.split(/\r\n|\r|\n/).map(cleanLine).filter(l => l.length > 0)

  const rubrics: ParsedRubric[] = []
  const abbrevs = new Set<string>()
  let n = 0

  let currentSection: ParsedRubric | null = null
  let currentRubric: ParsedRubric | null = null  // last rubric for remedy-line attachment

  // Map of existing rubrics within the current section, keyed by their
  // breadcrumb-relative-to-section (lower-cased). Rebuilt at each new section.
  let rubricByPath: Map<string, ParsedRubric> = new Map()

  let started = false

  function newRubric(depth: number, parent: ParsedRubric | null, title: string, sectionPath: string): ParsedRubric {
    n++
    const parentPath = parent ? parent.fullPath : meta.chapter
    const r: ParsedRubric = {
      extId: meta.index * EXT_ID_BLOCK + n,
      parentExtId: parent ? parent.extId : null,
      depth,
      title,
      fullTitle: sectionPath,
      fullPath: parent ? `${parentPath} > ${title}` : `${meta.chapter} > ${title}`,
      remedies: [],
    }
    rubrics.push(r)
    return r
  }

  for (const line of rawLines) {
    // Section marker?
    const section = matchSection(line)
    if (section) {
      const r = newRubric(2, null, section, '')
      currentSection = r
      currentRubric = r
      rubricByPath = new Map()
      started = true
      continue
    }
    if (!started || !currentSection) continue

    // Rubric title?
    if (isRubricTitle(line)) {
      const titleNorm = stripRubricColon(line).replace(/\s+/g, ' ').trim()
      if (!titleNorm) continue

      const segs = normaliseBreadcrumb(titleNorm, meta.chapter, currentSection?.title ?? null)
      if (segs.length === 0) {
        // Bare chapter name → remedies attach to the current section.
        currentRubric = currentSection
        continue
      }

      // Locate the deepest existing rubric whose path matches the longest
      // possible *suffix-then-prefix* of the breadcrumb. Concretely: try each
      // split point n in [segs.length-1 … 1]; the parent path is segs[0:n].
      // Within that parent path, also accept matches against any suffix
      // (handles "rosacea, vulgaris" where "vulgaris" alone is a known
      // sibling-level rubric, so the new rubric's parent is "vulgaris").
      let parent: ParsedRubric = currentSection
      let label = segs.join(', ')

      outer: for (let n = segs.length - 1; n >= 1; n--) {
        const head = segs.slice(0, n)
        for (let start = 0; start < head.length; start++) {
          const path = head.slice(start).join(', ').toLowerCase()
          const cand = rubricByPath.get(path)
          if (cand) {
            parent = cand
            label = segs.slice(n).join(', ')
            break outer
          }
        }
      }

      const sectionPath = (parent === currentSection)
        ? segs.join(', ')
        : `${parent.fullTitle}, ${label}`
      const newR = newRubric(parent.depth + 1, parent, label, sectionPath)
      rubricByPath.set(sectionPath.toLowerCase(), newR)
      currentRubric = newR
      continue
    }

    // Otherwise: candidate remedy line. Attach to currentRubric (the section
    // itself if no rubric was opened yet under it).
    if (!currentRubric) continue
    const remedies = matchRemedies(line)
    if (remedies.length === 0) continue
    currentRubric.remedies.push(...remedies)
    for (const r of remedies) {
      const k = canonAbbrev(r.abbrev)
      if (k) abbrevs.add(k)
    }
  }

  return { rubrics, abbrevs }
}

// ─── Validation ────────────────────────────────────────────────────────────
function validate(files: Map<string, Buffer>): ValidationResult {
  const issues: ValidationIssue[] = []
  let recognised = 0
  for (const [name, buf] of files) {
    if (!findChapter(name)) {
      issues.push({ file: name, problem: 'Unknown chapter file (not in Khullar 93-file contract)' })
      continue
    }
    if (buf.length === 0) {
      issues.push({ file: name, problem: 'File is empty' })
      continue
    }
    // Cheap sniff: real Word .doc files start with the OLE/CFB magic.
    const head = buf.slice(0, 8)
    const ole = head[0] === 0xD0 && head[1] === 0xCF && head[2] === 0x11 && head[3] === 0xE0
    if (!ole) {
      issues.push({ file: name, problem: 'Not a Word .doc file (missing OLE/CFB magic D0 CF 11 E0)' })
      continue
    }
    recognised++
  }
  if (recognised === 0) {
    issues.push({ file: '*', problem: 'Upload at least one Khullar condition (.doc)' })
  }
  return { ok: issues.length === 0, issues }
}

// ─── Preview ───────────────────────────────────────────────────────────────
async function preview(
  files: Map<string, Buffer>,
  bookId: number | null,
  pool: Pool,
): Promise<FilePreview[]> {
  const results: FilePreview[] = []
  for (const fileName of IMPORT_ORDER) {
    const meta = findChapter(fileName)!
    const buf = files.get(fileName) ?? files.get(fileName.toLowerCase())
    if (!buf) {
      results.push(emptyPreview(fileName))
      continue
    }
    let rubrics: ParsedRubric[] = []
    try {
      const body = await extractDocText(buf)
      rubrics = parseChapterText(meta, body).rubrics
    } catch {
      // preview is best-effort; a parse error here surfaces during import
    }
    let existing = 0
    if (bookId != null && rubrics.length > 0) {
      const r = await pool.query(
        `SELECT COUNT(*)::int AS c FROM rep_rubrics
           WHERE book_id = $1 AND ext_id BETWEEN $2 AND $3`,
        [bookId, meta.index * EXT_ID_BLOCK + 1, (meta.index + 1) * EXT_ID_BLOCK],
      )
      existing = Math.min(rubrics.length, r.rows[0].c as number)
    }
    results.push({
      file: fileName,
      totalRows: rubrics.length,
      parsedRows: rubrics.length,
      newRows: rubrics.length - existing,
      existingRows: existing,
      toUpdateRows: existing,
      unchangedRows: 0,
      skippedRows: 0,
    })
  }
  return results
}
function emptyPreview(file: string): FilePreview {
  return { file, totalRows: 0, parsedRows: 0, newRows: 0, existingRows: 0, toUpdateRows: 0, unchangedRows: 0, skippedRows: 0 }
}

// ─── Generic batched UPSERT (book-aware) ───────────────────────────────────
async function batchUpsert(
  client: PoolClient,
  table: string,
  columns: string[],
  conflictCols: string[],
  updateCols: string[],
  rows: any[][],
  batchSize = 500,
): Promise<number> {
  if (rows.length === 0) return 0
  let total = 0
  const colSql = columns.join(', ')
  const conflictSql = conflictCols.join(', ')
  const updateSql = updateCols.length
    ? updateCols.map(c => `${c}=EXCLUDED.${c}`).join(', ')
    : ''
  const onConflict = updateCols.length
    ? `ON CONFLICT (${conflictSql}) DO UPDATE SET ${updateSql}`
    : `ON CONFLICT (${conflictSql}) DO NOTHING`

  for (const batch of chunk(rows, batchSize)) {
    const params: any[] = []
    const placeholders: string[] = []
    let idx = 1
    for (const row of batch) {
      const slots: string[] = []
      for (const v of row) { params.push(v); slots.push(`$${idx++}`) }
      placeholders.push(`(${slots.join(',')})`)
    }
    const sql = `INSERT INTO ${table} (${colSql}) VALUES ${placeholders.join(',')} ${onConflict}`
    const r = await client.query(sql, params)
    total += r.rowCount ?? batch.length
  }
  return total
}

// ─── Per-file import ───────────────────────────────────────────────────────
async function importChapter(
  client: PoolClient,
  fileName: string,
  buffer: Buffer,
  ctx: ParserContext,
): Promise<{ added: number; updated: number; skipped: number }> {
  const meta = findChapter(fileName)
  if (!meta) throw new Error(`Unknown file: ${fileName}`)

  const body = await extractDocText(buffer)
  const { rubrics, abbrevs } = parseChapterText(meta, body)
  if (rubrics.length === 0) {
    return { added: 0, updated: 0, skipped: 0 }
  }

  // Chapter row (idempotent on book_id+name).
  const chRes = await client.query(
    `INSERT INTO rep_book_chapters (book_id, name, code, sort_order)
       VALUES ($1, $2, $2, $3)
     ON CONFLICT (book_id, name) DO UPDATE SET sort_order = EXCLUDED.sort_order
     RETURNING id`,
    [ctx.bookId, meta.chapter, meta.index],
  )
  const chapterId: number = chRes.rows[0].id

  // Wipe this chapter's slice so a re-import doesn't leave orphans.
  const minExt = meta.index * EXT_ID_BLOCK + 1
  const maxExt = (meta.index + 1) * EXT_ID_BLOCK - 1
  await client.query(
    `DELETE FROM rep_rubric_remedies
       WHERE book_id = $1 AND rubric_ext_id BETWEEN $2 AND $3`,
    [ctx.bookId, minExt, maxExt],
  )
  await client.query(
    `DELETE FROM rep_rubrics
       WHERE book_id = $1 AND ext_id BETWEEN $2 AND $3`,
    [ctx.bookId, minExt, maxExt],
  )

  // Resolve rep_remedies rem_codes (canonical-abbrev lookup, shared with
  // Complete + Jeremy + Murphy).
  const existingRem = new Map<string, number>()
  {
    const r = await client.query(
      `SELECT rem_code, abbreviation FROM rep_remedies WHERE abbreviation IS NOT NULL ORDER BY rem_code`,
    )
    for (const row of r.rows) {
      const key = canonAbbrev(String(row.abbreviation))
      if (key && !existingRem.has(key)) existingRem.set(key, row.rem_code as number)
    }
  }
  const newAbbrevs: string[] = []
  for (const a of abbrevs) {
    if (!existingRem.has(a)) newAbbrevs.push(a)
  }
  if (newAbbrevs.length > 0) {
    const maxRes = await client.query(
      `SELECT COALESCE(MAX(rem_code), 0) AS m FROM rep_remedies`,
    )
    let next = (maxRes.rows[0].m as number) + 1
    const insertRows: any[][] = []
    for (const a of newAbbrevs) {
      insertRows.push([next, a, a, null])
      existingRem.set(a, next)
      next++
    }
    await batchUpsert(
      client,
      'rep_remedies',
      ['rem_code', 'abbreviation', 'full_name', 'common_name'],
      ['rem_code'],
      ['abbreviation', 'full_name', 'common_name', 'updated_at'],
      insertRows,
      500,
    )
  }

  // Insert rubrics.
  const rubricRows: any[][] = rubrics.map(r => [
    ctx.bookId, r.extId, r.parentExtId, r.depth, chapterId, meta.chapter, r.title, r.fullPath,
  ])
  const addedRubrics = await batchUpsert(
    client,
    'rep_rubrics',
    ['book_id', 'ext_id', 'parent_ext_id', 'depth', 'chapter_id', 'chapter', 'rubric_text', 'full_path'],
    ['book_id', 'ext_id'],
    ['parent_ext_id', 'depth', 'chapter_id', 'chapter', 'rubric_text', 'full_path', 'updated_at'],
    rubricRows,
    500,
  )

  // Build rubric_remedies, deduped per (rubric, rem_code) keeping max grade.
  const dedup = new Map<string, { extId: number; remCode: number; grade: number }>()
  let skipped = 0
  for (const ru of rubrics) {
    for (const r of ru.remedies) {
      const code = existingRem.get(canonAbbrev(r.abbrev))
      if (!code) { skipped++; continue }
      const grade = Math.min(4, Math.max(1, r.grade || 1))
      const key = `${ru.extId}|${code}`
      const prev = dedup.get(key)
      if (!prev || grade > prev.grade) {
        dedup.set(key, { extId: ru.extId, remCode: code, grade })
      }
    }
  }
  const rrRows: any[][] = []
  for (const v of dedup.values()) {
    rrRows.push([ctx.bookId, v.extId, v.remCode, v.grade])
  }
  const addedRR = await batchUpsert(
    client,
    'rep_rubric_remedies',
    ['book_id', 'rubric_ext_id', 'rem_code', 'grade'],
    ['book_id', 'rubric_ext_id', 'rem_code'],
    ['grade'],
    rrRows,
    2000,
  )

  return { added: addedRubrics + addedRR, updated: 0, skipped }
}

// ─── Per-file dispatch ─────────────────────────────────────────────────────
async function importFile(
  client: PoolClient,
  fileName: string,
  buffer: Buffer,
  ctx: ParserContext,
): Promise<{ added: number; updated: number; skipped: number }> {
  if (!findChapter(fileName)) throw new Error(`Unknown file: ${fileName}`)
  return importChapter(client, fileName, buffer, ctx)
}

// ─── Parser export ────────────────────────────────────────────────────────
export const khullarDocParser: RepertoryParser = {
  id: 'khullar_doc',
  name: 'Khullar (Quick Prescriber DOC)',
  description: 'Khullar Homeopathic Quick Prescriber — 93 condition .doc files (read directly via word-extractor)',
  fileSpec: FILE_SPECS,
  importOrder: IMPORT_ORDER,
  validate,
  preview,
  importFile,
}
