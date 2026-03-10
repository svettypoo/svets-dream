import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-11-20.acacia' })

export default stripe

// Helpers
export async function createPaymentIntent(amount, currency = 'usd', metadata = {}) {
  return stripe.paymentIntents.create({ amount, currency, metadata, automatic_payment_methods: { enabled: true } })
}

export async function constructWebhookEvent(body, sig) {
  return stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET)
}
