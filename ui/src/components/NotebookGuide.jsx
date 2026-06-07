import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '@clerk/clerk-react'
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

export default function NotebookGuide({ initialGuide, onGuideReady }) {
  const { getToken } = useAuth()
  const [guide, setGuide] = useState(initialGuide || null)
  const [streaming, setStreaming] = useState('')
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    if (initialGuide) setGuide(initialGuide)
  }, [initialGuide])

  const generate = async () => {
    setStatus('generating')
    setStreaming('')
    setError('')

    try {
      const token = await getToken()
      const res = await fetch(`${API_BASE}/notebook/generate`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error(`Server error ${res.status}`)

      for await (const event of parseSseStream(res)) {
        if (event.type === 'token') setStreaming(prev => prev + event.data.content)
        else if (event.type === 'done') {
          setGuide(event.data.guide)
          setStreaming('')
          setStatus('done')
          onGuideReady?.(event.data.guide)
        } else if (event.type === 'error') throw new Error(event.data.message)
      }
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
  }

  const isGenerating = status === 'generating'

  return (
    <div className="bg-surface rounded-2xl border border-white/5 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
        <div className="flex items-center gap-2">
          <div className="w-1 h-5 bg-indigo-400 rounded-full" />
          <h2 className="text-sm font-semibold text-body/90 uppercase tracking-wider">Notebook Guide</h2>
        </div>
        <div className="flex items-center gap-2">
          {isGenerating && (
            <motion.span className="text-xs text-accent" animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.2, repeat: Infinity }}>
              Generating…
            </motion.span>
          )}
          <motion.button
            onClick={generate}
            disabled={isGenerating}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-accent/15 border border-accent/30 text-accent/90 disabled:opacity-40 transition-opacity"
          >
            {isGenerating ? (
              <motion.svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </motion.svg>
            ) : (
              <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            )}
            {guide ? 'Regenerate' : 'Generate'}
          </motion.button>
        </div>
      </div>

      <div className="px-5 py-4">
        {!guide && !streaming && !isGenerating && (
          <div className="text-center py-8 text-muted">
            <svg className="mx-auto mb-3 opacity-40" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
            <p className="text-sm">Click Generate to create an AI-powered overview of all your documents.</p>
          </div>
        )}

        {isGenerating && streaming && (
          <p className="text-xs text-muted font-mono leading-relaxed whitespace-pre-wrap">
            {streaming}<span className="cursor-blink" />
          </p>
        )}

        <AnimatePresence>
          {guide && !isGenerating && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-5">
              {guide.overview && (
                <div>
                  <p className="text-xs text-muted uppercase tracking-wider mb-2">Overview</p>
                  <p className="text-sm text-body/85 leading-relaxed">{guide.overview}</p>
                </div>
              )}
              {guide.themes?.length > 0 && (
                <div>
                  <p className="text-xs text-muted uppercase tracking-wider mb-2">Key Themes</p>
                  <div className="flex flex-wrap gap-2">
                    {guide.themes.map((t, i) => (
                      <motion.span key={i} initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.06 }}
                        className="text-xs px-3 py-1 rounded-full bg-accent/10 border border-accent/25 text-accent/90">
                        {t}
                      </motion.span>
                    ))}
                  </div>
                </div>
              )}
              {guide.doc_onelines && Object.keys(guide.doc_onelines).length > 0 && (
                <div>
                  <p className="text-xs text-muted uppercase tracking-wider mb-2">Documents</p>
                  <div className="flex flex-col gap-1.5">
                    {Object.entries(guide.doc_onelines).map(([src, desc]) => (
                      <div key={src} className="flex items-start gap-2">
                        <svg className="flex-shrink-0 mt-0.5 text-muted" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                        </svg>
                        <div className="min-w-0">
                          <span className="text-xs font-mono text-muted mr-1 truncate">{src}</span>
                          <span className="text-xs text-body/70">— {desc}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      </div>
    </div>
  )
}
