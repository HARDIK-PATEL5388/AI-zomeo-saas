// backend/src/services/analysisEngine.ts
import { db } from '../db/client'
import type { AnalysisResult, CaseRubric } from '../types'

export interface AnalysisOptions {
  sourceId?: string
  includeGradeBreakdown?: boolean
  minScore?: number
  limit?: number
}

export interface DetailedAnalysisResult extends AnalysisResult {
  grade_breakdown: Record<string, number>
  rubric_details: RubricContribution[]
}

export interface RubricContribution {
  rubric_id: string
  rubric_name: string
  full_path: string
  weight: number
  grade: number
  contribution: number
}

/**
 * Core Repertorization Engine
 * 
 * Algorithm:
 * 1. Fetch all selected rubrics for a case
 * 2. For each rubric, get all remedies and their grades
 * 3. score = SUM(rubric_weight × remedy_grade) across all rubrics
 * 4. Rank remedies by total score, with rubric coverage as tiebreaker
 */
export class RepertorizationEngine {
  async analyze(
    caseId: string,
    options: AnalysisOptions = {}
  ): Promise<DetailedAnalysisResult[]> {
    const { sourceId, limit = 50, minScore = 0 } = options

    // Step 1: Get selected rubrics with weights
    const caseRubrics = await this.getCaseRubrics(caseId, sourceId)

    if (caseRubrics.length === 0) {
      return []
    }

    // Step 2: Get all rubric-remedy relationships for selected rubrics
    const rubricIds = caseRubrics.map(cr => cr.rubric_id)
    const rubricRemedyData = await this.getRubricRemedies(rubricIds, sourceId)

    // Step 3: Calculate scores using the weighted algorithm
    const scores = this.calculateScores(caseRubrics, rubricRemedyData)

    // Step 4: Fetch remedy names and build results
    const results = await this.buildResults(scores, caseRubrics.length, minScore, limit)

    return results
  }

  private async getCaseRubrics(caseId: string, sourceId?: string) {
    let query = db
      .selectFrom('case_rubrics as cr')
      .innerJoin('rubrics as r', 'r.id', 'cr.rubric_id')
      .select([
        'cr.rubric_id',
        'cr.weight',
        'cr.source_id',
        'r.name as rubric_name',
        'r.full_path',
      ])
      .where('cr.case_id', '=', caseId)

    if (sourceId) {
      query = query.where('cr.source_id', '=', sourceId)
    }

    return query.execute()
  }

  private async getRubricRemedies(rubricIds: string[], sourceId?: string) {
    let query = db
      .selectFrom('rubric_remedies')
      .select(['rubric_id', 'remedy_id', 'grade'])
      .where('rubric_id', 'in', rubricIds)

    if (sourceId) {
      query = query.where('source_id', '=', sourceId)
    }

    return query.execute()
  }

  private calculateScores(
    caseRubrics: Array<{ rubric_id: string; weight: number; rubric_name: string; full_path: string }>,
    rubricRemedies: Array<{ rubric_id: string; remedy_id: string; grade: number }>
  ): Map<string, { score: number; contributions: RubricContribution[]; coveredRubrics: Set<string> }> {
    // Build rubric weight lookup
    const rubricWeights = new Map(
      caseRubrics.map(cr => [cr.rubric_id, { weight: cr.weight, name: cr.rubric_name, full_path: cr.full_path }])
    )

    // Calculate per-remedy scores
    const remedyScores = new Map<string, {
      score: number
      contributions: RubricContribution[]
      coveredRubrics: Set<string>
    }>()

    for (const rr of rubricRemedies) {
      const rubricInfo = rubricWeights.get(rr.rubric_id)
      if (!rubricInfo) continue

      const contribution = rubricInfo.weight * rr.grade

      if (!remedyScores.has(rr.remedy_id)) {
        remedyScores.set(rr.remedy_id, {
          score: 0,
          contributions: [],
          coveredRubrics: new Set()
        })
      }

      const remedyData = remedyScores.get(rr.remedy_id)!
      remedyData.score += contribution
      remedyData.coveredRubrics.add(rr.rubric_id)
      remedyData.contributions.push({
        rubric_id: rr.rubric_id,
        rubric_name: rubricInfo.name,
        full_path: rubricInfo.full_path,
        weight: rubricInfo.weight,
        grade: rr.grade,
        contribution,
      })
    }

    return remedyScores
  }

  private async buildResults(
    scores: Map<string, { score: number; contributions: RubricContribution[]; coveredRubrics: Set<string> }>,
    totalRubrics: number,
    minScore: number,
    limit: number
  ): Promise<DetailedAnalysisResult[]> {
    if (scores.size === 0) return []

    // Filter by min score and sort
    const sortedEntries = Array.from(scores.entries())
      .filter(([, data]) => data.score >= minScore)
      .sort((a, b) => {
        // Primary: score
        if (b[1].score !== a[1].score) return b[1].score - a[1].score
        // Secondary: rubric coverage
        return b[1].coveredRubrics.size - a[1].coveredRubrics.size
      })
      .slice(0, limit)

    if (sortedEntries.length === 0) return []

    // Fetch remedy details
    const remedyIds = sortedEntries.map(([id]) => id)
    const remedies = await db
      .selectFrom('remedies')
      .select(['id', 'name', 'abbreviation'])
      .where('id', 'in', remedyIds)
      .execute()

    const remedyMap = new Map(remedies.map(r => [r.id, r]))

    // Build final results
    return sortedEntries
      .map(([remedyId, data], index) => {
        const remedy = remedyMap.get(remedyId)
        if (!remedy) return null

        const coveredCount = data.coveredRubrics.size
        const coveragePercent = totalRubrics > 0
          ? Math.round((coveredCount / totalRubrics) * 100 * 10) / 10
          : 0

        // Grade breakdown
        const gradeBreakdown = data.contributions.reduce((acc, c) => {
          acc[`grade_${c.grade}`] = (acc[`grade_${c.grade}`] || 0) + 1
          return acc
        }, {} as Record<string, number>)

        return {
          remedy_id: remedyId,
          remedy_name: remedy.name,
          abbreviation: remedy.abbreviation,
          score: data.score,
          rank: index + 1,
          rubric_coverage: coveredCount,
          total_rubrics: totalRubrics,
          coverage_percent: coveragePercent,
          grade_breakdown: gradeBreakdown,
          rubric_details: data.contributions.sort((a, b) => b.contribution - a.contribution),
        } as DetailedAnalysisResult
      })
      .filter(Boolean) as DetailedAnalysisResult[]
  }

  /**
   * Save analysis results to database
   */
  async saveResults(caseId: string, results: DetailedAnalysisResult[], sourceId?: string) {
    // Delete previous results for this case/source
    await db
      .deleteFrom('analysis_results')
      .where('case_id', '=', caseId)
      .execute()

    if (results.length === 0) return

    // Bulk insert new results
    await db
      .insertInto('analysis_results')
      .values(
        results.map(r => ({
          case_id: caseId,
          remedy_id: r.remedy_id,
          score: r.score,
          rank: r.rank,
          rubric_coverage: r.rubric_coverage,
          total_rubrics: r.total_rubrics,
          coverage_percent: r.coverage_percent,
          grade_breakdown: JSON.stringify(r.grade_breakdown),
          rubric_details: JSON.stringify(r.rubric_details),
          source_id: sourceId,
        }))
      )
      .execute()
  }
}

export const repertorizationEngine = new RepertorizationEngine()
