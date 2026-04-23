// backend/src/services/dataImporter.ts
/**
 * Repertory Data Import Pipeline
 * 
 * Supports importing from various formats:
 * - CSV (standard format)
 * - JSON (nested structure)
 * - RadarOphelia compatible XML
 * 
 * Pipeline:
 * Raw File → Parser → Normalizer → Validator → DB Upsert
 */

import { db, sql } from '../db/client'
import * as fs from 'fs/promises'
import * as path from 'path'
import { parse } from 'csv-parse/sync'

export interface RawRubric {
  chapter: string
  path: string[]       // e.g. ['Fear', 'Death']
  remedies: Array<{
    abbreviation: string
    grade: 1 | 2 | 3 | 4
  }>
}

export interface ImportStats {
  chapters: number
  rubrics_inserted: number
  rubrics_updated: number
  remedies_inserted: number
  relationships_inserted: number
  errors: string[]
  duration_ms: number
}

export class RepertoryImporter {
  private sourceId: string
  private versionId: string
  private stats: ImportStats = {
    chapters: 0,
    rubrics_inserted: 0,
    rubrics_updated: 0,
    remedies_inserted: 0,
    relationships_inserted: 0,
    errors: [],
    duration_ms: 0,
  }

  constructor(sourceId: string, versionId: string) {
    this.sourceId = sourceId
    this.versionId = versionId
  }

  /**
   * Main import entry point
   */
  async importFromCSV(filePath: string): Promise<ImportStats> {
    const start = Date.now()
    console.log(`Starting import from: ${filePath}`)

    try {
      const content = await fs.readFile(filePath, 'utf-8')
      const rows = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      })

