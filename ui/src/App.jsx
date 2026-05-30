import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import SearchBar from './components/SearchBar.jsx'
import ResultsList from './components/ResultsList.jsx'
import AnswerPanel from './components/AnswerPanel.jsx'
import MetricsBar from './components/MetricsBar.jsx'
import UploadPanel from './components/UploadPanel.jsx'
import CitationPanel from './components/CitationPanel.jsx'
import TabBar from './components/TabBar.jsx'
import NotebookTab from './components/NotebookTab.jsx'

const API_BASE = 'http://localhost:8000'

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
      if (line.startsWith('event: ')) {
        eventType = line.slice(7).trim()
      } else if (line.startsWith('data: ')) {
        const raw = line.slice(6).trim()
        if (raw) {
          try { yield { type: eventType, data: JSON.parse(raw) } } catch {}
          eventType = null
        }
      }
    }
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState('chat')
  const [status, setStatus] = useState('idle')
  const [chunks, setChunks] = useState([])
  const [answer, setAnswer] = useState('')
  const [metrics, setMetrics] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [lastQuery, setLastQuery] = useState('')

  const handleSubmit = useCallback(async (query) => {
    // Switch to chat tab when a question is asked from Notebook
    setActiveTab('chat')
    setStatus('loading')
    setChunks([])
    setAnswer('')
    setMetrics(null)
    setErrorMsg('')
    setLastQuery(query)

    try {
      const response = await fetch(`${API_BASE}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ query, dense_k: 20, sparse_k: 20, enable_llm: true }),
      })
      if (!response.ok) throw new Error(`Server error ${response.status}: ${await response.text()}`)

      setStatus('streaming')
      for await (const event of parseSseStream(response)) {
        if (event.type === 'chunk') setChunks(prev => [...prev, event.data])
        else if (event.type === 'token') setAnswer(prev => prev + event.data.content)
        else if (event.type === 'done') { setMetrics(event.data.metrics); setStatus('done') }
        else if (event.type === 'error') throw new Error(event.data.message)
      }
    } catch (err) {
      setErrorMsg(err.message || 'Unknown error')
      setStatus('error')
    }
  }, [])

  const isLoading = status === 'loading' || status === 'streaming'
  const hasResults = chunks.length > 0 || answer

  return (
    <div className="min-h-screen bg-bg text-body">
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(99,102,241,0.12) 0%, transparent 70%)' }}
      />

      <div className="relative max-w-3xl mx-auto px-4 py-10 flex flex-col gap-6">
        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center"
        >
          <div className="flex items-center justify-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-xl bg-accent/20 border border-accent/40 flex items-center justify-center">
              <svg width="16" height="16" fill="none" stroke="#6366f1" strokeWidth="2.5" viewBox="0 0 24 24">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-body">Ask My Docs</h1>
          </div>
          <p className="text-sm text-muted">
            Hybrid BM25 + Vector search · Cross-encoder re-ranking · GPT-4o-mini answers
          </p>
        </motion.header>

        {/* Tab bar */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05 }}>
          <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
        </motion.div>

        {/* ── CHAT TAB ── */}
        <AnimatePresence mode="wait">
          {activeTab === 'chat' && (
            <motion.div
              key="chat"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="flex flex-col gap-6"
            >
              {/* Upload panel */}
              <UploadPanel onUploaded={() => {}} />

              {/* Search bar */}
              <SearchBar onSubmit={handleSubmit} isLoading={isLoading} />

              {/* Query label */}
              <AnimatePresence>
                {lastQuery && (
                  <motion.div key="ql" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="flex items-center gap-2 -mb-2">
                    <span className="text-xs text-muted uppercase tracking-wider">Query</span>
                    <span className="text-sm text-body/80 font-medium">&ldquo;{lastQuery}&rdquo;</span>
                    {status === 'loading' && (
                      <motion.span className="ml-auto text-xs text-accent"
                        animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.2, repeat: Infinity }}>
                        Retrieving…
                      </motion.span>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Error */}
              <AnimatePresence>
                {status === 'error' && (
                  <motion.div key="err" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-2xl text-sm text-red-400">
                    <svg className="flex-shrink-0 mt-0.5" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span>{errorMsg}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Metrics */}
              <AnimatePresence>
                {metrics && <MetricsBar key="metrics" metrics={metrics} />}
              </AnimatePresence>

              {/* Results + Answer + Citations */}
              <AnimatePresence>
                {hasResults && (
                  <motion.div key="results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-6">
                    <ResultsList chunks={chunks} />
                    <AnswerPanel answer={answer} isStreaming={status === 'streaming'} />
                    {status === 'done' && chunks.length > 0 && (
                      <CitationPanel chunks={chunks} />
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Idle empty state */}
              <AnimatePresence>
                {status === 'idle' && (
                  <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="text-center py-20 text-muted">
                    <div className="shimmer w-24 h-24 rounded-full mx-auto mb-6 flex items-center justify-center bg-surface">
                      <svg width="36" height="36" fill="none" stroke="#6366f1" strokeWidth="1.5" viewBox="0 0 24 24" opacity="0.6">
                        <path d="M9 12h6M9 16h6M17 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z" />
                      </svg>
                    </div>
                    <p className="text-sm">Type a question above to search your documents</p>
                    <p className="text-xs mt-1 opacity-60">
                      Or switch to the <button onClick={() => setActiveTab('notebook')} className="text-accent underline">Notebook tab</button> to explore your sources
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {/* ── NOTEBOOK TAB ── */}
          {activeTab === 'notebook' && (
            <motion.div
              key="notebook"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              <NotebookTab onAsk={handleSubmit} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
