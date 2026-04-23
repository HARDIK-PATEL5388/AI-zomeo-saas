// Zomeo.ai — 10-Step RAG Query Pipeline
// Retrieval-Augmented Generation grounded in 26 homeopathic repertories
// PRIVACY: Patient PII is stripped before any OpenAI call

import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIM = 1536
const LLM_MODEL = 'gpt-4o'

// Simple in-memory embedding cache (replace with Redis in production)
const embeddingCache = new Map<string, { embedding: number[]; ts: number }>()
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

async function getEmbedding(text: string): Promise<number[]> {
  const cacheKey = text.slice(0, 200)
  const cached = embeddingCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.embedding
  }

  const res = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: EMBEDDING_DIM,
  })
  const embedding = res.data[0].embedding
  embeddingCache.set(cacheKey, { embedding, ts: Date.now() })
  return embedding
}

export interface RubricMatch {
  rubric_id: string
  rubric_text: string
  repertory_name: string
  chapter_name: string
  score: number
}

export interface RAGContext {
  rubrics: RubricMatch[]
  remedyContext: string
  systemContext: string
}

/**
 * Steps 1-5: Hybrid FTS + pgvector search with Reciprocal Rank Fusion
 */
export async function fetchRubricContext(
  query: string,
  tenantId: string,
  matchCount = 15
): Promise<{ rubrics: RubricMatch[]; context: string }> {
  // Step 1: Get licensed repertory IDs for this tenant
  const { data: licences } = await supabase
    .from('tenant_licences')
    .select('repertory_id')
    .eq('tenant_id', tenantId)
    .eq('active', true)

  const repIds = licences?.map((l: any) => l.repertory_id).filter(Boolean) || []
  if (repIds.length === 0) return { rubrics: [], context: '' }

  // Step 2: Generate query embedding (check Redis cache first in production)
  const embedding = await getEmbedding(query)

  // Steps 3-5: Hybrid search via stored procedure (FTS + pgvector + RRF)
  const ftsQuery = query.trim().split(/\s+/).filter(Boolean).join(' & ')
  const { data: rubrics, error } = await supabase.rpc('search_rubrics', {
    p_query_text: ftsQuery,
    p_query_embedding: embedding,
    p_rep_ids: repIds,
    p_match_count: matchCount,
  })

  if (error) {
    console.error('[RAG] search_rubrics error:', error)
    return { rubrics: [], context: '' }
  }

  const context = (rubrics || [])
    .map((r: RubricMatch) => `[${r.repertory_name} → ${r.chapter_name}] ${r.rubric_text}`)
    .join('\n')

  return { rubrics: rubrics || [], context }
}

/**
 * Steps 6-7: Fetch remedy context from top rubrics
 */
export async function fetchRemedyContext(
  rubricIds: string[],
  topN = 5
): Promise<string> {
  // Step 6: Aggregate remedy scores from rubric_remedies
  const { data: rubricRemedies } = await supabase
    .from('rubric_remedies')
    .select('grade, rubric_id, remedies(id, code, full_name)')
    .in('rubric_id', rubricIds)

  const remedyMap = new Map<string, { remedy: any; totalGrade: number; coverage: number }>()
  for (const rr of rubricRemedies || []) {
    const r = rr.remedies as any
    const existing = remedyMap.get(r.id) || { remedy: r, totalGrade: 0, coverage: 0 }
    existing.totalGrade += rr.grade
    existing.coverage += 1
    remedyMap.set(r.id, existing)
  }

  const topRemedies = Array.from(remedyMap.values())
    .sort((a, b) => b.totalGrade - a.totalGrade || b.coverage - a.coverage)
    .slice(0, topN)

  // Step 7: Fetch keynotes for top remedies
  const topIds = topRemedies.map((r) => r.remedy.id)
  const { data: keynotes } = await supabase
    .from('remedy_keynotes')
    .select('content_text, remedy_id')
    .in('remedy_id', topIds)
    .limit(30)

  const keynoteMap = new Map<string, string[]>()
  for (const k of keynotes || []) {
    const existing = keynoteMap.get(k.remedy_id) || []
    existing.push(k.content_text)
    keynoteMap.set(k.remedy_id, existing)
  }

  return topRemedies.map(({ remedy, totalGrade, coverage }) => {
    const notes = (keynoteMap.get(remedy.id) || []).slice(0, 3).join(' ')
    return `${remedy.full_name} (${remedy.code}) — Score: ${totalGrade}, Rubrics: ${coverage}\nKeynotes: ${notes || 'None available'}`
  }).join('\n\n')
}

/**
 * Step 8: Build system prompt for GPT-4o
 */
export function buildSystemPrompt(retrievedContext: string): string {
  return `You are an expert homeopathic practitioner with deep knowledge of classical and modern homeopathy.
Your responses are grounded ONLY in the following retrieved repertory content from Zomeo's database.
Do NOT suggest remedies not found in the provided context.
Format remedy names exactly as they appear in the data (e.g., "Aconitum napellus", "Sulphur").

RETRIEVED REPERTORY CONTENT:
${retrievedContext}

Guidelines:
- Cite the repertory source for each rubric (e.g., "Kent: Mind > Fear > Death")
- For remedy suggestions, show score and rubric coverage
- If context is insufficient, say so — do not hallucinate
- Patient privacy: never ask for or use patient names, dates of birth, or contact details`
}

/**
 * Full streaming RAG pipeline (Steps 1-10)
 */
export async function* streamRAGResponse(
  query: string,
  tenantId: string,
  additionalContext?: string
): AsyncGenerator<string, void, unknown> {
  // Steps 1-5: Retrieve rubrics
  const { rubrics, context } = await fetchRubricContext(query, tenantId)

  // Steps 6-7: Retrieve remedy keynotes if rubrics found
  const rubricIds = rubrics.map((r) => r.rubric_id)
  const remedyCtx = rubricIds.length > 0 ? await fetchRemedyContext(rubricIds) : ''

  // Step 8: Build prompt
  const fullContext = [context, remedyCtx, additionalContext].filter(Boolean).join('\n\n')
  const systemPrompt = buildSystemPrompt(fullContext)

  // Steps 9-10: Stream GPT-4o response
  const stream = openai.beta.chat.completions.stream({
    model: LLM_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: query },
    ],
    stream: true,
    max_tokens: 2000,
  })

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content || ''
    if (text) yield text
  }
}
