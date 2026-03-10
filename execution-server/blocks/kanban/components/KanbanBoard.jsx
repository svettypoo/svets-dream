'use client'
import { useState } from 'react'
import { Plus, GripVertical } from 'lucide-react'

// columns: [{ id, label, color }]
// cards: [{ id, columnId, title, description, priority, assignee }]
// onMove(cardId, newColumnId), onAdd(columnId, title)
export default function KanbanBoard({ columns = [], cards = [], onMove, onAdd }) {
  const [dragging, setDragging] = useState(null) // cardId
  const [over, setOver] = useState(null) // columnId
  const [adding, setAdding] = useState(null) // columnId
  const [newTitle, setNewTitle] = useState('')

  function handleDragStart(e, cardId) {
    setDragging(cardId)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDrop(e, columnId) {
    e.preventDefault()
    if (dragging && dragging !== columnId) {
      onMove?.(dragging, columnId)
    }
    setDragging(null)
    setOver(null)
  }

  function submitAdd(columnId) {
    if (newTitle.trim()) onAdd?.(columnId, newTitle.trim())
    setAdding(null)
    setNewTitle('')
  }

  const PRIORITY_COLOR = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {columns.map(col => {
        const colCards = cards.filter(c => c.columnId === col.id)
        const isOver = over === col.id
        return (
          <div
            key={col.id}
            onDragOver={e => { e.preventDefault(); setOver(col.id) }}
            onDragLeave={() => setOver(null)}
            onDrop={e => handleDrop(e, col.id)}
            className="flex-shrink-0 w-72"
          >
            {/* Column header */}
            <div className="flex items-center gap-2 mb-3 px-1">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: col.color || '#6366f1' }} />
              <span className="text-sm font-semibold text-gray-700">{col.label}</span>
              <span className="ml-auto text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">{colCards.length}</span>
            </div>

            {/* Cards drop zone */}
            <div className={`min-h-20 rounded-xl p-2 transition-colors ${isOver ? 'bg-brand-50 ring-2 ring-brand-200' : 'bg-gray-100/60'}`}>
              {colCards.map(card => (
                <div
                  key={card.id}
                  draggable
                  onDragStart={e => handleDragStart(e, card.id)}
                  onDragEnd={() => { setDragging(null); setOver(null) }}
                  className={`bg-white rounded-lg p-3 mb-2 shadow-sm border border-gray-200 cursor-grab active:cursor-grabbing transition-opacity ${dragging === card.id ? 'opacity-40' : 'hover:shadow-md'}`}
                >
                  <div className="flex items-start gap-2">
                    <GripVertical size={14} className="text-gray-300 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 leading-snug">{card.title}</p>
                      {card.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{card.description}</p>}
                      <div className="flex items-center gap-2 mt-2">
                        {card.priority && (
                          <span className="text-xs font-medium px-1.5 py-0.5 rounded" style={{ color: PRIORITY_COLOR[card.priority], background: PRIORITY_COLOR[card.priority] + '18' }}>
                            {card.priority}
                          </span>
                        )}
                        {card.assignee && (
                          <span className="ml-auto text-xs text-gray-400">{card.assignee}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Add card */}
              {adding === col.id ? (
                <div className="bg-white rounded-lg p-2 shadow-sm border border-brand-200">
                  <textarea
                    autoFocus
                    value={newTitle}
                    onChange={e => setNewTitle(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitAdd(col.id) } if (e.key === 'Escape') { setAdding(null); setNewTitle('') } }}
                    placeholder="Card title…"
                    rows={2}
                    className="w-full text-sm text-gray-700 resize-none outline-none"
                  />
                  <div className="flex gap-2 mt-1">
                    <button onClick={() => submitAdd(col.id)} className="btn-primary text-xs px-3 py-1">Add</button>
                    <button onClick={() => { setAdding(null); setNewTitle('') }} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setAdding(col.id)} className="w-full text-left text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5 rounded-lg hover:bg-gray-200/50 transition flex items-center gap-1">
                  <Plus size={12} /> Add card
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
