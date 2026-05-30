import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { API_BASE } from '../config.js'

async function* parseSseStream(response) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    let eventType = null
    for (const line of lines) {
      if (line.startsWith('event: ')) eventType = line.slice(7).trim()
      else if (line.startsWith('data: ')) {
        const raw = line.slice(6).trim()
        if (raw) { try { yield { type: eventType, data: JSON.parse(raw) } } catch {} }
        eventType = null
      }
    }
  }
}

export default function DocumentSummaryCard({ doc, cachedSummary, onSummaryReady }) {
  const [isOpen, setIsOpen] = useState(false)
  const [summary, setSummary] = useState(cachedSummary || null)
  const [streaming, setStreaming] = useState('')
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')

  const summarize = async (e) => {
    e.stopPropagation()
    setStatus('generating')
    setStreaming('')
    setError('')
    setIsOpen(true)

    try {
      const res = await fetch(`${API_BASE}/document/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: doc.name }),
      })
      if (!res.ok) throw new Error(`Server error ${res.status}`)

      for await (const event of parseSseStream(res)) {
        if (event.type === 'token') setStreaming(prev => prev + event.data.content)
        else if (event.type === 'done') {
          setSummary(event.data.entry)
          setStreaming('')
          setStatus('done')
          onSummaryReady?.(doc.name, event.data.entry)
        } else if (event.type === 'error') throw new Error(event.data.message)
      }
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
  }

  const isGenerating = status === 'generating'
  const hasSummary = !!summary

  return (
    <motion.div
      layout
      className="bg-surface rounded-xl border border-white/5 overflow-hidden"
    >
      {/* Header row — always visible */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/3 transition-colors"
        onClick={() => setIsOpen(v => !v)}
      >
        <svg className="flex-shrink-0 text-accent/50" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>

        <div className="flex-1 min-w-0">
          <p className="text-xs font-mono text-body/80 truncate">{doc.name}</p>
          <p className="text-xs text-muted mt-0.5">
            {doc.chunks} chunk{doc.chunks !== 1 ? 's' : ''}
            {hasSummary && <span className="ml-2 text-emerald-400/70">Summary ready</span>}
          </p>
        </div>

        {/* Summarize / Regenerate button */}
        <motion.button
          onClick={summarize}
          disabled={isGenerating}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-accent/10 border border-accent/20 text-accent/80 disabled:opacity-40 transition-opacity"
        >
          {isGenerating ? (
            <motion.svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}>
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </motion.svg>
          ) : (
            <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          )}
          {hasSummary ? 'Re-summarize' : 'Summarize'}
        </motion.button>

        {/* Chevron */}
        <motion.svg
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="flex-shrink-0 text-muted"
          width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
        >
          <polyline points="6 9 12 15 18 9" />
        </motion.svg>
      </div>

      {/* Expanded body */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 border-t border-white/5">
              {/* Streaming */}
              {isGenerating && streaming && (
                <p className="text-xs text-muted font-mono leading-relaxed whitespace-pre-wrap">
                  {streaming}<span className="cursor-blink" />
                </p>
              )}

              {/* Idle prompt */}
              {!hasSummary && !isGenerating && !streaming && (
                <p className="text-xs text-muted py-2">
                  Click <strong>Summarize</strong> to generate an AI summary for this document.
                </p>
              )}

              {/* Parsed summary */}
              {hasSummary && !isGenerating && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col gap-3"
                >
                  <p className="text-sm text-body/80 leading-relaxed">{summary.summary}</p>
                  {summary.topics?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {summary.topics.map((t, i) => (
                        <span
                          key={i}
                          className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-400/90"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

              {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
