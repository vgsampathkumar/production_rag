/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0a0f1a',
        surface: '#111827',
        'surface-2': '#1a2236',
        accent: '#6366f1',
        'accent-dim': 'rgba(99,102,241,0.15)',
        body: '#e2e8f0',
        muted: '#6b7280',
        dense: '#3b82f6',
        sparse: '#10b981',
        both: '#8b5cf6',
      },
      animation: {
        'pulse-slow': 'pulse 2.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite',
      },
      keyframes: {
        glow: {
          '0%, 100%': { boxShadow: '0 0 5px rgba(99,102,241,0.3)' },
          '50%': { boxShadow: '0 0 25px rgba(99,102,241,0.7), 0 0 50px rgba(99,102,241,0.2)' },
        },
      },
    },
  },
  plugins: [],
}
