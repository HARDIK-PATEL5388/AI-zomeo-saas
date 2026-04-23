// Zomeo.ai — SMS Worker (BullMQ)
// Sends appointment reminders via Twilio

import { Worker, Job } from 'bullmq'
import Redis from 'ioredis'

const connection = new Redis(process.env.UPSTASH_REDIS_URL!, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
})

interface SMSJob {
  to: string
  body: string
}

async function sendSMS(job: Job<SMSJob>) {
  const { to, body } = job.data
  const accountSid = process.env.TWILIO_ACCOUNT_SID!
  const authToken = process.env.TWILIO_AUTH_TOKEN!
  const from = process.env.TWILIO_FROM_NUMBER!

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64')

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
  })

  if (!res.ok) {
    const err = await res.json()
    throw new Error(`Twilio error: ${JSON.stringify(err)}`)
  }

  const data = await res.json()
  console.log(`[SMS] Sent to ${to}: ${data.sid}`)
}

export const smsWorker = new Worker('sms-queue', sendSMS, {
  connection: connection as any,
  concurrency: 2,
})

smsWorker.on('failed', (job, err) =>
  console.error(`[SMS] Job ${job?.id} failed:`, err.message)
)
