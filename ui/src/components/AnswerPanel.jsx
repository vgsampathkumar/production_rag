import { motion } from 'framer-motion'

export default function AnswerPanel({ answer, isStreaming }) {
  if (!answer && !isStreaming) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="bg-surface rounded-2xl border border-white/5 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5">
        <div className="flex items-center gap-2">
          <div className="w-1 h-5 bg-emerald-400 rounded-full" />
          <h2 className="text-sm font-semibold text-body/90 uppercase tracking-wider">AI Answer</h2>
        </div>

        {isStreaming && (
          <motion.div
            className="flex items-center gap-1.5 ml-auto"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <motion.span
              className="text-xs text-emerald-400"
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
            >
              Generating
            </motion.span>
            <div className="flex gap-1">
              {[0, 1, 2].map(i => (
                <motion.div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                  animate={{ y: [0, -4, 0] }}
                  transition={{
                    duration: 0.6,
                    repeat: Infinity,
                    delay: i * 0.15,
                    ease: 'easeInOut',
                  }}
                />
              ))}
            </div>
          </motion.div>
        )}

        {!isStreaming && answer && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted">
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Done
          </span>
        )}
      </div>

      {/* Answer text */}
      <div className="px-5 py-4">
        <p className="text-body/90 text-sm leading-7 whitespace-pre-wrap">
          {answer}
          {isStreaming && <span className="cursor-blink" />}
        </p>
      </div>
    </motion.div>
  )
}
