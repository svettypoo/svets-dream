'use client'
import { useState } from 'react'
import { CreditCard, ExternalLink, CheckCircle, AlertCircle } from 'lucide-react'

export default function ConnectOnboarding({ userId, userEmail, accountStatus }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleConnect() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/stripe/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, email: userEmail }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      window.location.href = data.url
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  if (accountStatus?.chargesEnabled && accountStatus?.payoutsEnabled) {
    return (
      <div className="card flex items-center gap-4">
        <CheckCircle className="text-green-500 flex-shrink-0" size={32} />
        <div>
          <div className="font-semibold text-gray-900">Payments enabled</div>
          <div className="text-sm text-gray-500">Your Stripe account is connected and ready to accept payouts.</div>
          <div className="text-xs text-gray-400 mt-1">Account ID: {accountStatus.id}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-3">
        <CreditCard className="text-brand-600" size={24} />
        <div>
          <h3 className="font-semibold text-gray-900">Set up payouts</h3>
          <p className="text-sm text-gray-500">Connect your bank account to receive payments from guests.</p>
        </div>
      </div>

      {accountStatus && !accountStatus.chargesEnabled && (
        <div className="flex items-start gap-2 bg-yellow-50 rounded-lg p-3">
          <AlertCircle size={16} className="text-yellow-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-yellow-700">Your account setup is incomplete. Click below to finish.</p>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button onClick={handleConnect} disabled={loading} className="btn btn-primary w-full">
        <ExternalLink size={14} className="mr-2" />
        {loading ? 'Redirecting…' : accountStatus ? 'Continue setup' : 'Connect with Stripe'}
      </button>

      <p className="text-xs text-gray-400 text-center">Powered by Stripe Express. We never store your banking details.</p>
    </div>
  )
}
