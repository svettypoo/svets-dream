'use client'
import { useEffect, useRef } from 'react'

export default function BarChart({ data = [], color = '#6366f1', height = 200, label = 'Value' }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!canvasRef.current || !data.length) return
    let chart
    async function draw() {
      const { Chart, registerables } = await import('chart.js')
      Chart.register(...registerables)
      if (chart) chart.destroy()
      chart = new Chart(canvasRef.current, {
        type: 'bar',
        data: {
          labels: data.map(d => d.label),
          datasets: [{
            label,
            data: data.map(d => d.value),
            backgroundColor: color + 'cc',
            borderColor: color,
            borderWidth: 1,
            borderRadius: 4,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 11 } } },
            y: { grid: { color: '#f1f5f9' }, ticks: { color: '#94a3b8', font: { size: 11 } } },
          },
        },
      })
    }
    draw()
    return () => { if (chart) chart.destroy() }
  }, [data, color, label])

  return (
    <div className="card">
      <div style={{ height }} className="relative">
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}
