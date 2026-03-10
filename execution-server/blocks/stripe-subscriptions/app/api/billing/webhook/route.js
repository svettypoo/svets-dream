import { handleWebhook } from '@/lib/stripe-subscriptions';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function POST(req) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return Response.json({ error: `Webhook signature failed: ${err.message}` }, { status: 400 });
  }

  try {
    await handleWebhook(event);
    return Response.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    return Response.json({ error: 'Webhook handler failed' }, { status: 500 });
  }
}
