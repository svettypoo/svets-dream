// Metric card for dashboard — shows a number, label, and optional trend
export default function StatsCard({ label, value, trend, trendLabel, icon, color = '#6366f1' }) {
  const isPositive = parseFloat(trend) >= 0
  return (
    <div className="card">
      <div className="flex items-start justify-between mb-3">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        {icon && (
          <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg" style={{ background: color + '18' }}>
            {icon}
          </div>
        )}
      </div>
      <p className="text-3xl font-bold text-gray-900 mb-1">{value ?? '—'}</p>
      {trend !== undefined && (
        <p className={`text-xs font-medium ${isPositive ? 'text-green-600' : 'text-red-500'}`}>
          {isPositive ? '↑' : '↓'} {Math.abs(parseFloat(trend))}%
          {trendLabel && <span className="text-gray-400 font-normal ml-1">{trendLabel}</span>}
        </p>
      )}
    </div>
  )
}
