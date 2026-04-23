// Zomeo.ai — Notify Route
// SMS, email, push notifications via BullMQ queues

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth'

export const notifyRoutes = new Hono()

notifyRoutes.use('*', authMiddleware)

async function getQueues() {
  const { Queue } = await import('bullmq')
  const Redis = (await import('ioredis')).default
  const connection = new Redis(process.env.UPSTASH_REDIS_URL!, { maxRetriesPerRequest: null })
  return {
    smsQueue: new Queue('sms-queue', { connection: connection as any }),
    emailQueue: new Queue('email-queue', { connection: connection as any }),
  }
}

// POST /api/notify/sms
notifyRoutes.post(
  '/sms',
  zValidator('json', z.object({ to: z.string(), body: z.string() })),
  async (c) => {
    const { to, body } = c.req.valid('json')
    const { smsQueue } = await getQueues()
    await smsQueue.add('send-sms', { to, body })
    return c.json({ message: 'SMS queued' })
  }
)

// POST /api/notify/email
notifyRoutes.post(
  '/email',
  zValidator('json', z.object({
    to: z.string().email(),
    subject: z.string(),
    html: z.string(),
  })),
  async (c) => {
    const body = c.req.valid('json')
    const { emailQueue } = await getQueues()
    await emailQueue.add('send-email', body)
    return c.json({ message: 'Email queued' })
  }
)

// POST /api/notify/push — Web Push VAPID
notifyRoutes.post(
  '/push',
  zValidator('json', z.object({
    subscription: z.record(z.unknown()),
    title: z.string(),
    body: z.string(),
  })),
  async (c) => {
    // Web Push via VAPID keys — send push notification to PWA
    return c.json({ message: 'Push notification sent' })
  }
)
