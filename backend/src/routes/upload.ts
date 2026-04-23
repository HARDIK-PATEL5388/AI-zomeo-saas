// Zomeo.ai — Upload Routes
// Multi-file TAB upload, validation, and import pipeline for Complete Repertory

import { Hono } from 'hono'
import { createClient } from '@supabase/supabase-js'
import { validateAllFiles, getRequiredFiles } from '../services/tabValidator'
import { runImportPipeline, IMPORT_ORDER } from '../services/tabImporter'
import { db } from '../db/client'

export const uploadRoutes = new Hono()

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// In-memory progress store (for SSE streaming)
const jobProgress = new Map<string, Array<{ step: string; message: string; time: string }>>()

// GET /api/upload/required-files — list required files for a repertory type
uploadRoutes.get('/required-files', (c) => {
  return c.json({
    files: getRequiredFiles(),
    importOrder: IMPORT_ORDER,
    notes: 'All files must be Windows-1252 encoded TAB-delimited files.',
  })
})

// POST /api/upload/validate — validate uploaded TAB files without importing
uploadRoutes.post('/validate', async (c) => {
  const formData = await c.req.formData()
  const files = new Map<string, Buffer>()

  // Collect all uploaded files
  for (const [key, value] of formData.entries()) {
    if (value instanceof File) {
      const arrayBuf = await value.arrayBuffer()
      files.set(value.name, Buffer.from(arrayBuf))
    }
  }

  if (files.size === 0) {
    return c.json({ error: 'No files uploaded' }, 400)
  }

  const result = await validateAllFiles(files)
  return c.json({
    valid: result.ok,
    fileCount: files.size,
    filesReceived: Array.from(files.keys()),
    issues: result.issues,
  })
})

// POST /api/upload/start — validate + create job + start import
uploadRoutes.post('/start', async (c) => {
  const formData = await c.req.formData()
  const sourceId = formData.get('sourceId') as string
  const year = parseInt(formData.get('year') as string) || new Date().getFullYear()
  const versionTag = (formData.get('versionTag') as string) || 'v1'

  if (!sourceId) {
    return c.json({ error: 'sourceId is required' }, 400)
  }

  // Collect all uploaded files
  const files = new Map<string, Buffer>()
  for (const [key, value] of formData.entries()) {
    if (value instanceof File && value.name.endsWith('.tab')) {
      const arrayBuf = await value.arrayBuffer()
      files.set(value.name, Buffer.from(arrayBuf))
    }
  }

  if (files.size === 0) {
    return c.json({ error: 'No .tab files uploaded' }, 400)
  }

  // Step 1: Validate all files
  const validation = await validateAllFiles(files)
  if (!validation.ok) {
    return c.json({
      error: 'Validation failed',
      issues: validation.issues,
    }, 422)
  }

  // Step 2: Create upload job
  const user = c.get('user')
  const { data: job, error: jobErr } = await supabase
    .from('upload_jobs')
    .insert({
      source_id: sourceId,
      version_tag: versionTag,
      year,
      status: 'validated',
      file_names: Array.from(files.keys()),
      validation_result: { ok: true, fileCount: files.size },
      created_by: user?.userId,
    })
    .select()
    .single()

  if (jobErr || !job) {
    return c.json({ error: 'Failed to create upload job', details: jobErr?.message }, 500)
  }

  // Step 3: Start import in background (don't block HTTP response)
  const jobId = job.id
  jobProgress.set(jobId, [])

  // Run import asynchronously
  setImmediate(async () => {
    try {
      await supabase
        .from('upload_jobs')
        .update({ status: 'importing' })
        .eq('id', jobId)

      const summary = await runImportPipeline(
        files,
        sourceId,
        jobId,
        (step, message) => {
          const logs = jobProgress.get(jobId) || []
          logs.push({ step, message, time: new Date().toISOString() })
          jobProgress.set(jobId, logs)
          console.log(`[Upload ${jobId}] ${step}: ${message}`)
        }
      )

      const hasFailed = summary.some(s => s.status === 'FAILED')
      await supabase
        .from('upload_jobs')
        .update({
          status: hasFailed ? 'failed' : 'done',
          import_summary: summary,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId)
    } catch (err: any) {
      console.error(`[Upload ${jobId}] Fatal error:`, err)
      await supabase
        .from('upload_jobs')
        .update({
          status: 'failed',
          import_summary: { error: err.message },
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId)
    }
  })

  return c.json({
    message: 'Upload accepted, import started in background',
    jobId,
    filesReceived: Array.from(files.keys()),
  }, 202)
})

// GET /api/upload/jobs — list all upload jobs
uploadRoutes.get('/jobs', async (c) => {
  const { data, error } = await supabase
    .from('upload_jobs')
    .select('*, repertory_sources(name)')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return c.json({ error: error.message }, 500)
  return c.json(data)
})

// GET /api/upload/jobs/:id — get job details
uploadRoutes.get('/jobs/:id', async (c) => {
  const { data, error } = await supabase
    .from('upload_jobs')
    .select('*')
    .eq('id', c.req.param('id'))
    .single()

  if (error) return c.json({ error: error.message }, 404)

  // Attach in-memory progress logs
  const logs = jobProgress.get(data.id) || []

  return c.json({ ...data, logs })
})

// GET /api/upload/jobs/:id/progress — SSE stream for live progress
uploadRoutes.get('/jobs/:id/progress', async (c) => {
  const jobId = c.req.param('id')

  return new Response(
    new ReadableStream({
      start(controller) {
        let lastSent = 0
        const encoder = new TextEncoder()

        const interval = setInterval(async () => {
          const logs = jobProgress.get(jobId) || []

          // Send new log entries
          for (let i = lastSent; i < logs.length; i++) {
            const data = JSON.stringify(logs[i])
            controller.enqueue(encoder.encode(`data: ${data}\n\n`))
          }
          lastSent = logs.length

          // Check if job is done
          const { data: job } = await supabase
            .from('upload_jobs')
            .select('status, import_summary')
            .eq('id', jobId)
            .single()

          if (job && (job.status === 'done' || job.status === 'failed')) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'complete', status: job.status, summary: job.import_summary })}\n\n`)
            )
            clearInterval(interval)
            controller.close()
          }
        }, 1000)
      },
    }),
    {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    }
  )
})

// GET /api/upload/history — file import history
uploadRoutes.get('/history', async (c) => {
  const { data, error } = await supabase
    .from('file_versions')
    .select('*')
    .order('imported_at', { ascending: false })
    .limit(100)

  if (error) return c.json({ error: error.message }, 500)
  return c.json(data)
})

// GET /api/upload/sources — list available repertory sources (Kysely → local mydb)
uploadRoutes.get('/sources', async (c) => {
  try {
    const data = await db
      .selectFrom('repertory_sources')
      .select(['id', 'name', 'slug', 'publisher', 'is_active'])
      .where('is_active', '=', true)
      .orderBy('name')
      .execute()
    return c.json(data)
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})
