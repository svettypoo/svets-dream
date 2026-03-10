'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

// PLAN_PRICES: map priceId → display label. Override in app config.
const DEFAULT_PLANS = [
  { id: 'price_starter', name: 'Starter', price: '$9', period: '/mo', features: ['5 projects', '10GB storage', 'Email support'] },
  { id: 'price_pro', name: 'Pro', price: '$29', period: '/mo', features: ['Unlimited projects', '100GB storage', 'Priority support', 'Custom domain'], highlight: true },
  { id: 'price_business', name: 'Business', price: '$99', period: '/mo', features: ['Everything in Pro', 'Team seats', 'SLA', 'Dedicated support'] },
];

export default function SubscriptionStatus({ plans = DEFAULT_PLANS, session }) {
  const router = useRouter();
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (!session?.access_token) { setLoading(false); return; }
    fetch('/api/billing', { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(r => r.json())
      .then(d => { setSubscription(d.subscription); setLoading(false); });
  }, [session]);

  async function subscribe(priceId) {
    setActionLoading(true);
    const res = await fetch('/api/billing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action: 'subscribe', priceId }),
    });
    const data = await res.json();
    if (data.url) window.location.href = data.url;
    setActionLoading(false);
  }

  async function openPortal() {
    setActionLoading(true);
    const res = await fetch('/api/billing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action: 'portal' }),
    });
    const data = await res.json();
    if (data.url) window.location.href = data.url;
    setActionLoading(false);
  }

  if (loading) return <div className="p-6 text-center text-gray-400">Loading...</div>;

  if (subscription?.status === 'active') {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-green-500 rounded-full"></span>
              <span className="font-semibold text-green-800">Active Subscription</span>
            </div>
            <p className="text-sm text-green-700 mt-1">
              Renews {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
              {subscription.cancelAtPeriodEnd && ' · Cancels at period end'}
            </p>
          </div>
          <button
            onClick={openPortal}
            disabled={actionLoading}
            className="px-4 py-2 bg-white border border-green-300 text-green-700 rounded-lg text-sm font-medium hover:bg-green-50 disabled:opacity-50"
          >
            Manage Billing
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {plans.map(plan => (
        <div
          key={plan.id}
          className={`rounded-xl border p-6 flex flex-col ${plan.highlight ? 'border-blue-500 ring-2 ring-blue-500 bg-blue-50' : 'border-gray-200 bg-white'}`}
        >
          {plan.highlight && (
            <div className="text-xs font-bold text-blue-600 uppercase tracking-wide mb-2">Most Popular</div>
          )}
          <div className="text-lg font-bold text-gray-900">{plan.name}</div>
          <div className="mt-1 mb-4">
            <span className="text-3xl font-extrabold text-gray-900">{plan.price}</span>
            <span className="text-gray-500">{plan.period}</span>
          </div>
          <ul className="space-y-2 flex-1 mb-6">
            {plan.features.map(f => (
              <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {f}
              </li>
            ))}
          </ul>
          <button
            onClick={() => subscribe(plan.id)}
            disabled={actionLoading}
            className={`w-full py-2 rounded-lg font-medium text-sm disabled:opacity-50 ${plan.highlight ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            Get Started
          </button>
        </div>
      ))}
    </div>
  );
}
