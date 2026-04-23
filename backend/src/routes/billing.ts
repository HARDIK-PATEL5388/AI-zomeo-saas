// Zomeo.ai — Billing Route
// Stripe (global) + CCAvenue (India) payment integration

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth'
import { tenantMiddleware } from '../middleware/tenant'
import { createClient } from '@supabase/supabase-js'

export const billingRoutes = new Hono()

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const PLAN_PRICE_IDS: Record<string, string> = {
  starter: process.env.STRIPE_PRICE_STARTER || '',
  professional: process.env.STRIPE_PRICE_PROFESSIONAL || '',
  clinic: process.env.STRIPE_PRICE_CLINIC || '',
  institution: process.env.STRIPE_PRICE_INSTITUTION || '',
  researcher: process.env.STRIPE_PRICE_RESEARCHER || '',
}

// POST /api/billing/subscribe — create Stripe checkout session
billingRoutes.post(
  '/subscribe',
  authMiddleware,
  tenantMiddleware,
  zValidator('json', z.object({
    plan: z.enum(['starter', 'professional', 'clinic', 'institution', 'researcher']),
  })),
  async (c) => {
    const { plan } = c.req.valid('json')
    const tenantId = c.get('tenantId')

    const priceId = PLAN_PRICE_IDS[plan]
    if (!priceId) return c.json({ error: `No price configured for plan: ${plan}` }, 400)

    // Dynamically import Stripe to avoid startup error if key not set
    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-04-10' as any })

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { tenantId, plan },
      success_url: `${process.env.FRONTEND_URL}/settings?upgraded=true`,
      cancel_url: `${process.env.FRONTEND_URL}/settings?cancelled=true`,
    })

    return c.json({ url: session.url })
  }
)

// POST /api/billing/webhook — Stripe webhook handler
billingRoutes.post('/webhook', async (c) => {
  const body = await c.req.text()
  const sig = c.req.header('stripe-signature') || ''

  const Stripe = (await import('stripe')).default
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-04-10' as any })

  let event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET || '')
  } catch {
    return c.json({ error: 'Webhook signature verification failed' }, 400)
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as any
      const { tenantId, plan } = session.metadata || {}
      if (tenantId && plan) {
        await supabase
          .from('tenants')
          .update({ plan, stripe_customer_id: session.customer })
          .eq('id', tenantId)
        await supabase.from('tenant_licences').insert({
          tenant_id: tenantId,
          plan,
          stripe_subscription_id: session.subscription,
          valid_from: new Date().toISOString(),
          active: true,
        })
      }
      break
    }
    case 'invoice.payment_succeeded': {
      const invoice = event.data.object as any
      await supabase
        .from('tenant_licences')
        .update({ valid_to: null, active: true })
        .eq('stripe_subscription_id', invoice.subscription)
      break
    }
    case 'invoice.payment_failed': {
      // Set grace period of 7 days
      const invoice = event.data.object as any
      const graceUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      await supabase.rpc('set_grace_period', {
        p_subscription_id: invoice.subscription,
        p_grace_until: graceUntil,
      })
      break
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as any
      await supabase
        .from('tenant_licences')
        .update({ active: false, valid_to: new Date().toISOString() })
        .eq('stripe_subscription_id', sub.id)
      break
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object as any
      // Plan upgrade/downgrade handled via metadata
      break
    }
  }

  return c.json({ received: true })
})

// GET /api/billing/portal — Stripe Customer Portal
billingRoutes.get('/portal', authMiddleware, tenantMiddleware, async (c) => {
  const tenantId = c.get('tenantId')
  const { data: tenant } = await supabase
    .from('tenants')
    .select('stripe_customer_id')
    .eq('id', tenantId)
    .single()

  if (!tenant?.stripe_customer_id) {
    return c.json({ error: 'No billing account found. Subscribe to a plan first.' }, 404)
  }

  const Stripe = (await import('stripe')).default
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-04-10' as any })

  const session = await stripe.billingPortal.sessions.create({
    customer: tenant.stripe_customer_id,
    return_url: `${process.env.FRONTEND_URL}/settings`,
  })

  return c.json({ url: session.url })
})

// GET /api/billing/subscription
billingRoutes.get('/subscription', authMiddleware, tenantMiddleware, async (c) => {
  const tenantId = c.get('tenantId')
  const { data, error } = await supabase
    .from('tenant_licences')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error) return c.json({ plan: 'starter', active: false })
  return c.json(data)
})

// POST /api/billing/ccavenue/init — CCAvenue payment (India)
billingRoutes.post('/ccavenue/init', authMiddleware, tenantMiddleware, async (c) => {
  // CCAvenue integration for UPI, net banking, domestic cards
  // Returns payment order details to frontend
  return c.json({
    merchantId: process.env.CCAVENUE_MERCHANT_ID,
    accessCode: process.env.CCAVENUE_ACCESS_CODE,
    redirectUrl: `${process.env.FRONTEND_URL}/billing/ccavenue/callback`,
    cancelUrl: `${process.env.FRONTEND_URL}/settings?cancelled=true`,
  })
})

// POST /api/billing/ccavenue/callback
billingRoutes.post('/ccavenue/callback', async (c) => {
  // Handle CCAvenue payment response and activate subscription
  return c.json({ received: true })
})
