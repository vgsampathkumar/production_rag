import { motion } from 'framer-motion'

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.07, delayChildren: 0.1 } },
}
const chip = {
  hidden: { opacity: 0, x: -12 },
  show: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 300, damping: 28 } },
}

export default function SuggestedQuestions({ questions, onAsk }) {
  if (!questions || questions.length === 0) return null

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <svg className="text-accent/70" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <h3 className="text-xs font-semibold text-body/70 uppercase tracking-wider">
          Suggested Questions
        </h3>
      </div>

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="flex flex-col gap-2"
      >
        {questions.map((q, i) => (
          <motion.button
            key={i}
            variants={chip}
            onClick={() => onAsk(q)}
            whileHover={{ x: 4, backgroundColor: 'rgba(99,102,241,0.12)' }}
            whileTap={{ scale: 0.98 }}
            className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-white/5 bg-surface text-left transition-colors group"
          >
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-accent/10 border border-accent/25 flex items-center justify-center text-accent/80 text-xs font-bold">
              {i + 1}
            </span>
            <span className="text-sm text-body/80 group-hover:text-body transition-colors">
              {q}
            </span>
            <svg className="ml-auto flex-shrink-0 text-muted group-hover:text-accent transition-colors" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </motion.button>
        ))}
      </motion.div>
    </div>
  )
}
