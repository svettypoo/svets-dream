// Stripe Connect — marketplace payments (platform charges, host payouts)
// Requires STRIPE_SECRET_KEY in env

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)

// Create a connected account for a new host
export async function createConnectedAccount({ email, country = 'US' }) {
  const account = await stripe.accounts.create({
    type: 'express',
    email,
    country,
    capabilities: { transfers: { requested: true }, card_payments: { requested: true } },
  })
  return account
}

// Get onboarding link for a connected account
export async function getOnboardingLink({ accountId, returnUrl, refreshUrl }) {
  const link = await stripe.accountLinks.create({
    account: accountId,
    return_url: returnUrl,
    refresh_url: refreshUrl,
    type: 'account_onboarding',
  })
  return link.url
}

// Charge a guest and transfer to host (minus platform fee)
// amountCents: total in cents, hostAccountId: Stripe connected account ID
export async function createPaymentIntent({ amountCents, currency = 'usd', hostAccountId, platformFeePercent = 10, metadata = {} }) {
  const platformFee = Math.round(amountCents * (platformFeePercent / 100))
  const intent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency,
    application_fee_amount: platformFee,
    transfer_data: { destination: hostAccountId },
    metadata,
  })
  return intent
}

// Retrieve connected account status
export async function getAccountStatus(accountId) {
  const account = await stripe.accounts.retrieve(accountId)
  return {
    id: account.id,
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    detailsSubmitted: account.details_submitted,
    email: account.email,
  }
}

// Create a payout to a connected account's bank
export async function createPayout({ accountId, amountCents, currency = 'usd' }) {
  const payout = await stripe.payouts.create(
    { amount: amountCents, currency },
    { stripeAccount: accountId }
  )
  return payout
}
