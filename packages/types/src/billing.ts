export type Plan = 'starter' | 'professional' | 'clinic' | 'institution' | 'researcher'

export interface Subscription {
  id: string
  tenantId: string
  plan: Plan
  active: boolean
  validFrom: string
  validTo: string | null
  stripeSubscriptionId: string | null
}

export const PLAN_HIERARCHY: Record<Plan, number> = {
  starter: 0,
  professional: 1,
  researcher: 1,
  clinic: 2,
  institution: 3,
}

export const PLAN_FEATURES: Record<Plan, {
  label: string
  repertories: string
  books: string
  ai: boolean
  patients: string
  users: string
  price: string
}> = {
  starter:      { label: 'Starter',      repertories: 'Kent only', books: '5 books',   ai: false, patients: '50',        users: '1',          price: 'Free trial' },
  professional: { label: 'Professional', repertories: 'All 26',    books: 'All 565+',  ai: true,  patients: 'Unlimited', users: '1',          price: '$29/mo' },
  clinic:       { label: 'Clinic',       repertories: 'All 26',    books: 'All 565+',  ai: true,  patients: 'Unlimited', users: 'Up to 10',   price: '$79/mo' },
  institution:  { label: 'Institution',  repertories: 'All 26',    books: 'All 565+',  ai: true,  patients: 'Unlimited', users: 'Unlimited',  price: 'Custom' },
  researcher:   { label: 'Researcher',   repertories: 'All 26',    books: 'All 565+',  ai: true,  patients: 'N/A',       users: '1',          price: 'Annual' },
}
