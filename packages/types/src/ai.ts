export interface AIRubricSuggestion {
  rubricId: string
  symptomText: string
  chapter: string
  repertory: string
  score: number
  matchType: 'fts' | 'vector' | 'hybrid'
}

export interface AIPrescription {
  remedy: { id: string; code: string; full_name: string }
  score: number
  rubricsMatched: string[]
  explanation: string
  suggestedPotency: string
}

export interface AIStreamEvent {
  type: 'token' | 'rubrics' | 'done'
  text?: string
  rubrics?: AIRubricSuggestion[]
}

// AI endpoint types
export type AIEndpoint =
  | '/ai/suggest-rubrics'    // Free-text → top 15 rubrics (SSE)
  | '/ai/prescribe'          // Rubric list → top 3 remedies + citations (SSE)
  | '/ai/compare-remedies'   // 2-5 remedy IDs → differentiation (SSE)
  | '/ai/auto-repertorize'   // Free-text case → pre-filled chart
  | '/ai/case-summary'       // patient_id → clinical narrative (SSE)
  | '/ai/tutor'              // Student question → explanation (SSE)
  | '/ai/research-query'     // Diagnosis + remedy → statistical report
