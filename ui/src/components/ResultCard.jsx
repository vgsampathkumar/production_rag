import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const TYPE_STYLES = {
  dense:  { bg: 'bg-blue-500/15',   text: 'text-blue-400',   border: 'border-blue-500/30',  label: 'DENSE'  },
  sparse: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30', label: 'SPARSE' },
  both:   { bg: 'bg-purple-500/15', text: 'text-purple-400',  border: 'border-purple-500/30', label: 'BOTH'  },
}

export default function ResultCard({ chunk, maxRerankScore }) {
  const [expanded, setExpanded] = useState(false)
  const typeStyle = TYPE_STYLES[chunk.retrieval_type] || TYPE_STYLES.dense
  const scoreBarWidth = maxRerankScore > 0
    ? Math.max(4, Math.round((chunk.rerank_score / maxRerankScore) * 100))
    : 50

  const preview = chunk.text.slice(0, 220)
  const hasMore = chunk.text.length > 220

  return (
    <motion.div
      layout
      whileHover={{ y: -3, boxShadow: '0 0 24px rgba(99,102,241,0.25)' }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="bg-surface rounded-2xl border border-white/5 overflow-hidden cursor-default"
    >
      {/* Top bar: rank + type badge + score bar */}
      <div className="flex items-center gap-3 px-5 pt-4 pb-3">
        {/* Rank badge */}
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-accent/20 border border-accent/40 flex items-center justify-center">
          <span className="text-accent text-xs font-bold">#{chunk.rank}</span>
        </div>

        {/* Retrieval type pill */}
        <span
          className={`
            text-xs font-bold tracking-wider px-2.5 py-1 rounded-full border
            ${typeStyle.bg} ${typeStyle.text} ${typeStyle.border}
          `}
        >
          {typeStyle.label}
        </span>

        {/* Score bar */}
        <div className="flex-1 flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-accent to-purple-400 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${scoreBarWidth}%` }}
              transition={{ duration: 0.6, ease: 'easeOut', delay: 0.1 }}
            />
          </div>
          <span className="text-xs font-mono text-muted min-w-[3rem] text-right">
            {chunk.rerank_score.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Metadata row */}
      <div className="flex items-center gap-4 px-5 pb-3 text-xs text-muted flex-wrap">
        <span className="flex items-center gap-1.5">
          <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span className="text-body/70 font-medium">{chunk.source}</span>
        </span>
        <span className="flex items-center gap-1">
          <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M9 21V9" />
          </svg>
          p.{chunk.page_num}
        </span>
        <span className="flex items-center gap-1">
          <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M4 6h16M4 12h16M4 18h7" />
          </svg>
          {chunk.token_count} tokens
        </span>
      </div>

      {/* Divider */}
      <div className="mx-5 h-px bg-white/5" />

      {/* Text preview */}
      <div className="px-5 py-3">
        <p className="text-body/80 text-sm leading-relaxed font-mono text-xs">
          {expanded ? chunk.text : preview}
          {!expanded && hasMore && <span className="text-muted">…</span>}
        </p>

        <AnimatePresence>
          {hasMore && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="mt-2 text-xs text-accent/70 hover:text-accent transition-colors flex items-center gap-1"
            >
              <motion.svg
                width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
                animate={{ rotate: expanded ? 180 : 0 }}
                transition={{ duration: 0.2 }}
              >
                <polyline points="6 9 12 15 18 9" />
              </motion.svg>
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
