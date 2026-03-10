'use client'
import { useState, useCallback } from 'react'
import SearchFilters from '@/components/SearchFilters'
import ListingCard from '@/components/ListingCard'
import { useRouter } from 'next/navigation'

export default function SearchPage() {
  const router = useRouter()
  const [listings, setListings] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [total, setTotal] = useState(0)

  const handleSearch = useCallback(async (filters) => {
    setLoading(true)
    setSearched(true)
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v) })
    try {
      const res = await fetch(`/api/listings?${params}`)
      const data = await res.json()
      setListings(data.listings || data || [])
      setTotal(data.total || (data.listings || data || []).length)
    } finally {
      setLoading(false)
    }
  }, [])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-7xl mx-auto">
          <SearchFilters onSearch={handleSearch} loading={loading} />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {searched && !loading && (
          <p className="text-sm text-gray-600 mb-4">
            {total} {total === 1 ? 'place' : 'places'} found
          </p>
        )}

        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="aspect-square bg-gray-200 rounded-2xl mb-3" />
                <div className="h-4 bg-gray-200 rounded mb-2 w-3/4" />
                <div className="h-3 bg-gray-200 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : listings.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {listings.map(listing => (
              <ListingCard
                key={listing.id}
                listing={listing}
                onClick={l => router.push(`/listings/${l.id}`)}
              />
            ))}
          </div>
        ) : searched ? (
          <div className="text-center py-20">
            <div className="text-4xl mb-4">🔍</div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No results found</h3>
            <p className="text-gray-500">Try adjusting your filters or search in a different location.</p>
          </div>
        ) : (
          <div className="text-center py-20 text-gray-400">
            <div className="text-5xl mb-4">🏠</div>
            <p className="text-lg">Search for your perfect stay above</p>
          </div>
        )}
      </div>
    </div>
  )
}
