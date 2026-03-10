import { createSubscriptionSession, createBillingPortalSession, getUserSubscription, getOrCreateCustomer } from '@/lib/stripe-subscriptions';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// GET /api/billing — get current subscription status
export async function GET(req) {
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single();

  const subscription = await getUserSubscription(profile?.stripe_customer_id);

  return Response.json({
    subscription: subscription ? {
      id: subscription.id,
      status: subscription.status,
      priceId: subscription.items.data[0]?.price.id,
      currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    } : null,
  });
}

// POST /api/billing — { action: 'subscribe'|'portal', priceId? }
export async function POST(req) {
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { action, priceId } = await req.json();
  const origin = req.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL;

  if (action === 'subscribe') {
    const session = await createSubscriptionSession({
      userId: user.id,
      email: user.email,
      name: user.user_metadata?.full_name,
      priceId,
      successUrl: `${origin}/dashboard?subscribed=true`,
      cancelUrl: `${origin}/pricing`,
    });
    return Response.json({ url: session.url });
  }

  if (action === 'portal') {
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();
    const customer = await getOrCreateCustomer(user.id, user.email, user.user_metadata?.full_name);
    const session = await createBillingPortalSession(customer.id, `${origin}/dashboard`);
    return Response.json({ url: session.url });
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 });
}
