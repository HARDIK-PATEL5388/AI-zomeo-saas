import { z } from 'zod'

export const RubricSchema = z.object({
  id: z.string().uuid(),
  symptom_text: z.string(),
  level: z.number().int().min(1).max(4),
  parent_id: z.string().uuid().nullable(),
  chapter_id: z.string().uuid(),
  repertory_id: z.string().uuid(),
})

export type Rubric = z.infer<typeof RubricSchema>

export const RubricRemedySchema = z.object({
  rubric_id: z.string().uuid(),
  remedy_id: z.string().uuid(),
  grade: z.number().int().min(1).max(3),
})

export type RubricRemedy = z.infer<typeof RubricRemedySchema>

// Core repertorization result
export interface RepertorizationResult {
  remedy: { id: string; code: string; full_name: string }
  totalScore: number
  rubricsMatched: number
  totalRubrics: number
  breakdown: Array<{
    rubricText: string
    grade: number
    weight: number
    score: number
  }>
}

// Repertorization algorithm
// Score = Σ (rubric_weight × remedy_grade) for each selected rubric
// rubric_weight: 1=Common, 2=Confirmatory, 3=Characteristic, 4=Eliminating
// remedy_grade: 1=Minor (plain), 2=Moderate (italic), 3=Strong (bold)
export function computeRepertorizationScore(
  selectedRubrics: Array<{ rubricId: string; weight: number }>,
  rubricRemedies: Array<{ rubricId: string; remedyId: string; grade: number }>
): Array<{ remedyId: string; totalScore: number; coverage: number }> {
  const remedyMap = new Map<string, { totalScore: number; coverage: number }>()

  for (const { rubricId, weight } of selectedRubrics) {
    const matches = rubricRemedies.filter((rr) => rr.rubricId === rubricId)
    for (const { remedyId, grade } of matches) {
      const existing = remedyMap.get(remedyId) || { totalScore: 0, coverage: 0 }
      existing.totalScore += weight * grade
      existing.coverage += 1
      remedyMap.set(remedyId, existing)
    }
  }

  return Array.from(remedyMap.entries())
    .map(([remedyId, stats]) => ({ remedyId, ...stats }))
    .sort((a, b) => b.totalScore - a.totalScore || b.coverage - a.coverage)
}
