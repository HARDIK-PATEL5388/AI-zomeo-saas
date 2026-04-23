// Zomeo.ai — Reports Route
// Revenue, patient demographics, diagnosis reports

import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'
import { tenantMiddleware } from '../middleware/tenant'
import { createClient } from '@supabase/supabase-js'

export const reportsRoutes = new Hono()

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

reportsRoutes.use('*', authMiddleware, tenantMiddleware)

// GET /api/reports/revenue
reportsRoutes.get('/revenue', async (c) => {
  const tenantId = c.get('tenantId')
  const {
    from = new Date(Date.now() - 30 * 86400000).toISOString(),
    to = new Date().toISOString(),
  } = c.req.query()

  const { data, error } = await supabase
    .from('invoices')
    .select('amount, currency, status, created_at')
    .eq('tenant_id', tenantId)
    .eq('status', 'paid')
    .gte('created_at', from)
    .lte('created_at', to)
    .order('created_at')

  if (error) return c.json({ error: error.message }, 500)

  const total = (data || []).reduce((sum, inv) => sum + Number(inv.amount), 0)
  return c.json({ invoices: data, total, from, to })
})

// GET /api/reports/patients
reportsRoutes.get('/patients', async (c) => {
  const tenantId = c.get('tenantId')

  const { data, error } = await supabase
    .from('patients')
    .select('gender, dob')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)

  if (error) return c.json({ error: error.message }, 500)

  // Compute demographics
  const genderCount = { male: 0, female: 0, other: 0 }
  for (const p of data || []) {
    if (p.gender in genderCount) genderCount[p.gender as keyof typeof genderCount]++
  }

  return c.json({ total: data?.length || 0, gender: genderCount })
})

// GET /api/reports/diagnosis
reportsRoutes.get('/diagnosis', async (c) => {
  const tenantId = c.get('tenantId')

  const { data, error } = await supabase
    .from('prescriptions')
    .select('remedies(code, full_name)')
    .eq('tenant_id', tenantId)

  if (error) return c.json({ error: error.message }, 500)

  // Top remedies prescribed
  const remedyCount = new Map<string, { name: string; count: number }>()
  for (const p of data || []) {
    const r = p.remedies as any
    if (r) {
      const existing = remedyCount.get(r.code) || { name: r.full_name, count: 0 }
      existing.count++
      remedyCount.set(r.code, existing)
    }
  }

  const topRemedies = Array.from(remedyCount.entries())
    .map(([code, { name, count }]) => ({ code, name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)

  return c.json({ topRemedies })
})
