import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { API_BASE } from '../config.js'

function DocumentRow({ doc, index }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04 }}
      className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-white/5 transition-colors"
    >
      <div className="flex items-center gap-2 min-w-0">
        <svg className="flex-shrink-0 text-accent/60" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span className="text-xs text-body/80 truncate font-mono">{doc.name}</span>
      </div>
      <span className="flex-shrink-0 text-xs text-muted ml-3 bg-surface-2 px-2 py-0.5 rounded-full">
        {doc.chunks} chunk{doc.chunks !== 1 ? 's' : ''}
      </span>
    </motion.div>
  )
}

function UploadResultBadge({ result }) {
  const styles = {
    ok:      'bg-emerald-500/15 border-emerald-500/30 text-emerald-400',
    warning: 'bg-yellow-500/15 border-yellow-500/30 text-yellow-400',
    error:   'bg-red-500/15 border-red-500/30 text-red-400',
    skipped: 'bg-white/5 border-white/10 text-muted',
  }
  const icons = {
    ok:      <path d="M20 6 9 17l-5-5" />,
    warning: <><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>,
    error:   <><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></>,
    skipped: <><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>,
  }
  const style = styles[result.status] || styles.skipped

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`flex items-start gap-2 p-2.5 rounded-lg border text-xs ${style}`}
    >
      <svg className="flex-shrink-0 mt-0.5" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        {icons[result.status]}
      </svg>
      <div className="min-w-0">
        <span className="font-mono truncate block">{result.name}</span>
        {result.status === 'ok' && (
          <span className="opacity-80">{result.chunks} chunk{result.chunks !== 1 ? 's' : ''} from {result.pages} page{result.pages !== 1 ? 's' : ''}</span>
        )}
        {result.message && <span className="opacity-80">{result.message}</span>}
      </div>
    </motion.div>
  )
}

