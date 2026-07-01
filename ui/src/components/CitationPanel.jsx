import { motion } from 'framer-motion'

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
}
const item = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 280, damping: 28 } },
}

export default function CitationPanel({ chunks }) {
  if (!chunks || chunks.length === 0) return null

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-1 h-4 bg-yellow-400/70 rounded-full" />
        <h3 className="text-xs font-semibold text-body/70 uppercase tracking-wider">Sources</h3>
        <span className="text-xs text-muted bg-surface px-2 py-0.5 rounded-full border border-white/5">
          {chunks.length}
        </span>
      </div>

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="flex flex-col gap-2"
      >
        {chunks.map((chunk, i) => (
          <motion.div
            key={chunk.chunk_id || i}
            variants={item}
            className="flex items-start gap-3 p-3 bg-surface rounded-xl border border-white/5 hover:border-yellow-400/20 transition-colors"
          >
            {/* Rank */}
            <div className="flex-shrink-0 w-5 h-5 rounded-full bg-yellow-400/15 border border-yellow-400/30 flex items-center justify-center mt-0.5">
              <span className="text-yellow-400 text-xs font-bold">{i + 1}</span>
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="text-xs font-medium text-body/80 font-mono truncate max-w-[220px]">
                  {chunk.source}
                </span>
                <span className="text-xs text-muted bg-surface-2 px-1.5 py-0.5 rounded">
                  p.{chunk.page_num}
                </span>
              </div>
              <p className="text-xs text-muted leading-relaxed line-clamp-2 font-mono">
                {chunk.text?.slice(0, 160)}…
              </p>
            </div>
          </motion.div>
        ))}
      </motion.div>
    </div>
  )
}
