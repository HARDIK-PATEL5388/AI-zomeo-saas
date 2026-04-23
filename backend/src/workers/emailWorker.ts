// Zomeo.ai — Email Worker (BullMQ)
// Sends transactional emails via Resend.com

import { Worker, Job } from 'bullmq'
import Redis from 'ioredis'

const connection = new Redis(process.env.UPSTASH_REDIS_URL!, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
})

interface EmailJob {
  to: string
  subject: string
  html: string
  from?: string
}

async function sendEmail(job: Job<EmailJob>) {
  const { to, subject, html, from = 'Zomeo.ai <noreply@zomeo.ai>' } = job.data

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html }),
  })

  if (!response.ok) {
    const err = await response.json()
    throw new Error(`Resend error: ${JSON.stringify(err)}`)
  }

  const data = await response.json()
  console.log(`[Email] Sent to ${to}: ${data.id}`)
}

export const emailWorker = new Worker('email-queue', sendEmail, {
  connection: connection as any,
  concurrency: 2,
})

emailWorker.on('failed', (job, err) =>
  console.error(`[Email] Job ${job?.id} failed:`, err.message)
)
