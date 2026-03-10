'use client'
import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate() }
function firstDayOfMonth(year, month) { return new Date(year, month, 1).getDay() }
function toISO(y, m, d) { return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` }
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export default function DateRangePicker({ checkIn, checkOut, onSelect, blockedDates = [] }) {
  const today = new Date()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [selecting, setSelecting] = useState('in') // 'in' | 'out'
  const [hovered, setHovered] = useState(null)

  const blocked = new Set(blockedDates)
  const days = daysInMonth(viewYear, viewMonth)
  const firstDay = firstDayOfMonth(viewYear, viewMonth)
  const todayISO = toISO(today.getFullYear(), today.getMonth(), today.getDate())

  function handleDay(d) {
    const iso = toISO(viewYear, viewMonth, d)
    if (iso < todayISO || blocked.has(iso)) return

    if (selecting === 'in') {
      onSelect(iso, null)
      setSelecting('out')
    } else {
      if (iso <= checkIn) {
        onSelect(iso, null)
        setSelecting('out')
      } else {
        onSelect(checkIn, iso)
        setSelecting('in')
      }
    }
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  }

  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= days; d++) cells.push(d)

  return (
    <div className="border border-gray-200 rounded-xl p-3 select-none">
      <div className="flex items-center justify-between mb-3">
        <button onClick={prevMonth} className="p-1 hover:bg-gray-100 rounded-lg"><ChevronLeft size={16} /></button>
        <span className="font-semibold text-sm text-gray-900">{MONTHS[viewMonth]} {viewYear}</span>
        <button onClick={nextMonth} className="p-1 hover:bg-gray-100 rounded-lg"><ChevronRight size={16} /></button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
          <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} />
          const iso = toISO(viewYear, viewMonth, d)
          const isPast = iso < todayISO
          const isBlocked = blocked.has(iso)
          const isStart = iso === checkIn
          const isEnd = iso === checkOut
          const isInRange = checkIn && checkOut && iso > checkIn && iso < checkOut
          const isHovered = hovered && checkIn && !checkOut && iso > checkIn && iso <= hovered

          return (
            <button
              key={d}
              onClick={() => handleDay(d)}
              onMouseEnter={() => setHovered(iso)}
              onMouseLeave={() => setHovered(null)}
              disabled={isPast || isBlocked}
              className={[
                'text-center text-sm py-1.5 rounded-lg transition-colors',
                isPast || isBlocked ? 'text-gray-300 cursor-not-allowed line-through' : 'cursor-pointer',
                isStart || isEnd ? 'bg-brand-600 text-white font-semibold' : '',
                isInRange ? 'bg-brand-100 text-brand-700' : '',
                isHovered && !isStart ? 'bg-brand-50 text-brand-600' : '',
                !isStart && !isEnd && !isInRange && !isHovered && !isPast && !isBlocked ? 'hover:bg-gray-100 text-gray-700' : '',
              ].filter(Boolean).join(' ')}
            >
              {d}
            </button>
          )
        })}
      </div>

      <div className="mt-3 flex gap-2 text-xs">
        {checkIn && <div className="flex-1 bg-gray-50 rounded px-2 py-1.5"><span className="text-gray-400">Check-in</span><br /><span className="font-medium text-gray-900">{checkIn}</span></div>}
        {checkOut && <div className="flex-1 bg-gray-50 rounded px-2 py-1.5"><span className="text-gray-400">Check-out</span><br /><span className="font-medium text-gray-900">{checkOut}</span></div>}
        {!checkIn && <p className="text-gray-400 mt-1">Select check-in date</p>}
        {checkIn && !checkOut && <p className="text-gray-400 mt-1">Now select check-out</p>}
      </div>
    </div>
  )
}
