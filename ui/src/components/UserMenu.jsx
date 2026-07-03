import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

export default function UserMenu({ user, onLogout }) {
  const [isOpen, setIsOpen] = useState(false)

  if (!user) return null

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors"
      >
        {user.avatar_url && (
          <img
            src={user.avatar_url}
            alt={user.name}
            className="w-6 h-6 rounded-full"
          />
        )}
        <div className="text-xs text-left">
          <div className="font-medium text-white">{user.name}</div>
          <div className="text-body/60 capitalize">{user.provider}</div>
        </div>
        <svg
          className={`w-4 h-4 text-body/60 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute right-0 mt-2 w-48 bg-surface-2 border border-white/10 rounded-lg shadow-lg overflow-hidden z-50"
          >
            <div className="p-3 border-b border-white/10">
              <div className="text-xs font-medium text-body/60">{user.email}</div>
            </div>
            <button
              onClick={() => {
                onLogout()
                setIsOpen(false)
              }}
              className="w-full px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors text-left"
            >
              Logout
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
