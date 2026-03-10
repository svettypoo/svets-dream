'use client'
import { useState } from 'react'
import { X, ChevronLeft, ChevronRight, Grid3X3, Maximize2 } from 'lucide-react'

export default function ImageGallery({ images = [], alt = '' }) {
  const [lightbox, setLightbox] = useState(null) // index or null
  const [view, setView] = useState('hero') // 'hero' | 'grid'

  if (images.length === 0) {
    return <div className="aspect-[16/9] bg-gray-100 rounded-2xl flex items-center justify-center text-gray-300 text-6xl">🏠</div>
  }

  function prev() { setLightbox(i => (i - 1 + images.length) % images.length) }
  function next() { setLightbox(i => (i + 1) % images.length) }

  return (
    <>
      {/* Hero layout — 1 big + 4 small */}
      {view === 'hero' && (
        <div className="relative rounded-2xl overflow-hidden">
          <div className={`grid gap-2 ${images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`} style={{ maxHeight: 480 }}>
            <div className="relative cursor-pointer" onClick={() => setLightbox(0)}>
              <img src={images[0]} alt={alt} className="w-full h-full object-cover aspect-[4/3] hover:brightness-90 transition" />
            </div>
            {images.length > 1 && (
              <div className="grid grid-cols-2 gap-2">
                {images.slice(1, 5).map((img, i) => (
                  <div key={i} className="relative cursor-pointer overflow-hidden rounded-lg" onClick={() => setLightbox(i + 1)}>
                    <img src={img} alt={`${alt} ${i + 2}`} className="w-full h-full object-cover aspect-square hover:brightness-90 transition" />
                    {i === 3 && images.length > 5 && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white font-semibold text-lg">+{images.length - 5}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="absolute bottom-3 right-3 flex gap-2">
            {images.length > 5 && (
              <button onClick={() => setView('grid')} className="flex items-center gap-1.5 bg-white text-gray-900 text-sm font-medium px-3 py-1.5 rounded-lg shadow hover:bg-gray-50">
                <Grid3X3 size={14} /> Show all photos
              </button>
            )}
            <button onClick={() => setLightbox(0)} className="bg-white text-gray-900 p-1.5 rounded-lg shadow hover:bg-gray-50">
              <Maximize2 size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Grid view */}
      {view === 'grid' && (
        <div>
          <button onClick={() => setView('hero')} className="mb-3 btn btn-secondary text-sm">← Back</button>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {images.map((img, i) => (
              <img key={i} src={img} alt={`${alt} ${i + 1}`} onClick={() => setLightbox(i)}
                className="w-full aspect-square object-cover rounded-xl cursor-pointer hover:brightness-90 transition" />
            ))}
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightbox !== null && (
        <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center" onClick={() => setLightbox(null)}>
          <button onClick={e => { e.stopPropagation(); prev() }} className="absolute left-4 text-white bg-black/40 p-2 rounded-full hover:bg-black/60">
            <ChevronLeft size={24} />
          </button>
          <img src={images[lightbox]} alt={alt} className="max-h-[90vh] max-w-[90vw] object-contain" onClick={e => e.stopPropagation()} />
          <button onClick={e => { e.stopPropagation(); next() }} className="absolute right-4 text-white bg-black/40 p-2 rounded-full hover:bg-black/60">
            <ChevronRight size={24} />
          </button>
          <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 text-white bg-black/40 p-2 rounded-full hover:bg-black/60">
            <X size={20} />
          </button>
          <div className="absolute bottom-4 text-white/60 text-sm">{lightbox + 1} / {images.length}</div>
        </div>
      )}
    </>
  )
}
