import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'

const PLACEHOLDERS = [
  'What is the total contract price?',
  'What are the buyer obligations?',
  'Who are the parties in the agreement?',
  'What is the closing date?',
  'What are the contingencies in the contract?',
]

export default function SearchBar({ onSubmit, isLoading }) {
  const [query, setQuery] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const [placeholderIdx, setPlaceholderIdx] = useState(0)
  const inputRef = useRef(null)

  useEffect(() => {
    if (isFocused) return
    const id = setInterval(() => {
      setPlaceholderIdx(i => (i + 1) % PLACEHOLDERS.length)
    }, 3500)
    return () => clearInterval(id)
  }, [isFocused])

  const handleSubmit = (e) => {
    e.preventDefault()
    if (query.trim() && !isLoading) {
      onSubmit(query.trim())
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <motion.div
        className="relative flex items-center rounded-2xl overflow-hidden"
        animate={{
          boxShadow: isFocused
            ? '0 0 0 2px #6366f1, 0 0 30px rgba(99,102,241,0.4), 0 0 60px rgba(99,102,241,0.15)'
            : '0 0 0 1px rgba(99,102,241,0.25)',
        }}
        transition={{ duration: 0.25 }}
      >
        {/* Search icon */}
        <div className="absolute left-5 text-muted pointer-events-none">
          <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
        </div>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={PLACEHOLDERS[placeholderIdx]}
          disabled={isLoading}
          className="
            w-full bg-surface text-body text-base pl-14 pr-36 py-5
            placeholder:text-muted placeholder:transition-all
            focus:outline-none disabled:opacity-60
            transition-colors duration-200
          "
        />

        {/* Submit button */}
        <div className="absolute right-3">
          <motion.button
            type="submit"
            disabled={!query.trim() || isLoading}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className="
              flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm
              bg-accent text-white
              disabled:opacity-40 disabled:cursor-not-allowed
              transition-opacity duration-200
            "
          >
            {isLoading ? (
              <>
                <Spinner />
                <span>Searching…</span>
              </>
            ) : (
              <>
                <span>Ask</span>
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </>
            )}
          </motion.button>
        </div>
      </motion.div>

      {/* Keyboard hint */}
      {!isLoading && (
        <p className="mt-2 text-xs text-muted text-right pr-1">
          Press <kbd className="px-1.5 py-0.5 bg-surface-2 rounded text-xs font-mono">Enter</kbd> to search
        </p>
      )}
    </form>
  )
}

function Spinner() {
  return (
    <motion.svg
      width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5"
      animate={{ rotate: 360 }}
      transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </motion.svg>
  )
}
