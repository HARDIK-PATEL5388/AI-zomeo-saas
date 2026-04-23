// backend/src/types/index.ts

export type UserRole = 'master_admin' | 'admin' | 'doctor' | 'patient'
export type SubscriptionPlan = 'trial' | 'starter' | 'professional' | 'enterprise'
export type Gender = 'male' | 'female' | 'other'
export type RemedyGrade = 1 | 2 | 3 | 4
export type CaseStatus = 'active' | 'closed' | 'archived'

export interface JwtPayload {
  userId: string
  clinicId: string
  role: UserRole
  email: string
}

export interface User {
  id: string
  clinic_id: string
  email: string
  role: UserRole
  first_name: string
  last_name: string
  phone?: string
  is_active: boolean
}

export interface Clinic {
  id: string
  name: string
  email: string
  subscription_plan: SubscriptionPlan
  subscription_status: 'active' | 'suspended' | 'cancelled'
}

export interface Patient {
  id: string
  clinic_id: string
  first_name: string
  last_name: string
  date_of_birth?: string
  age?: number
  gender: Gender
  phone?: string
  email?: string
  address?: string
  is_active: boolean
}

export interface RepertorySource {
  id: string
  name: string
  slug: string
  publisher?: string
}

export interface Chapter {
  id: string
  source_id: string
  code: string
  slug: string
  name: string
  sort_order: number
}

export interface Rubric {
  id: string
  source_id: string
  chapter_id: string
  parent_id?: string
  name: string
  full_path: string
  level: number
  remedy_count: number
}

export interface Remedy {
  id: string
  name: string
  abbreviation: string
  latin_name?: string
  category?: string
}

export interface RubricRemedy {
  rubric_id: string
  remedy_id: string
  grade: RemedyGrade
  source_id: string
}

export interface Case {
  id: string
  patient_id: string
  doctor_id: string
  clinic_id: string
  chief_complaint: string
  history?: string
  status: CaseStatus
  created_at: string
}

export interface CaseRubric {
  id: string
  case_id: string
  rubric_id: string
  source_id: string
  weight: number
  notes?: string
}

export interface AnalysisResult {
  remedy_id: string
  remedy_name: string
  abbreviation: string
  score: number
  rank: number
  rubric_coverage: number
  total_rubrics: number
  coverage_percent: number
}

export interface Prescription {
  id: string
  case_id: string
  remedy_id: string
  potency: string
  dose?: string
  frequency?: string
  duration?: string
  instructions?: string
  follow_up_date?: string
}

export interface Followup {
  id: string
  case_id: string
  followup_date: string
  overall_improvement: number
  symptom_changes?: string
  doctor_notes?: string
  action_taken: string
  next_followup_date?: string
}

// API Response types
export interface ApiResponse<T = unknown> {
  data?: T
  error?: string
  message?: string
  meta?: {
    total?: number
    page?: number
    per_page?: number
  }
}

export interface PaginationParams {
  page?: number
  per_page?: number
  search?: string
  sort_by?: string
  sort_order?: 'asc' | 'desc'
}

// Context extensions for Hono
declare module 'hono' {
  interface ContextVariableMap {
    user: JwtPayload
    clinicId: string
  }
}
