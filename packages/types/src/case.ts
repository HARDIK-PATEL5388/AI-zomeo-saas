import { z } from 'zod'

export const CaseSchema = z.object({
  id: z.string().uuid().optional(),
  patient_id: z.string().uuid(),
  tenant_id: z.string().uuid().optional(),
  case_json: z.record(z.unknown()),
  status: z.enum(['active', 'closed', 'archived']).default('active'),
  created_at: z.string().optional(),
})

export type Case = z.infer<typeof CaseSchema>

export const ConsultationSchema = z.object({
  id: z.string().uuid().optional(),
  case_id: z.string().uuid(),
  consultation_date: z.string(),
  prescription_json: z.record(z.unknown()).optional(),
  rubrics_json: z.array(z.record(z.unknown())).optional(),
  notes: z.string().optional(),
})

export type Consultation = z.infer<typeof ConsultationSchema>
