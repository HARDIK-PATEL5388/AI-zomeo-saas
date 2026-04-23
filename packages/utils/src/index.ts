// Zomeo.ai — Shared Utilities

/**
 * Repertorization scoring algorithm
 * Score = Σ (rubric_weight × remedy_grade) for each selected rubric
 *
 * rubric_weight: 1=Common, 2=Confirmatory, 3=Characteristic, 4=Eliminating
 * remedy_grade:  1=Minor (plain), 2=Moderate (italic), 3=Strong (bold)
 */
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

/** Format date for Indian locale display */
export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-IN', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

/** Format datetime for Indian locale */
export function formatDateTime(date: string | Date): string {
  return new Date(date).toLocaleString('en-IN', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

/** Truncate text to maxLen chars with ellipsis */
export function truncate(text: string, maxLen = 120): string {
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text
}

/** Parse SSE data lines from a streamed chunk */
export function parseSSEChunk(chunk: string): Array<{ type: string; [key: string]: unknown }> {
  return chunk
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => {
      try { return JSON.parse(line.slice(5).trim()) }
      catch { return null }
    })
    .filter(Boolean) as Array<{ type: string; [key: string]: unknown }>
}

/** Debounce a function */
export function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>
  return ((...args: unknown[]) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }) as T
}

/** Format INR currency */
export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount)
}

/** Calculate patient age from DOB */
export function calculateAge(dob: string): number {
  const birth = new Date(dob)
  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const m = now.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--
  return age
}
