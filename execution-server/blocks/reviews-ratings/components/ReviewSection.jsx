'use client'
import { useState } from 'react'
import { Star, ThumbsUp } from 'lucide-react'

function StarRating({ value, onChange, size = 20 }) {
  const [hovered, setHovered] = useState(null)
  const display = hovered ?? value
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type={onChange ? 'button' : 'button'}
          onClick={() => onChange?.(n)}
          onMouseEnter={() => onChange && setHovered(n)}
          onMouseLeave={() => onChange && setHovered(null)}
          className={onChange ? 'cursor-pointer' : 'cursor-default'}
        >
          <Star
            size={size}
            className={n <= display ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}
          />
        </button>
      ))}
    </div>
  )
}

function ReviewCard({ review }) {
  return (
    <div className="py-5 border-b border-gray-100 last:border-0">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center font-semibold text-brand-700 text-sm flex-shrink-0">
            {review.author?.[0] || '?'}
          </div>
          <div>
            <div className="font-semibold text-gray-900 text-sm">{review.author}</div>
            <div className="text-xs text-gray-400">{review.date}</div>
          </div>
        </div>
        <StarRating value={review.rating} size={14} />
      </div>
      <p className="text-sm text-gray-700 leading-relaxed">{review.body}</p>
      {review.helpful > 0 && (
        <button className="mt-2 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
          <ThumbsUp size={11} /> Helpful ({review.helpful})
        </button>
      )}
    </div>
  )
}

export default function ReviewSection({ reviews = [], averageRating, totalCount, onSubmit, canReview = false }) {
  const [showForm, setShowForm] = useState(false)
  const [rating, setRating] = useState(0)
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const breakdown = [5, 4, 3, 2, 1].map(n => ({
    star: n,
    count: reviews.filter(r => r.rating === n).length,
    pct: reviews.length ? Math.round((reviews.filter(r => r.rating === n).length / reviews.length) * 100) : 0,
  }))

  async function handleSubmit(e) {
    e.preventDefault()
    if (rating === 0) return
    setSubmitting(true)
    await onSubmit?.({ rating, body })
    setRating(0); setBody(''); setShowForm(false); setSubmitting(false)
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-2 mb-6">
        <Star size={20} className="fill-gray-900 text-gray-900" />
        <span className="text-xl font-bold text-gray-900">{averageRating?.toFixed(2) || '—'}</span>
        <span className="text-gray-500 text-sm">· {totalCount || reviews.length} reviews</span>
      </div>

      {/* Rating breakdown */}
      {reviews.length > 0 && (
        <div className="grid grid-cols-2 gap-x-8 mb-8">
          {breakdown.map(b => (
            <div key={b.star} className="flex items-center gap-2 py-0.5">
              <span className="text-sm text-gray-700 w-6">{b.star}</span>
              <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-gray-800 rounded-full" style={{ width: `${b.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Submit review */}
      {canReview && !showForm && (
        <button onClick={() => setShowForm(true)} className="btn btn-secondary mb-6">Write a review</button>
      )}
      {showForm && (
        <form onSubmit={handleSubmit} className="card mb-8 space-y-4">
          <h4 className="font-semibold text-gray-900">Your review</h4>
          <div>
            <label className="label">Rating</label>
            <StarRating value={rating} onChange={setRating} size={24} />
          </div>
          <div>
            <label className="label">Comment</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} className="input" rows={4} placeholder="Share your experience…" />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={rating === 0 || submitting} className="btn btn-primary">{submitting ? 'Submitting…' : 'Submit review'}</button>
            <button type="button" onClick={() => setShowForm(false)} className="btn btn-secondary">Cancel</button>
          </div>
        </form>
      )}

      {/* Review list */}
      <div>
        {reviews.map((r, i) => <ReviewCard key={i} review={r} />)}
        {reviews.length === 0 && <p className="text-gray-400 text-sm">No reviews yet. Be the first!</p>}
      </div>
    </div>
  )
}

export { StarRating }
