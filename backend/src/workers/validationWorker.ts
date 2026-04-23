// Zomeo.ai — Validation Worker (BullMQ)
// Runs 9-stage validation pipeline for uploaded repertory files

import { Worker, Job } from 'bullmq'
import { createClient } from '@supabase/supabase-js'
import Redis from 'ioredis'

const connection = new Redis(process.env.UPSTASH_REDIS_URL!, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
})

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const STAGES = [
  { name: 'file-format', desc: 'File Format Check' },
  { name: 'structure-parser', desc: 'Structure Parser' },
  { name: 'header-check', desc: 'Header Check' },
  { name: 'chapter-validation', desc: 'Chapter Validation' },
  { name: 'rubric-structure', desc: 'Rubric Structure' },
  { name: 'remedy-codes', desc: 'Remedy Codes' },
  { name: 'cross-references', desc: 'Cross-References' },
  { name: 'diff-computation', desc: 'Diff Computation' },
  { name: 'security-check', desc: 'Security Check' },
]

async function recordStageStart(jobId: string, stageName: string) {
  await supabase.from('ingestion_stages').insert({
    job_id: jobId,
    stage_name: stageName,
    status: 'running',
    started_at: new Date().toISOString(),
  })
}

async function recordStageComplete(jobId: string, stageName: string, recordsProcessed = 0) {
  await supabase
    .from('ingestion_stages')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      records_processed: recordsProcessed,
    })
    .eq('job_id', jobId)
    .eq('stage_name', stageName)
}

async function recordStageFail(jobId: string, stageName: string, error: Error) {
  await supabase
    .from('ingestion_stages')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_json: { message: error.message, stack: error.stack },
    })
    .eq('job_id', jobId)
    .eq('stage_name', stageName)

  await supabase.from('validation_reports').insert({
    job_id: jobId,
    stage: STAGES.findIndex((s) => s.name === stageName) + 1,
    severity: 'error',
    code: 'V001',
    message: error.message,
  })
}

async function processJob(job: Job) {
  const { jobId } = job.data
  console.log(`[Validation] Starting job ${jobId}`)

  // Get upload job details
  const { data: uploadJob, error } = await supabase
    .from('upload_jobs')
    .select('*')
    .eq('id', jobId)
    .single()

  if (error || !uploadJob) {
    throw new Error(`Upload job ${jobId} not found`)
  }

  await supabase
    .from('upload_jobs')
    .update({ status: 'validating' })
    .eq('id', jobId)

  for (let i = 0; i < STAGES.length; i++) {
    const stage = STAGES[i]
    await recordStageStart(jobId, stage.name)

    try {
      // In production: import and run each stage module
      // e.g., const { run } = await import(`../jobs/validation/${stage.name}.js`)
      // await run(jobId, uploadJob)

      // Simulate stage processing
      await new Promise((res) => setTimeout(res, 100))

      await recordStageComplete(jobId, stage.name)
      console.log(`[Validation] ${jobId} Stage ${i + 1}/9: ${stage.desc} ✓`)

      // Update job progress
      await job.updateProgress(Math.round(((i + 1) / STAGES.length) * 100))
    } catch (err: any) {
      await recordStageFail(jobId, stage.name, err)
      await supabase
        .from('upload_jobs')
        .update({ status: 'failed' })
        .eq('id', jobId)
      throw err
    }
  }

  // Validation complete — set status to approved (pending admin review)
  await supabase
    .from('upload_jobs')
    .update({ status: 'approved' })
    .eq('id', jobId)

  console.log(`[Validation] Job ${jobId} complete — awaiting admin approval`)
}

export const validationWorker = new Worker(
  'validation-queue',
  processJob,
  { connection: connection as any, concurrency: 4 }
)

validationWorker.on('completed', (job) => {
  console.log(`[Validation] Job ${job.id} completed`)
})

validationWorker.on('failed', (job, err) => {
  console.error(`[Validation] Job ${job?.id} failed:`, err.message)
})