      await this.processRows(rows)
    } catch (err) {
      this.stats.errors.push(`File error: ${err}`)
    }

    this.stats.duration_ms = Date.now() - start
    console.log('Import complete:', this.stats)
    return this.stats
  }

  /**
   * Import from JSON format (nested tree)
   * Expected format: { chapter: string, rubrics: RubricNode[] }
   */
  async importFromJSON(data: ChapterData[]): Promise<ImportStats> {
    const start = Date.now()

    for (const chapter of data) {
      await this.processChapter(chapter)
    }

    // Update rubric remedy_count denormalized field
    await this.updateRemedyCounts()

    this.stats.duration_ms = Date.now() - start
    return this.stats
  }

  private async processRows(rows: Record<string, string>[]) {
    // Expected CSV columns: chapter, rubric_path, remedy_abbr, grade
    // Example: "Mind","Fear>Death","Acon",4

    const chapterCache = new Map<string, string>()
    const rubricCache = new Map<string, string>()
    const remedyCache = new Map<string, string>()

    // Load existing chapters
    const existingChapters = await db
      .selectFrom('chapters')
      .select(['id', 'name'])
      .where('source_id', '=', this.sourceId)
      .execute()

    for (const ch of existingChapters) {
      chapterCache.set(ch.name.toLowerCase(), ch.id)
    }

    // Load existing remedies
    const existingRemedies = await db
      .selectFrom('remedies')
      .select(['id', 'abbreviation'])
      .execute()

    for (const r of existingRemedies) {
      remedyCache.set(r.abbreviation.toLowerCase(), r.id)
    }

    // Process in batches for performance
    const BATCH_SIZE = 500
    const relationshipBatch: Array<{
      rubric_id: string
      remedy_id: string
      grade: number
      source_id: string
      version_id: string
    }> = []

    for (const row of rows) {
      try {
        const chapterName = row.chapter?.trim()
        const rubricPath = row.rubric_path?.split('>').map((s: string) => s.trim())
        const remedyAbbr = row.remedy_abbr?.trim()
        const grade = parseInt(row.grade) as 1 | 2 | 3 | 4

        if (!chapterName || !rubricPath || !remedyAbbr || isNaN(grade)) {
          this.stats.errors.push(`Invalid row: ${JSON.stringify(row)}`)
          continue
        }

        // Get/create chapter
        let chapterId = chapterCache.get(chapterName.toLowerCase())
        if (!chapterId) {
          const ch = await db
            .insertInto('chapters')
            .values({
              source_id: this.sourceId,
              code: chapterName.substring(0, 5).toUpperCase(),
              slug: chapterName.toLowerCase().replace(/\s+/g, '-'),
              name: chapterName,
            })
            .onConflict((oc) => oc.columns(['source_id', 'code']).doNothing())
            .returning(['id'])
            .executeTakeFirst()

          if (ch) {
            chapterId = ch.id
            chapterCache.set(chapterName.toLowerCase(), chapterId)
            this.stats.chapters++
          }
        }

        if (!chapterId) continue

        // Get/create rubric (traverse/build tree)
        const rubricId = await this.getOrCreateRubric(
          rubricPath, chapterId, rubricCache
        )

        // Get/create remedy
        let remedyId = remedyCache.get(remedyAbbr.toLowerCase())
        if (!remedyId) {
          const rem = await db
            .insertInto('remedies')
            .values({
              name: remedyAbbr, // Will be updated with full name later
              abbreviation: remedyAbbr,
            })
            .onConflict((oc) => oc.column('abbreviation').doNothing())
            .returning(['id'])
            .executeTakeFirst()

          if (rem) {
            remedyId = rem.id
            remedyCache.set(remedyAbbr.toLowerCase(), remedyId)
            this.stats.remedies_inserted++
          }
        }

        if (!remedyId) continue

        // Queue relationship
        relationshipBatch.push({
          rubric_id: rubricId,
          remedy_id: remedyId,
          grade,
          source_id: this.sourceId,
          version_id: this.versionId,
        })

        // Flush batch
        if (relationshipBatch.length >= BATCH_SIZE) {
          await this.flushRelationships(relationshipBatch)
          relationshipBatch.length = 0
        }
      } catch (err) {
        this.stats.errors.push(`Row error: ${err}`)
      }
    }

    // Flush remaining
    if (relationshipBatch.length > 0) {
      await this.flushRelationships(relationshipBatch)
    }
  }

  private async getOrCreateRubric(
    pathParts: string[],
    chapterId: string,
    cache: Map<string, string>
  ): Promise<string> {
    let parentId: string | null = null
    let rubricId = ''

    for (let i = 0; i < pathParts.length; i++) {
      const name = pathParts[i]
      const cacheKey = `${chapterId}:${pathParts.slice(0, i + 1).join('>')}`

      if (cache.has(cacheKey)) {
        rubricId = cache.get(cacheKey)!
        parentId = rubricId
        continue
      }

      const fullPath = pathParts.slice(0, i + 1).join(' > ')
      const existing = await db
        .selectFrom('rubrics')
        .select(['id'])
        .where('chapter_id', '=', chapterId)
        .where('source_id', '=', this.sourceId)
        .where('parent_id', parentId ? '=' : 'is', parentId)
        .where('name', '=', name)
        .executeTakeFirst()

      if (existing) {
        rubricId = existing.id
        this.stats.rubrics_updated++
      } else {
        const newRubric = await db
          .insertInto('rubrics')
          .values({
            source_id: this.sourceId,
            version_id: this.versionId,
            chapter_id: chapterId,
            parent_id: parentId,
            name,
            full_path: fullPath,
            level: i + 1,
            remedy_count: 0
          })
          .returning(['id'])
          .executeTakeFirst()

        rubricId = newRubric!.id
        this.stats.rubrics_inserted++
      }

      cache.set(cacheKey, rubricId)
      parentId = rubricId
    }

    return rubricId
  }

  private async flushRelationships(batch: any[]) {
    await db
      .insertInto('rubric_remedies')
      .values(batch)
      .onConflict((oc) =>
        oc.columns(['rubric_id', 'remedy_id', 'source_id'])
          .doUpdateSet({ grade: (eb: any) => eb.ref('excluded.grade') })
      )
      .execute()

    this.stats.relationships_inserted += batch.length
  }

  private async updateRemedyCounts() {
    await sql`
      UPDATE rubrics r
      SET remedy_count = (
        SELECT COUNT(DISTINCT remedy_id)
        FROM rubric_remedies rr
        WHERE rr.rubric_id = r.id
          AND rr.source_id = ${this.sourceId}
      )
      WHERE r.source_id = ${this.sourceId}
    `.execute(db)
  }

  private async processChapter(chapter: ChapterData) {
    // For nested JSON format
    const chapterId = await this.getOrCreateChapterId(chapter.name)
    if (!chapterId) return

    const rubricCache = new Map<string, string>()
    await this.processRubricNodes(chapter.rubrics, [], chapterId, rubricCache)
  }

  private async getOrCreateChapterId(name: string): Promise<string | null> {
    const existing = await db
      .selectFrom('chapters')
      .select(['id'])
      .where('source_id', '=', this.sourceId)
      .where('name', '=', name)
      .executeTakeFirst()

    if (existing) return existing.id

    const created = await db
      .insertInto('chapters')
      .values({
        source_id: this.sourceId,
        code: name.substring(0, 5).toUpperCase(),
        slug: name.toLowerCase().replace(/\s+/g, '-'),
        name,
      })
      .returning(['id'])
      .executeTakeFirst()

    this.stats.chapters++
    return created?.id ?? null
  }

  private async processRubricNodes(
    nodes: RubricNode[],
    parentPath: string[],
    chapterId: string,
    cache: Map<string, string>,
    parentId: string | null = null
  ) {
    for (const node of nodes) {
      const currentPath = [...parentPath, node.name]
      const rubricId = await this.getOrCreateRubric(currentPath, chapterId, cache)

      // Insert remedy relationships
      if (node.remedies && node.remedies.length > 0) {
        const remedyCache = new Map<string, string>()
        const existing = await db
          .selectFrom('remedies')
          .select(['id', 'abbreviation'])
          .execute()
        for (const r of existing) remedyCache.set(r.abbreviation.toLowerCase(), r.id)

        const relationships = []
        for (const rm of node.remedies) {
          let remedyId = remedyCache.get(rm.abbreviation.toLowerCase())
          if (!remedyId) continue
          relationships.push({
            rubric_id: rubricId,
            remedy_id: remedyId,
            grade: rm.grade,
            source_id: this.sourceId,
            version_id: this.versionId,
          })
        }

        if (relationships.length > 0) {
          await this.flushRelationships(relationships)
        }
      }

      // Recurse into children
      if (node.children && node.children.length > 0) {
        await this.processRubricNodes(node.children, currentPath, chapterId, cache, rubricId)
      }
    }
  }
}

interface RubricNode {
  name: string
  remedies?: Array<{ abbreviation: string; grade: 1 | 2 | 3 | 4 }>
  children?: RubricNode[]
}

interface ChapterData {
  name: string
  rubrics: RubricNode[]
}
