// Zomeo.ai — Embedding Worker (BullMQ)
// Generates OpenAI text-embedding-3-small vectors for rubrics in batches of 100

import { Worker, Job } from 'bullmq'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import Redis from 'ioredis'

const connection = new Redis(process.env.UPSTASH_REDIS_URL!, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
})

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const BATCH_SIZE = 100
const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIM = 1536

async function processEmbeddings(job: Job) {
  const { jobId, versionId } = job.data
  console.log(`[Embedding] Starting for job ${jobId}`)

  let offset = 0
  let totalProcessed = 0

  while (true) {
    // Fetch rubrics without embeddings for this version
    const { data: rubrics, error } = await supabase
      .from('rubrics')
      .select('id, symptom_text, chapters(name)')
      .eq('version_id', versionId)
      .is('embedding', null)
      .range(offset, offset + BATCH_SIZE - 1)

    if (error) throw error
    if (!rubrics || rubrics.length === 0) break

    // Build text input: "Chapter name: Rubric symptom text"
    const texts = rubrics.map((r: any) =>
      `${r.chapters?.name ? r.chapters.name + ': ' : ''}${r.symptom_text}`
    )

    // Batch call OpenAI embeddings API
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIM,
    })

    // Update each rubric with its embedding
    await Promise.all(
      rubrics.map((r: any, idx: number) =>
        supabase
          .from('rubrics')
          .update({ embedding: response.data[idx].embedding })
          .eq('id', r.id)
      )
    )

    totalProcessed += rubrics.length
    offset += BATCH_SIZE

    await job.updateProgress(Math.round((totalProcessed / (totalProcessed + BATCH_SIZE)) * 100))
    console.log(`[Embedding] Job ${jobId}: ${totalProcessed} rubrics embedded`)

    // Brief pause to avoid rate limits
    if (rubrics.length === BATCH_SIZE) {
      await new Promise((res) => setTimeout(res, 200))
    }
  }

  console.log(`[Embedding] Job ${jobId} complete — ${totalProcessed} rubrics embedded`)

  // Queue notification after embeddings done
  const { Queue } = await import('bullmq')
  const notificationQueue = new Queue('notification-queue', { connection: connection as any })
  await notificationQueue.add('notify-doctors', { jobId })
}

export const embeddingWorker = new Worker(
  'embedding-queue',
  processEmbeddings,
  { connection: connection as any, concurrency: 8 }
)

embeddingWorker.on('completed', (job) =>
  console.log(`[Embedding] Job ${job.id} completed`)
)

embeddingWorker.on('failed', (job, err) =>
  console.error(`[Embedding] Job ${job?.id} failed:`, err.message)
)
