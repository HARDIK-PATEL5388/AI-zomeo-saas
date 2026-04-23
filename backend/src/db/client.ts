// backend/src/db/client.ts
import { Kysely, PostgresDialect, sql, Generated } from 'kysely'
import { Pool } from 'pg'
import type { 
  User, Clinic, Patient, Case, CaseRubric, 
  RepertorySource, Chapter, Rubric, Remedy, 
  RubricRemedy, AnalysisResult, Prescription, Followup 
} from '../types'

export interface Database {
  users: Omit<User, 'id'> & { id: Generated<string>; password_hash: string; mobile_code: string | null; mobile_number: string | null; created_at: Generated<string>; updated_at: Generated<string> }
  clinics: Omit<Clinic, 'id'> & { id: Generated<string>; created_at: Generated<string>; updated_at: Generated<string> }
  patients: Omit<Patient, 'id'> & { id: Generated<string>; created_at: Generated<string>; updated_at: Generated<string> }
  cases: Omit<Case, 'id'> & { id: Generated<string>; created_at: Generated<string>; updated_at: Generated<string> }
  case_rubrics: Omit<CaseRubric, 'id'> & { id: Generated<string>; created_at: Generated<string> }
  repertory_sources: Omit<RepertorySource, 'id'> & { id: Generated<string>; created_at: Generated<string>; is_active: Generated<boolean> }
  repertory_versions: { id: Generated<string>; source_id: string; version: string; year: number; is_current: Generated<boolean>; created_at: Generated<string> }
  chapters: Omit<Chapter, 'id'> & { id: Generated<string>; sort_order: Generated<number> }
  rubrics: Omit<Rubric, 'id'> & { id: Generated<string>; version_id?: string; created_at: Generated<string>; search_vector: any; embedding: any }
  remedies: Omit<Remedy, 'id'> & { id: Generated<string>; created_at: Generated<string>; is_active: Generated<boolean> }
  rubric_remedies: RubricRemedy
  analysis_results: {
    id: Generated<string>
    case_id: string
    remedy_id: string
    score: number
    rank: number
    rubric_coverage: number
    total_rubrics: number
    coverage_percent: number
    grade_breakdown: any
    rubric_details: any
    source_id: string | null
    analyzed_at: Generated<string>
  }
  prescriptions: Omit<Prescription, 'id'> & { id: Generated<string>; clinic_id: string; patient_id: string; doctor_id: string; created_at: Generated<string>; updated_at: Generated<string> }
  followups: Omit<Followup, 'id'> & { id: Generated<string>; clinic_id: string; patient_id: string; doctor_id: string; created_at: Generated<string> }
  ai_search_logs: { id: Generated<string>; user_id: string; clinic_id: string; query: string; suggested_rubrics: any; response_time_ms: number; created_at: Generated<string> }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
})

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool })
})

export { sql }
