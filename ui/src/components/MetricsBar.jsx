import { motion } from 'framer-motion'

function MetricPill({ label, value, warn }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted text-xs uppercase tracking-wider">{label}</span>
      <span
        className={`font-mono text-sm font-semibold ${
          warn ? 'text-red-400' : 'text-accent'
        }`}
      >
        {value}
      </span>
    </div>
  )
}

function Divider() {
  return <span className="text-surface-2 select-none">|</span>
}

export default function MetricsBar({ metrics }) {
  if (!metrics) return null

  const fmt = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`)

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="flex items-center gap-4 flex-wrap px-4 py-2.5 bg-surface rounded-xl border border-white/5"
    >
      <div className="flex items-center gap-1.5 text-muted text-xs">
        <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span>Timing</span>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <MetricPill label="Search" value={fmt(metrics.search_ms)} warn={false} />
        <Divider />
        <MetricPill
          label="Re-rank"
          value={fmt(metrics.rerank_ms)}
          warn={metrics.rerank_ms > 100}
        />
        {metrics.rerank_ms > 100 && (
          <span className="text-xs text-red-400/70">(target ≤100ms)</span>
        )}
        {metrics.llm_ms > 0 && (
          <>
            <Divider />
            <MetricPill label="LLM" value={fmt(metrics.llm_ms)} warn={false} />
          </>
        )}
        <Divider />
        <MetricPill label="Total" value={fmt(metrics.total_ms)} warn={false} />
      </div>
    </motion.div>
  )
}
