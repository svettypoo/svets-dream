'use client'
import { useEffect, useRef, useState } from 'react'

// Leaflet loaded dynamically to avoid SSR issues
// package.json must include: "leaflet": "^1.9.4"

export default function MapView({ listings = [], center = [40.7128, -74.006], zoom = 12, onListingClick, selectedId }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])

  useEffect(() => {
    if (typeof window === 'undefined' || mapRef.current) return

    // Dynamically load leaflet CSS
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    document.head.appendChild(link)

    import('leaflet').then(L => {
      const map = L.default.map(containerRef.current, { zoomControl: true, scrollWheelZoom: true })
      L.default.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map)
      map.setView(center, zoom)
      mapRef.current = { map, L: L.default }
      updateMarkers(L.default, map)
    })

    return () => {
      if (mapRef.current) { mapRef.current.map.remove(); mapRef.current = null }
    }
  }, [])

  useEffect(() => {
    if (!mapRef.current) return
    const { map, L } = mapRef.current
    updateMarkers(L, map)
  }, [listings, selectedId])

  function updateMarkers(L, map) {
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    listings.forEach(listing => {
      if (!listing.lat || !listing.lng) return

      const isSelected = listing.id === selectedId
      const icon = L.divIcon({
        className: '',
        html: `<div style="
          background:${isSelected ? '#1a1a1a' : 'white'};
          color:${isSelected ? 'white' : '#1a1a1a'};
          border:2px solid ${isSelected ? '#1a1a1a' : 'transparent'};
          border-radius:24px;
          padding:6px 10px;
          font-size:12px;
          font-weight:700;
          white-space:nowrap;
          box-shadow:0 2px 8px rgba(0,0,0,0.2);
          cursor:pointer;
          transition:all 0.15s;
        ">$${listing.price_per_night}</div>`,
        iconAnchor: [28, 20],
      })

      const marker = L.marker([listing.lat, listing.lng], { icon })
        .addTo(map)
        .on('click', () => onListingClick?.(listing))

      markersRef.current.push(marker)
    })
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full rounded-2xl overflow-hidden"
      style={{ minHeight: 400 }}
    />
  )
}
