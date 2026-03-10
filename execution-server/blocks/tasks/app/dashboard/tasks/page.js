'use client'
import { useState, useEffect } from 'react'
import TaskBoard from '@/components/TaskBoard'
import { createBrowserClient } from '@/lib/supabase-browser'

export default function TasksPage() {
  const supabase = createBrowserClient()
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('tasks').select('*').order('created_at', { ascending: false })
    setTasks(data || [])
    setLoading(false)
  }

  async function handleAdd({ status }) {
    const title = prompt('Task title?')
    if (!title?.trim()) return
    const { data } = await supabase.from('tasks').insert({ title: title.trim(), status, priority: 'medium' }).select().single()
    if (data) setTasks(prev => [...prev, data])
  }

  async function handleUpdate(task) {
    await supabase.from('tasks').update({ title: task.title, description: task.description, status: task.status, priority: task.priority, due_date: task.due_date || null, assignee: task.assignee }).eq('id', task.id)
    setTasks(prev => prev.map(t => t.id === task.id ? task : t))
  }

  async function handleDelete(task) {
    if (!confirm(`Delete "${task.title}"?`)) return
    await supabase.from('tasks').delete().eq('id', task.id)
    setTasks(prev => prev.filter(t => t.id !== task.id))
  }

  if (loading) return <div className="p-8 text-gray-400">Loading tasks…</div>

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tasks</h1>
          <p className="text-sm text-gray-500 mt-0.5">{tasks.length} tasks across {new Set(tasks.map(t => t.status)).size} stages</p>
        </div>
      </div>
      <TaskBoard tasks={tasks} onAdd={handleAdd} onUpdate={handleUpdate} onDelete={handleDelete} />
    </div>
  )
}
