// SMART: replace APP_NAME, PRICING_TIERS with config values

const TIERS = [
  {
    name: 'Free',
    price: 0,
    period: 'forever',
    desc: 'Perfect for getting started',
    features: ['Up to 3 projects', 'Basic analytics', 'Community support', '1 team member'],
    cta: 'Start for free',
    href: '/signup',
    highlight: false,
  },
  {
    name: 'Pro',
    price: 29,
    period: 'month',
    desc: 'For growing teams',
    features: ['Unlimited projects', 'Advanced analytics', 'Priority support', 'Up to 10 team members', 'Custom domain', 'API access'],
    cta: 'Start 14-day trial',
    href: '/signup?plan=pro',
    highlight: true,
  },
  {
    name: 'Enterprise',
    price: null,
    period: null,
    desc: 'For large organizations',
    features: ['Everything in Pro', 'Unlimited team members', 'Dedicated support', 'SLA guarantee', 'Custom integrations', 'SSO / SAML'],
    cta: 'Contact sales',
    href: '/contact',
    highlight: false,
  },
]

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-20">
        <div className="text-center mb-14">
          <h1 className="text-4xl font-bold text-gray-900 mb-3">Simple, transparent pricing</h1>
          <p className="text-xl text-gray-500">No hidden fees. Cancel anytime.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
          {TIERS.map(tier => (
            <div key={tier.name} className={`rounded-2xl p-8 ${tier.highlight ? 'bg-brand-600 text-white shadow-xl ring-2 ring-brand-600 scale-105' : 'bg-white border border-gray-200 shadow-sm'}`}>
              <h2 className={`text-lg font-bold mb-1 ${tier.highlight ? 'text-white' : 'text-gray-900'}`}>{tier.name}</h2>
              <p className={`text-sm mb-4 ${tier.highlight ? 'text-brand-100' : 'text-gray-500'}`}>{tier.desc}</p>
              <div className="mb-6">
                {tier.price === null ? (
                  <span className={`text-3xl font-bold ${tier.highlight ? 'text-white' : 'text-gray-900'}`}>Custom</span>
                ) : (
                  <>
                    <span className={`text-4xl font-bold ${tier.highlight ? 'text-white' : 'text-gray-900'}`}>${tier.price}</span>
                    {tier.period && <span className={`text-sm ml-1 ${tier.highlight ? 'text-brand-100' : 'text-gray-500'}`}>/{tier.period}</span>}
                  </>
                )}
              </div>
              <ul className="space-y-3 mb-8">
                {tier.features.map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <span className={tier.highlight ? 'text-brand-200' : 'text-green-500'}>✓</span>
                    <span className={tier.highlight ? 'text-brand-50' : 'text-gray-600'}>{f}</span>
                  </li>
                ))}
              </ul>
              <a href={tier.href} className={`block text-center font-semibold py-3 px-6 rounded-xl transition ${tier.highlight ? 'bg-white text-brand-600 hover:bg-brand-50' : 'bg-brand-600 text-white hover:bg-brand-700'}`}>
                {tier.cta}
              </a>
            </div>
          ))}
        </div>

        <div className="mt-16 text-center">
          <p className="text-gray-500 mb-4">All plans include a 30-day money-back guarantee</p>
          <p className="text-sm text-gray-400">Questions? <a href="/contact" className="text-brand-600 hover:underline">Talk to us</a></p>
        </div>
      </div>
    </div>
  )
}
