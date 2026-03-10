'use client'
import { useState, useCallback } from 'react'
import { Plus, Pencil, Trash2, User, Calendar, Flag } from 'lucide-react'

const STATUSES = ['todo', 'in_progress', 'review', 'done']
const STATUS_LABELS = { todo: 'To Do', in_progress: 'In Progress', review: 'In Review', done: 'Done' }
const STATUS_COLORS = {
  todo: 'border-t-gray-400',
  in_progress: 'border-t-blue-500',
  review: 'border-t-yellow-500',
  done: 'border-t-green-500',
}
const PRIORITY_COLORS = { low: 'text-gray-400', medium: 'text-yellow-500', high: 'text-red-500' }

export default function TaskBoard({ tasks = [], onAdd, onUpdate, onDelete }) {
  const [dragging, setDragging] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({})

  const byStatus = STATUSES.reduce((acc, s) => {
    acc[s] = tasks.filter(t => t.status === s)
    return acc
  }, {})

  function startDrag(task) { setDragging(task) }

  function onDrop(status) {
    if (dragging && dragging.status !== status) {
      onUpdate?.({ ...dragging, status })
    }
    setDragging(null)
  }

  function openEdit(task) {
    setEditingId(task.id)
    setForm({ title: task.title, description: task.description || '', priority: task.priority || 'medium', due_date: task.due_date || '', assignee: task.assignee || '' })
  }

  function saveEdit(task) {
    onUpdate?.({ ...task, ...form })
    setEditingId(null)
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 min-h-[500px]">
      {STATUSES.map(status => (
        <div
          key={status}
          className={`flex-shrink-0 w-64 bg-gray-50 rounded-xl border-t-4 ${STATUS_COLORS[status]} flex flex-col`}
          onDragOver={e => e.preventDefault()}
          onDrop={() => onDrop(status)}
        >
          <div className="px-3 py-3 flex items-center justify-between">
            <span className="font-semibold text-sm text-gray-700">{STATUS_LABELS[status]}</span>
            <div className="flex items-center gap-2">
              <span className="badge bg-gray-200 text-gray-600">{byStatus[status].length}</span>
              {status === 'todo' && (
                <button onClick={() => onAdd?.({ status })} className="btn btn-primary py-0.5 px-2 text-xs">
                  <Plus size={12} className="mr-1" /> Add
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 px-2 pb-2 flex flex-col gap-2 overflow-y-auto">
            {byStatus[status].map(task => (
              <div
                key={task.id}
                draggable
                onDragStart={() => startDrag(task)}
                className="card p-3 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow"
              >
                {editingId === task.id ? (
                  <div className="flex flex-col gap-2">
                    <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="input text-xs" placeholder="Title" />
                    <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="input text-xs" rows={2} placeholder="Description" />
                    <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className="input text-xs">
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                    <input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} className="input text-xs" />
                    <input value={form.assignee} onChange={e => setForm(f => ({ ...f, assignee: e.target.value }))} className="input text-xs" placeholder="Assignee" />
                    <div className="flex gap-1">
                      <button onClick={() => saveEdit(task)} className="btn btn-primary flex-1 text-xs py-1">Save</button>
                      <button onClick={() => setEditingId(null)} className="btn btn-secondary flex-1 text-xs py-1">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-1">
                      <p className="text-sm font-medium text-gray-900 leading-tight">{task.title}</p>
                      <div className="flex gap-1 flex-shrink-0">
                        <button onClick={() => openEdit(task)} className="text-gray-400 hover:text-gray-600 p-0.5"><Pencil size={11} /></button>
                        <button onClick={() => onDelete?.(task)} className="text-gray-400 hover:text-red-500 p-0.5"><Trash2 size={11} /></button>
                      </div>
                    </div>
                    {task.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{task.description}</p>}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {task.priority && <Flag size={10} className={PRIORITY_COLORS[task.priority]} />}
                      {task.due_date && <span className="flex items-center gap-0.5 text-xs text-gray-400"><Calendar size={10} />{task.due_date}</span>}
                      {task.assignee && <span className="flex items-center gap-0.5 text-xs text-gray-400"><User size={10} />{task.assignee}</span>}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
