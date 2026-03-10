'use client'
import { useState, useCallback } from 'react'
import { Search, SlidersHorizontal, X, MapPin, Star, DollarSign } from 'lucide-react'

export default function SearchFilters({ onSearch, categories = [], loading = false }) {
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState('')
  const [category, setCategory] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [minRating, setMinRating] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [guests, setGuests] = useState('')

  const activeFilters = [category, minPrice, maxPrice, minRating, checkIn, guests].filter(Boolean).length

  function handleSearch(e) {
    e?.preventDefault()
    onSearch?.({ query, location, category, minPrice, maxPrice, minRating, checkIn, checkOut, guests })
  }

  function clearAll() {
    setQuery(''); setLocation(''); setCategory(''); setMinPrice(''); setMaxPrice(''); setMinRating(''); setCheckIn(''); setCheckOut(''); setGuests('')
    onSearch?.({})
  }

  return (
    <div className="space-y-3">
      {/* Main search bar */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search listings…"
            className="input pl-9"
          />
        </div>
        <div className="relative">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Location" className="input pl-9 w-36" />
        </div>
        <input type="date" value={checkIn} onChange={e => setCheckIn(e.target.value)} className="input w-36" placeholder="Check in" />
        <input type="date" value={checkOut} onChange={e => setCheckOut(e.target.value)} className="input w-36" placeholder="Check out" />
        <select value={guests} onChange={e => setGuests(e.target.value)} className="input w-24">
          <option value="">Guests</option>
          {[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n} guest{n !== 1 ? 's' : ''}</option>)}
        </select>
        <button type="button" onClick={() => setShowFilters(f => !f)} className={`btn ${activeFilters > 0 ? 'btn-primary' : 'btn-secondary'} flex-shrink-0`}>
          <SlidersHorizontal size={14} className="mr-1" />
          Filters {activeFilters > 0 && <span className="ml-1 bg-white text-brand-600 rounded-full w-4 h-4 text-xs flex items-center justify-center">{activeFilters}</span>}
        </button>
        <button type="submit" disabled={loading} className="btn btn-primary flex-shrink-0">
          {loading ? '…' : 'Search'}
        </button>
      </form>

      {/* Advanced filters panel */}
      {showFilters && (
        <div className="card flex flex-wrap gap-4 items-end">
          {categories.length > 0 && (
            <div>
              <label className="label">Category</label>
              <select value={category} onChange={e => setCategory(e.target.value)} className="input w-40">
                <option value="">All categories</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="label flex items-center gap-1"><DollarSign size={12} /> Min Price</label>
            <input type="number" value={minPrice} onChange={e => setMinPrice(e.target.value)} className="input w-28" placeholder="$0" min={0} />
          </div>
          <div>
            <label className="label flex items-center gap-1"><DollarSign size={12} /> Max Price</label>
            <input type="number" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} className="input w-28" placeholder="Any" min={0} />
          </div>
          <div>
            <label className="label flex items-center gap-1"><Star size={12} /> Min Rating</label>
            <select value={minRating} onChange={e => setMinRating(e.target.value)} className="input w-28">
              <option value="">Any</option>
              <option value="4.5">4.5+</option>
              <option value="4.0">4.0+</option>
              <option value="3.5">3.5+</option>
            </select>
          </div>
          <button onClick={clearAll} className="btn btn-secondary flex items-center gap-1">
            <X size={14} /> Clear all
          </button>
          <button onClick={handleSearch} className="btn btn-primary">Apply filters</button>
        </div>
      )}
    </div>
  )
}
