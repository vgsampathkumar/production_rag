import { motion } from 'framer-motion'
import ResultCard from './ResultCard.jsx'

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.05,
    },
  },
}

const item = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 280, damping: 28 } },
}

export default function ResultsList({ chunks }) {
  if (!chunks || chunks.length === 0) return null

  const maxRerankScore = Math.max(...chunks.map(c => c.rerank_score ?? 0))

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3 }}
        className="flex items-center gap-3 mb-4"
      >
        <div className="flex items-center gap-2">
          <div className="w-1 h-5 bg-accent rounded-full" />
          <h2 className="text-sm font-semibold text-body/90 uppercase tracking-wider">
            Retrieved Context
          </h2>
        </div>
        <span className="text-xs text-muted bg-surface px-2.5 py-1 rounded-full border border-white/5">
          {chunks.length} chunk{chunks.length !== 1 ? 's' : ''}
        </span>
      </motion.div>

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="flex flex-col gap-3"
      >
        {chunks.map((chunk) => (
          <motion.div key={chunk.chunk_id} variants={item}>
            <ResultCard chunk={chunk} maxRerankScore={maxRerankScore} />
          </motion.div>
        ))}
      </motion.div>
    </div>
  )
}
