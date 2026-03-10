'use client'
import { useState } from 'react'
import { Calendar, Users, CreditCard, Check } from 'lucide-react'
import DateRangePicker from './DateRangePicker'

export default function BookingForm({ listing, onSuccess }) {
  const [step, setStep] = useState(1) // 1=dates, 2=guests, 3=confirm
  const [checkIn, setCheckIn] = useState(null)
  const [checkOut, setCheckOut] = useState(null)
  const [guests, setGuests] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const nights = checkIn && checkOut
    ? Math.max(1, Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000))
    : 0

  const pricePerNight = listing?.price_per_night || 0
  const subtotal = nights * pricePerNight
  const serviceFee = Math.round(subtotal * 0.12)
  const total = subtotal + serviceFee

  async function handleBook() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listing_id: listing.id,
          check_in: checkIn,
          check_out: checkOut,
          guests,
          total_price: total,
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      onSuccess?.(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card space-y-5">
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold text-gray-900">${pricePerNight}</span>
        <span className="text-gray-500 text-sm">/ night</span>
      </div>

      {/* Date picker */}
      <div>
        <label className="label flex items-center gap-1"><Calendar size={13} /> Dates</label>
        <DateRangePicker
          checkIn={checkIn} checkOut={checkOut}
          onSelect={(ci, co) => { setCheckIn(ci); setCheckOut(co) }}
          blockedDates={listing?.blocked_dates || []}
        />
      </div>

      {/* Guests */}
      <div>
        <label className="label flex items-center gap-1"><Users size={13} /> Guests</label>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setGuests(g => Math.max(1, g - 1))} className="btn btn-secondary px-3">−</button>
          <span className="font-semibold w-8 text-center">{guests}</span>
          <button type="button" onClick={() => setGuests(g => Math.min(listing?.max_guests || 10, g + 1))} className="btn btn-secondary px-3">+</button>
          <span className="text-sm text-gray-400">max {listing?.max_guests || 10}</span>
        </div>
      </div>

      {/* Price breakdown */}
      {nights > 0 && (
        <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
          <div className="flex justify-between text-gray-700">
            <span>${pricePerNight} × {nights} nights</span>
            <span>${subtotal}</span>
          </div>
          <div className="flex justify-between text-gray-700">
            <span>Service fee (12%)</span>
            <span>${serviceFee}</span>
          </div>
          <div className="border-t border-gray-200 pt-2 flex justify-between font-bold text-gray-900">
            <span>Total</span>
            <span>${total}</span>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        onClick={handleBook}
        disabled={!checkIn || !checkOut || loading}
        className="btn btn-primary w-full text-base py-3"
      >
        <CreditCard size={16} className="mr-2" />
        {loading ? 'Booking…' : nights > 0 ? `Reserve for $${total}` : 'Select dates to book'}
      </button>

      <p className="text-xs text-gray-400 text-center">You won't be charged yet. Free cancellation for 48 hours.</p>
    </div>
  )
}
