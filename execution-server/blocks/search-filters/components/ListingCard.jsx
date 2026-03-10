'use client'
import { Star, Heart, MapPin } from 'lucide-react'
import { useState } from 'react'

export default function ListingCard({ listing, onClick, onWishlist }) {
  const [wishlisted, setWishlisted] = useState(listing.wishlisted || false)
  const [imgIdx, setImgIdx] = useState(0)
  const images = listing.images || []

  function toggleWishlist(e) {
    e.stopPropagation()
    setWishlisted(w => !w)
    onWishlist?.(listing, !wishlisted)
  }

  return (
    <div onClick={() => onClick?.(listing)} className="cursor-pointer group">
      {/* Photo */}
      <div className="relative aspect-square rounded-2xl overflow-hidden bg-gray-100 mb-3">
        {images.length > 0 ? (
          <img src={images[imgIdx]} alt={listing.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300 text-5xl">🏠</div>
        )}
        {/* Wishlist */}
        <button onClick={toggleWishlist} className="absolute top-3 right-3 p-1.5 rounded-full bg-white/80 backdrop-blur-sm hover:bg-white transition">
          <Heart size={16} className={wishlisted ? 'fill-red-500 text-red-500' : 'text-gray-600'} />
        </button>
        {/* Image dots */}
        {images.length > 1 && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
            {images.slice(0, 5).map((_, i) => (
              <button key={i} onClick={e => { e.stopPropagation(); setImgIdx(i) }}
                className={`w-1.5 h-1.5 rounded-full ${i === imgIdx ? 'bg-white' : 'bg-white/50'}`} />
            ))}
          </div>
        )}
        {listing.badge && <div className="absolute top-3 left-3 badge bg-white text-gray-900 shadow-sm font-semibold text-xs px-2 py-1">{listing.badge}</div>}
      </div>

      {/* Info */}
      <div className="space-y-0.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-gray-900 text-sm line-clamp-1 flex-1">{listing.title}</h3>
          {listing.rating && (
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <Star size={12} className="fill-gray-900 text-gray-900" />
              <span className="text-sm font-medium text-gray-900">{listing.rating.toFixed(1)}</span>
            </div>
          )}
        </div>
        {listing.location && (
          <div className="flex items-center gap-0.5 text-xs text-gray-500">
            <MapPin size={10} />
            {listing.location}
          </div>
        )}
        {listing.available_dates && <p className="text-xs text-gray-500">{listing.available_dates}</p>}
        <p className="text-sm">
          <span className="font-bold text-gray-900">${listing.price_per_night}</span>
          <span className="text-gray-500"> / night</span>
        </p>
      </div>
    </div>
  )
}