export default function UploadPanel({ onUploaded }) {
  const [isOpen, setIsOpen] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [pendingFiles, setPendingFiles] = useState([])
  const [uploadStatus, setUploadStatus] = useState('idle') // idle | uploading | done | error
  const [uploadResults, setUploadResults] = useState([])
  const [documents, setDocuments] = useState([])
  const [totalChunks, setTotalChunks] = useState(0)
  const [loadingDocs, setLoadingDocs] = useState(false)
  const fileInputRef = useRef(null)

  const fetchDocuments = useCallback(async () => {
    setLoadingDocs(true)
    try {
      const res = await fetch(`${API_BASE}/documents`)
      const data = await res.json()
      setDocuments(data.documents || [])
      setTotalChunks(data.total_chunks || 0)
    } catch {
      // backend not running yet — silently ignore
    } finally {
      setLoadingDocs(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) fetchDocuments()
  }, [isOpen, fetchDocuments])

  const addFiles = useCallback((fileList) => {
    const pdfs = Array.from(fileList).filter(f => f.name.toLowerCase().endsWith('.pdf'))
    if (!pdfs.length) return
    setPendingFiles(prev => {
      const existing = new Set(prev.map(f => f.name))
      return [...prev, ...pdfs.filter(f => !existing.has(f.name))]
    })
  }, [])

  const handleDragOver = (e) => { e.preventDefault(); setIsDragOver(true) }
  const handleDragLeave = (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false) }
  const handleDrop = (e) => { e.preventDefault(); setIsDragOver(false); addFiles(e.dataTransfer.files) }
  const handleFileInput = (e) => { addFiles(e.target.files); e.target.value = '' }
  const removeFile = (name) => setPendingFiles(prev => prev.filter(f => f.name !== name))

  const handleUpload = async () => {
    if (!pendingFiles.length || uploadStatus === 'uploading') return
    setUploadStatus('uploading')
    setUploadResults([])

    const formData = new FormData()
    pendingFiles.forEach(f => formData.append('files', f))

    try {
      const res = await fetch(`${API_BASE}/upload`, { method: 'POST', body: formData })
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      const data = await res.json()
      setUploadResults(data.results || [])
      setTotalChunks(data.total_chunks || totalChunks)
      setPendingFiles([])
      setUploadStatus('done')
      fetchDocuments()
      onUploaded?.()
    } catch (err) {
      setUploadResults([{ name: 'Upload failed', status: 'error', message: err.message }])
      setUploadStatus('error')
    }
  }

  const successCount = uploadResults.filter(r => r.status === 'ok').length

  return (
    <div className="w-full">
      {/* Toggle header */}
      <button
        onClick={() => setIsOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-surface rounded-xl border border-white/5 hover:border-accent/30 transition-colors group"
      >
        <div className="flex items-center gap-2.5">
          <svg className="text-accent/70" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span className="text-sm font-medium text-body/80 group-hover:text-body transition-colors">
            Manage Documents
          </span>
          {totalChunks > 0 && (
            <span className="text-xs text-muted bg-accent/10 border border-accent/20 px-2 py-0.5 rounded-full">
              {totalChunks} chunks
            </span>
          )}
        </div>
        <motion.svg
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="text-muted"
          width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
        >
          <polyline points="6 9 12 15 18 9" />
        </motion.svg>
      </button>

      {/* Expanded panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="pt-3 flex flex-col gap-4">

              {/* Drop zone */}
              <motion.div
                animate={{
                  boxShadow: isDragOver
                    ? '0 0 0 2px #6366f1, 0 0 30px rgba(99,102,241,0.3)'
                    : '0 0 0 1px rgba(255,255,255,0.07)',
                  backgroundColor: isDragOver ? 'rgba(99,102,241,0.08)' : 'transparent',
                }}
                transition={{ duration: 0.15 }}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className="relative rounded-xl p-6 flex flex-col items-center gap-3 cursor-pointer select-none"
                style={{ border: '1.5px dashed rgba(99,102,241,0.3)' }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  multiple
                  onChange={handleFileInput}
                  className="hidden"
                />
                <motion.div
                  animate={isDragOver ? { scale: 1.15, rotate: -5 } : { scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 300 }}
                  className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/30 flex items-center justify-center"
                >
                  <svg width="18" height="18" fill="none" stroke="#6366f1" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </motion.div>
                <div className="text-center">
                  <p className="text-sm text-body/70">
                    {isDragOver ? 'Drop PDFs here' : 'Drag & drop PDFs here'}
                  </p>
                  <p className="text-xs text-muted mt-0.5">
                    or <span className="text-accent/80 underline underline-offset-2">click to browse</span> · PDF only
                  </p>
                </div>
              </motion.div>

              {/* Pending file list */}
              <AnimatePresence mode="popLayout">
                {pendingFiles.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    className="flex flex-col gap-2"
                  >
                    <p className="text-xs text-muted uppercase tracking-wider px-1">
                      Ready to upload ({pendingFiles.length})
                    </p>
                    {pendingFiles.map(file => (
                      <motion.div
                        key={file.name}
                        layout
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 8 }}
                        className="flex items-center justify-between px-3 py-2 bg-surface rounded-lg border border-white/5"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <svg className="flex-shrink-0 text-accent/60" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                          </svg>
                          <span className="text-xs text-body/80 font-mono truncate">{file.name}</span>
                          <span className="flex-shrink-0 text-xs text-muted">
                            {(file.size / 1024).toFixed(0)} KB
                          </span>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); removeFile(file.name) }}
                          className="flex-shrink-0 ml-2 text-muted hover:text-red-400 transition-colors"
                        >
                          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </motion.div>
                    ))}

                    {/* Upload button */}
                    <motion.button
                      onClick={handleUpload}
                      disabled={uploadStatus === 'uploading'}
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.98 }}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold disabled:opacity-60 transition-opacity mt-1"
                    >
                      {uploadStatus === 'uploading' ? (
                        <>
                          <motion.svg
                            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                            animate={{ rotate: 360 }}
                            transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                          >
                            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                          </motion.svg>
                          Uploading & indexing…
                        </>
                      ) : (
                        <>
                          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                          </svg>
                          Upload {pendingFiles.length} file{pendingFiles.length !== 1 ? 's' : ''}
                        </>
                      )}
                    </motion.button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Upload results */}
              <AnimatePresence>
                {uploadResults.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col gap-2"
                  >
                    {successCount > 0 && (
                      <p className="text-xs text-emerald-400 px-1">
                        {successCount} file{successCount !== 1 ? 's' : ''} indexed successfully
                      </p>
                    )}
                    {uploadResults.map((r, i) => <UploadResultBadge key={i} result={r} />)}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Document library */}
              <div>
                <div className="flex items-center justify-between mb-2 px-1">
                  <p className="text-xs text-muted uppercase tracking-wider">
                    Indexed Library
                  </p>
                  <button
                    onClick={fetchDocuments}
                    className="text-xs text-accent/60 hover:text-accent transition-colors flex items-center gap-1"
                  >
                    <motion.svg
                      animate={loadingDocs ? { rotate: 360 } : { rotate: 0 }}
                      transition={loadingDocs ? { duration: 1, repeat: Infinity, ease: 'linear' } : {}}
                      width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
                    >
                      <polyline points="23 4 23 10 17 10" />
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                    </motion.svg>
                    Refresh
                  </button>
                </div>

                {documents.length === 0 && !loadingDocs && (
                  <p className="text-xs text-muted text-center py-4">No documents indexed yet</p>
                )}

                <div className="flex flex-col divide-y divide-white/5">
                  {documents.map((doc, i) => <DocumentRow key={doc.name} doc={doc} index={i} />)}
                </div>

                {documents.length > 0 && (
                  <p className="text-xs text-muted text-right mt-2 px-1">
                    {documents.length} documents · {totalChunks} total chunks
                  </p>
                )}
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
