// Stripe recurring subscriptions — create customer, subscribe, manage plans
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Create or retrieve Stripe customer for a user
export async function getOrCreateCustomer(userId, email, name) {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', userId)
    .single();

  if (profile?.stripe_customer_id) {
    return stripe.customers.retrieve(profile.stripe_customer_id);
  }

  const customer = await stripe.customers.create({ email, name, metadata: { userId } });

  await supabase
    .from('profiles')
    .update({ stripe_customer_id: customer.id })
    .eq('id', userId);

  return customer;
}

// Create a Stripe Checkout session for a subscription
export async function createSubscriptionSession({ userId, email, name, priceId, successUrl, cancelUrl }) {
  const customer = await getOrCreateCustomer(userId, email, name);
  const session = await stripe.checkout.sessions.create({
    customer: customer.id,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { userId },
    subscription_data: { metadata: { userId } },
    allow_promotion_codes: true,
  });
  return session;
}

// Create a Billing Portal session so user can manage/cancel
export async function createBillingPortalSession(customerId, returnUrl) {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return session;
}

// Get active subscription for a user
export async function getUserSubscription(stripeCustomerId) {
  if (!stripeCustomerId) return null;
  const subs = await stripe.subscriptions.list({
    customer: stripeCustomerId,
    status: 'active',
    limit: 1,
  });
  return subs.data[0] || null;
}

// Handle webhook events to keep DB in sync
export async function handleWebhook(event) {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const handlers = {
    'customer.subscription.created': syncSubscription,
    'customer.subscription.updated': syncSubscription,
    'customer.subscription.deleted': cancelSubscription,
    'invoice.payment_succeeded': recordPayment,
    'invoice.payment_failed': recordFailedPayment,
  };

  const handler = handlers[event.type];
  if (handler) await handler(event.data.object, supabase);
}

async function syncSubscription(sub, supabase) {
  const userId = sub.metadata?.userId;
  if (!userId) return;
  await supabase.from('subscriptions').upsert({
    user_id: userId,
    stripe_subscription_id: sub.id,
    stripe_customer_id: sub.customer,
    status: sub.status,
    price_id: sub.items.data[0]?.price.id,
    current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
    current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
    cancel_at_period_end: sub.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
}

async function cancelSubscription(sub, supabase) {
  await supabase
    .from('subscriptions')
    .update({ status: 'canceled', updated_at: new Date().toISOString() })
    .eq('stripe_subscription_id', sub.id);
}

async function recordPayment(invoice, supabase) {
  await supabase.from('payments').insert({
    stripe_invoice_id: invoice.id,
    stripe_customer_id: invoice.customer,
    amount: invoice.amount_paid,
    currency: invoice.currency,
    status: 'paid',
    paid_at: new Date(invoice.status_transitions.paid_at * 1000).toISOString(),
  });
}

async function recordFailedPayment(invoice, supabase) {
  await supabase.from('payments').insert({
    stripe_invoice_id: invoice.id,
    stripe_customer_id: invoice.customer,
    amount: invoice.amount_due,
    currency: invoice.currency,
    status: 'failed',
  });
}
