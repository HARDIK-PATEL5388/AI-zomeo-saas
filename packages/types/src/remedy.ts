import { z } from 'zod'

export const RemedySchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  full_name: z.string(),
  family: z.string().nullable().optional(),
  kingdom: z.enum(['Plant', 'Animal', 'Mineral', 'Nosode', 'Imponderabilia']).nullable().optional(),
  miasm: z.enum(['Psora', 'Sycosis', 'Syphilis', 'Tubercular', 'Cancer']).nullable().optional(),
})

export type Remedy = z.infer<typeof RemedySchema>

export const RemedyKeynoteSchema = z.object({
  id: z.string().uuid(),
  remedy_id: z.string().uuid(),
  content_text: z.string(),
  source_book_id: z.string().uuid().nullable().optional(),
})

export type RemedyKeynote = z.infer<typeof RemedyKeynoteSchema>
