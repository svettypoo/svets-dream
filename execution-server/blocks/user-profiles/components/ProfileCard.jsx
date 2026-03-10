'use client'
import { Star, Shield, Calendar, MessageCircle } from 'lucide-react'

export default function ProfileCard({ profile, onContact, onViewListings }) {
  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : null

  return (
    <div className="card space-y-5">
      {/* Avatar + name */}
      <div className="flex items-center gap-4">
        {profile?.avatar_url ? (
          <img src={profile.avatar_url} alt={profile.full_name} className="w-16 h-16 rounded-full object-cover" />
        ) : (
          <div className="w-16 h-16 rounded-full bg-brand-100 flex items-center justify-center text-2xl font-bold text-brand-700">
            {profile?.full_name?.[0] || '?'}
          </div>
        )}
        <div>
          <h3 className="text-lg font-bold text-gray-900">{profile?.full_name}</h3>
          {profile?.role && <span className={`badge text-xs ${profile.role === 'host' ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-600'}`}>{profile.role}</span>}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 text-center">
        {profile?.review_count > 0 && (
          <div className="bg-gray-50 rounded-xl p-3">
            <div className="font-bold text-gray-900 text-lg">{profile.review_count}</div>
            <div className="text-xs text-gray-500">Reviews</div>
          </div>
        )}
        {profile?.rating && (
          <div className="bg-gray-50 rounded-xl p-3">
            <div className="flex items-center justify-center gap-1 font-bold text-gray-900 text-lg">
              <Star size={14} className="fill-gray-900 text-gray-900" />
              {profile.rating.toFixed(1)}
            </div>
            <div className="text-xs text-gray-500">Rating</div>
          </div>
        )}
        {profile?.listing_count > 0 && (
          <div className="bg-gray-50 rounded-xl p-3">
            <div className="font-bold text-gray-900 text-lg">{profile.listing_count}</div>
            <div className="text-xs text-gray-500">Listings</div>
          </div>
        )}
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-2">
        {profile?.identity_verified && (
          <div className="flex items-center gap-1.5 text-sm text-gray-700"><Shield size={14} className="text-green-500" /> Identity verified</div>
        )}
        {memberSince && (
          <div className="flex items-center gap-1.5 text-sm text-gray-500"><Calendar size={14} /> Member since {memberSince}</div>
        )}
      </div>

      {/* Bio */}
      {profile?.bio && <p className="text-sm text-gray-600 leading-relaxed">{profile.bio}</p>}

      {/* Languages */}
      {profile?.languages?.length > 0 && (
        <div>
          <div className="text-xs font-medium text-gray-500 mb-1.5">Languages</div>
          <div className="flex flex-wrap gap-1">
            {profile.languages.map(lang => <span key={lang} className="badge bg-gray-100 text-gray-700">{lang}</span>)}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        {onContact && (
          <button onClick={onContact} className="btn btn-primary flex-1">
            <MessageCircle size={14} className="mr-2" /> Message
          </button>
        )}
        {onViewListings && (
          <button onClick={onViewListings} className="btn btn-secondary flex-1">View listings</button>
        )}
      </div>
    </div>
  )
}
