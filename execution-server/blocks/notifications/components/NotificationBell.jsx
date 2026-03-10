'use client'
import { useState } from 'react'
import { Bell, X } from 'lucide-react'

// notifications: [{ id, title, body, time, read, type }]
// onRead(id), onClear()
export default function NotificationBell({ notifications = [], onRead, onClear }) {
  const [open, setOpen] = useState(false)
  const unread = notifications.filter(n => !n.read).length

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-red-500 text-white text-xs flex items-center justify-center font-bold">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-40 w-80 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <span className="text-sm font-semibold text-gray-900">Notifications</span>
              <div className="flex items-center gap-2">
                {notifications.length > 0 && (
                  <button onClick={onClear} className="text-xs text-brand-600 hover:underline">Clear all</button>
                )}
                <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
              </div>
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
              {notifications.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-gray-400">No notifications</div>
              ) : notifications.map(n => (
                <div
                  key={n.id}
                  onClick={() => onRead?.(n.id)}
                  className={`px-4 py-3 cursor-pointer hover:bg-gray-50 transition ${n.read ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-start gap-2">
                    {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-brand-500 flex-shrink-0 mt-1.5" />}
                    <div className={!n.read ? '' : 'ml-3.5'}>
                      <p className="text-sm font-medium text-gray-900">{n.title}</p>
                      {n.body && <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{n.body}</p>}
                      {n.time && <p className="text-xs text-gray-400 mt-1">{n.time}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
