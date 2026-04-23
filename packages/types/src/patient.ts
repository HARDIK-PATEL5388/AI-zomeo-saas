import { z } from 'zod'

export const PatientSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  dob: z.string().optional(),
  gender: z.enum(['male', 'female', 'other']).optional(),
  contact_json: z.record(z.unknown()).optional(),
  demographic_json: z.record(z.unknown()).optional(),
  tenant_id: z.string().uuid().optional(),
  created_at: z.string().optional(),
})

export type Patient = z.infer<typeof PatientSchema>
