// Zomeo.ai — Backend API
// Node.js 20 LTS + Hono.js v4 + TypeScript 5
import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { prettyJSON } from 'hono/pretty-json'
import { authRoutes } from './routes/auth'
import { repertoryRoutes } from './routes/repertory'
import { casesRoutes } from './routes/cases'
import { analysisRoutes } from './routes/analysis'
import { analysisV2Routes } from './routes/analysisV2'
import { prescriptionsRoutes } from './routes/prescriptions'
import { followupsRoutes } from './routes/followups'
import { patientsRoutes } from './routes/patients'
import { aiRoutes } from './routes/ai'
import { adminRoutes } from './routes/admin'
import { uploadRoutes } from './routes/upload'
import { repertoryUploadRoutes } from './routes/repertoryUpload'
import { remediesRoutes } from './routes/remedies'
import { billingRoutes } from './routes/billing'
import { appointmentsRoutes } from './routes/appointments'
import { booksRoutes } from './routes/books'
import { reportsRoutes } from './routes/reports'
import { notifyRoutes } from './routes/notify'
import { authMiddleware } from './middleware/auth'
import { tenantMiddleware } from './middleware/tenant'
import { rateLimiter } from './middleware/rateLimiter'

const app = new Hono()

// Global middleware
app.use('*', logger())
app.use('*', prettyJSON())
app.use('*', cors({
  origin: [process.env.FRONTEND_URL || 'http://localhost:3000'],
  credentials: true,
}))
app.use('/api/*', rateLimiter())

// Health check
app.get('/health', (c) => c.json({ status: 'ok', version: '2.0.0', service: 'Zomeo.ai API' }))
app.get('/', (c) => c.json({ status: 'ok', version: '2.0.0', service: 'Zomeo.ai API' }))

// Public routes (no auth required)
app.route('/api/auth', authRoutes)
app.route('/api/repertory-upload', repertoryUploadRoutes)

// Protected routes
app.use('/api/*', authMiddleware)
app.use('/api/*', tenantMiddleware)

app.route('/api/patients', patientsRoutes)
app.route('/api/cases', casesRoutes)
app.route('/api/repertory', repertoryRoutes)
app.route('/api/analysis', analysisRoutes)
app.route('/api/analysis/v2', analysisV2Routes)
app.route('/api/prescriptions', prescriptionsRoutes)
app.route('/api/followups', followupsRoutes)
app.route('/api/remedies', remediesRoutes)
app.route('/api/appointments', appointmentsRoutes)
app.route('/api/books', booksRoutes)
app.route('/api/reports', reportsRoutes)
app.route('/api/ai', aiRoutes)
app.route('/api/billing', billingRoutes)
app.route('/api/notify', notifyRoutes)
app.route('/api/admin', adminRoutes)
app.route('/api/upload', uploadRoutes)

// 404 handler
app.notFound((c) => c.json({ error: 'Not found' }, 404))

// Error handler
app.onError((err, c) => {
  console.error('[Zomeo.ai] Unhandled error:', err)
  return c.json({ error: 'Internal server error', message: err.message }, 500)
})

const port = Number(process.env.PORT) || 3001
console.log(`Zomeo.ai API running on port ${port}`)

serve({ fetch: app.fetch, port })

export default app
