import { z } from 'zod'

export const PatientAddressSchema = z.object({
  address: z.string().optional(),
  street: z.string().optional(),
  country: z.string().optional(),
  state: z.string().optional(),
  city: z.string().optional(),
  zip_code: z.string().optional(),
}).partial()

export const PatientPermanentAddressSchema = PatientAddressSchema.extend({
  same_as_current: z.boolean().optional(),
})

export const PatientContactDetailsSchema = z.object({
  home_number: z.string().optional(),
  office_number: z.string().optional(),
  website: z.string().optional(),
  emergency_number: z.string().optional(),
  fax_number: z.string().optional(),
}).partial()

export const PatientSchema = z.object({
  id: z.string().uuid().optional(),

  // Tab 1 — Registration
  registration_date: z.string().optional(),
  registration_number: z.string().optional(),
  diagnosis: z.string().optional(),
  title: z.string().optional(),
  first_name: z.string().min(1),
  middle_name: z.string().optional(),
  last_name: z.string().optional().nullable(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  date_of_birth: z.string().optional(),
  age: z.number().int().min(0).max(150).optional(),
  blood_group: z.string().optional(),
  gender: z.enum(['male', 'female', 'other']).optional().nullable(),
  referred_by: z.string().optional(),
  currency: z.string().optional(),
  consultation_charges: z.number().min(0).optional(),
  follow_up_charges: z.number().min(0).optional(),
  bill_to: z.string().optional(),
  opd_number: z.string().optional(),
  opd_date: z.string().optional(),
  ipd_number: z.string().optional(),
  ipd_date: z.string().optional(),
  remarks: z.string().optional(),
  photo_url: z.string().optional(),

  // Tab 2 — Preliminary
  occupation: z.string().optional(),
  organization: z.string().optional(),
  marital_status: z.string().optional(),
  religion: z.string().optional(),
  diet: z.string().optional(),
  prognosis: z.string().optional(),
  preliminary_remarks: z.string().optional(),

  // Tab 3 — Contact (nested JSONB)
  current_address: PatientAddressSchema.optional(),
  permanent_address: PatientPermanentAddressSchema.optional(),
  contact_details: PatientContactDetailsSchema.optional(),

  // Misc
  address: z.string().optional(),
  is_active: z.boolean().optional(),
  clinic_id: z.string().uuid().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export type Patient = z.infer<typeof PatientSchema>
export type PatientAddress = z.infer<typeof PatientAddressSchema>
export type PatientPermanentAddress = z.infer<typeof PatientPermanentAddressSchema>
export type PatientContactDetails = z.infer<typeof PatientContactDetailsSchema>
