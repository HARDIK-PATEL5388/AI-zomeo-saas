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

export interface PatientAddress {
  address?: string
  street?: string
  country?: string
  state?: string
  city?: string
  zip_code?: string
}

export interface PatientPermanentAddress extends PatientAddress {
  same_as_current?: boolean
}

export interface PatientContactDetails {
  home_number?: string
  office_number?: string
  website?: string
  emergency_number?: string
  fax_number?: string
}

export interface Patient {
  id: string
  clinic_id: string
  // Registration Information
  registration_date?: string
  registration_number?: string
  diagnosis?: string
  title?: string
  first_name: string
  middle_name?: string
  last_name?: string | null
  phone?: string                 // Mobile Number
  email?: string
  date_of_birth?: string
  age?: number
  blood_group?: string
  gender?: Gender | null
  referred_by?: string
  currency?: string
  consultation_charges?: number
  follow_up_charges?: number
  bill_to?: string
  opd_number?: string
  opd_date?: string
  ipd_number?: string
  ipd_date?: string
  remarks?: string
  photo_url?: string
  // Preliminary
  occupation?: string
  organization?: string
  marital_status?: string
  religion?: string
  diet?: string
  prognosis?: string
  preliminary_remarks?: string
  // Contact (JSONB)
  current_address?: PatientAddress
  permanent_address?: PatientPermanentAddress
  contact_details?: PatientContactDetails
  // Other / legacy
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
  parent_id?: string | null
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
  version_id?: string
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
  sort_order?: number
  added_by?: string
}

export interface AnalysisResult {
  id?: string
  case_id?: string
  remedy_id: string
  remedy_name: string
  abbreviation: string
  score: number
  rank: number
  rubric_coverage: number
  total_rubrics: number
  coverage_percent: number
  grade_breakdown?: any
  rubric_details?: any
  analyzed_at?: string
}

export interface DetailedAnalysisResult extends AnalysisResult {
  grade_breakdown: Record<string, number>
  rubric_details: any[]
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
  patient_id: string
  clinic_id: string
  doctor_id: string
  prescription_id?: string | null
  analysis_id?: string | null
  // New fields (post-migration 011)
  visit_date?: string | null
  complaints?: string | null
  remedy_name?: string | null
  remedy_code?: number | null
  potency?: string | null
  dosage?: string | null
  repetition?: string | null
  days?: string | null
  prescription_type?: string | null
  remedy_response?: string | null
  diagnosis?: string | null
  preferences?: string | null
  investigations?: string | null
  examination?: string | null
  improvement_score?: number | null
  next_visit_date?: string | null
  notes?: string | null
  created_by?: string | null
  // Legacy columns (kept for back-compat)
  followup_date?: string | null
  overall_improvement?: number | null
  symptom_changes?: string | null
  new_symptoms?: string | null
  mental_state?: string | null
  physical_state?: string | null
  doctor_notes?: string | null
  action_taken?: string | null
  next_followup_date?: string | null
  created_at?: string
  updated_at?: string | null
}

export interface FollowupMedia {
  id: string
  followup_id: string
  file_url: string
  file_type?: string | null
  caption?: string | null
  uploaded_by?: string | null
  created_at?: string
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

// Context extensions for Hono (Moved to hono.d.ts)
