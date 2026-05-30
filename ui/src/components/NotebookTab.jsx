import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import NotebookGuide from './NotebookGuide.jsx'
import SuggestedQuestions from './SuggestedQuestions.jsx'
import DocumentSummaryCard from './DocumentSummaryCard.jsx'

const API_BASE = 'http://localhost:8000'

export default function NotebookTab({ onAsk }) {
  const [notebookData, setNotebookData] = useState({ guide: null, summaries: {} })
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [nbRes, docsRes] = await Promise.all([
        fetch(`${API_BASE}/notebook`),
        fetch(`${API_BASE}/documents`),
      ])
      const nb = await nbRes.json()
      const docs = await docsRes.json()
      setNotebookData(nb)
      setDocuments(docs.documents || [])
    } catch {
      // backend not reachable
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleGuideReady = (guide) => {
    setNotebookData(prev => ({ ...prev, guide }))
  }

  const handleSummaryReady = (source, entry) => {
    setNotebookData(prev => ({
      ...prev,
      summaries: { ...prev.summaries, [source]: entry },
    }))
  }

  const handleAsk = (question) => {
    onAsk(question)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted">
        <motion.svg
          width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </motion.svg>
        <span className="ml-3 text-sm">Loading notebook…</span>
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="flex flex-col gap-6"
    >
      {/* Notebook Guide */}
      <NotebookGuide
        initialGuide={notebookData.guide}
        onGuideReady={handleGuideReady}
      />

      {/* Suggested Questions */}
      {notebookData.guide?.suggested_questions?.length > 0 && (
        <SuggestedQuestions
          questions={notebookData.guide.suggested_questions}
          onAsk={handleAsk}
        />
      )}

      {/* Document Library with summaries */}
      {documents.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <svg className="text-muted" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            <h3 className="text-xs font-semibold text-body/70 uppercase tracking-wider">
              Document Library
            </h3>
            <span className="text-xs text-muted bg-surface px-2 py-0.5 rounded-full border border-white/5">
              {documents.length}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {documents.map(doc => (
              <DocumentSummaryCard
                key={doc.name}
                doc={doc}
                cachedSummary={notebookData.summaries?.[doc.name] || null}
                onSummaryReady={handleSummaryReady}
              />
            ))}
          </div>
        </div>
      )}

      {documents.length === 0 && (
        <div className="text-center py-12 text-muted">
          <p className="text-sm">No documents indexed yet.</p>
          <p className="text-xs mt-1 opacity-60">Switch to the Chat tab and upload PDFs first.</p>
        </div>
      )}
    </motion.div>
  )
}
