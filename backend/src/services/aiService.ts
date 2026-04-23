// backend/src/services/aiService.ts
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { db, sql } from '../db/client'
import type { Rubric } from '../types'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'dummy' })
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'dummy' })

export interface ExtractedSymptom {
  keyword: string
  category: 'mental' | 'physical' | 'general' | 'modality' | 'sensation'
  confidence: number
  rubric_hints: string[]
}

export interface AIRubricSuggestion {
  rubric_id: string
  rubric_name: string
  full_path: string
  chapter_name: string
  remedy_count: number
  relevance_score: number
  match_type: 'exact' | 'semantic' | 'keyword'
}

/**
 * AI Service for intelligent rubric search and symptom extraction
 */
export class AIService {
  /**
   * Extract homeopathic keywords from free-text symptom description
   * Uses Claude for nuanced medical understanding
   */
  async extractSymptoms(text: string): Promise<ExtractedSymptom[]> {
    if (!process.env.ANTHROPIC_API_KEY) {
      return [] // Return empty if no API key
    }
    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20240620',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `You are an expert homeopath. Extract rubric keywords from this patient symptom description.

Input: "${text}"

Return a JSON array of extracted symptoms. Each item must have:
- keyword: the homeopathic rubric keyword
- category: one of "mental", "physical", "general", "modality", "sensation"
- confidence: 0.0 to 1.0
- rubric_hints: 2-3 likely chapter paths (e.g., ["Mind > Fear > Death", "Sleep > Restlessness"])

Focus on: mental symptoms, physical symptoms, modalities (better/worse), time of day, sensations, concomitants.
Return ONLY valid JSON array, no explanation.`,
        },
      ],
    })

    try {
      const content = message.content[0]
      if (content.type !== 'text') return []
      const parsed = JSON.parse(content.text)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  /**
   * Intelligent rubric search combining full-text + semantic similarity
   */
  async searchRubrics(
    query: string,
    sourceId?: string,
    limit = 20
  ): Promise<AIRubricSuggestion[]> {
    // Step 1: Extract keywords via AI
    const extracted = await this.extractSymptoms(query)
    const keywords = extracted.map(e => e.keyword).join(' ')
    const searchQuery = keywords || query

    // Step 2: Full-text search in PostgreSQL
    const ftsResults = await sql<any>`
        SELECT 
          r.id, r.name, r.full_path, r.remedy_count,
          c.name as chapter_name,
          ts_rank(r.search_vector, plainto_tsquery('english', ${searchQuery})) as rank
        FROM rubrics r
        JOIN chapters c ON c.id = r.chapter_id
        WHERE r.search_vector @@ plainto_tsquery('english', ${searchQuery})
          ${sourceId ? sql`AND r.source_id = ${sourceId}` : sql``}
        ORDER BY rank DESC, r.remedy_count DESC
        LIMIT ${limit * 2}
    `.execute(db)

    // Step 3: Trigram similarity search for partial matches
    const trigramResults = await sql<any>`
        SELECT 
          r.id, r.name, r.full_path, r.remedy_count,
          c.name as chapter_name,
          similarity(r.name, ${query}) as sim_score
        FROM rubrics r
        JOIN chapters c ON c.id = r.chapter_id
        WHERE similarity(r.name, ${query}) > 0.2
          ${sourceId ? sql`AND r.source_id = ${sourceId}` : sql``}
        ORDER BY sim_score DESC
        LIMIT ${limit}
    `.execute(db)

    // Step 4: Merge and deduplicate results
    const seen = new Set<string>()
    const merged: AIRubricSuggestion[] = []

    for (const row of ftsResults.rows) {
      if (!seen.has(row.id)) {
        seen.add(row.id)
        merged.push({
          rubric_id: row.id,
          rubric_name: row.name,
          full_path: row.full_path,
          chapter_name: row.chapter_name,
          remedy_count: row.remedy_count,
          relevance_score: parseFloat(row.rank) * 100,
          match_type: 'keyword',
        })
      }
    }

    for (const row of trigramResults.rows) {
      if (!seen.has(row.id)) {
        seen.add(row.id)
        merged.push({
          rubric_id: row.id,
          rubric_name: row.name,
          full_path: row.full_path,
          chapter_name: row.chapter_name,
          remedy_count: row.remedy_count,
          relevance_score: parseFloat(row.sim_score) * 50,
          match_type: 'semantic',
        })
      }
    }

    return merged
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, limit)
  }

  /**
   * Generate embeddings for semantic search (batch processing)
   */
  async generateRubricEmbedding(rubricText: string): Promise<number[]> {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: rubricText,
    })
    return response.data[0].embedding
  }

  /**
   * Vector similarity search using pgvector
   */
  async semanticRubricSearch(
    query: string,
    sourceId?: string,
    limit = 10
  ): Promise<AIRubricSuggestion[]> {
    const embedding = await this.generateRubricEmbedding(query)
    const embeddingStr = `[${embedding.join(',')}]`

    const results = await sql<any>`
        SELECT 
          r.id, r.name, r.full_path, r.remedy_count,
          c.name as chapter_name,
          1 - (r.embedding <=> ${embeddingStr}::vector) as similarity
        FROM rubrics r
        JOIN chapters c ON c.id = r.chapter_id
        WHERE r.embedding IS NOT NULL
          ${sourceId ? sql`AND r.source_id = ${sourceId}` : sql``}
        ORDER BY r.embedding <=> ${embeddingStr}::vector
        LIMIT ${limit}
    `.execute(db)

    return results.rows.map((row: any) => ({
      rubric_id: row.id,
      rubric_name: row.name,
      full_path: row.full_path,
      chapter_name: row.chapter_name,
      remedy_count: row.remedy_count,
      relevance_score: parseFloat(row.similarity) * 100,
      match_type: 'semantic' as const,
    }))
  }

  /**
   * Generate prescription notes and clinical tips using AI
   */
  async generatePrescriptionInsights(
    remedyName: string,
    patientSymptoms: string,
    analysisScore: number
  ): Promise<string> {
    if (!process.env.ANTHROPIC_API_KEY) {
      return "AI insights unavailable (missing API key)."
    }
    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20240620',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `As an experienced homeopath, provide brief prescribing insights for:
Remedy: ${remedyName}
Patient symptoms: ${patientSymptoms}
Repertory score: ${analysisScore}

Include: key confirmatory symptoms, typical potency considerations, and 1-2 clinical pearls.
Keep it concise (3-4 sentences max).`,
      }],
    })

    const content = message.content[0]
    return content.type === 'text' ? content.text : ''
  }
}

export const aiService = new AIService()
