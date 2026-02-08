import { useState, createContext, useContext, ReactNode, useCallback } from 'react'
import { createPortal } from 'react-dom'

type ToastType = 'success' | 'error' | 'info' | 'warning'

interface Toast {
  id: string
  type: ToastType
  message: string
  duration?: number
}

interface ToastContextType {
  showToast: (type: ToastType, message: string, duration?: number) => void
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
  warning: (message: string) => void
}

const ToastContext = createContext<ToastContextType | null>(null)

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}

interface ToastProviderProps {
  children: ReactNode
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const showToast = useCallback((type: ToastType, message: string, duration = 5000) => {
    const id = crypto.randomUUID()
    setToasts(prev => [...prev, { id, type, message, duration }])

    if (duration > 0) {
      setTimeout(() => removeToast(id), duration)
    }
  }, [removeToast])

  const value: ToastContextType = {
    showToast,
    success: (message) => showToast('success', message),
    error: (message) => showToast('error', message),
    info: (message) => showToast('info', message),
    warning: (message) => showToast('warning', message)
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <ToastContainer toasts={toasts} onRemove={removeToast} />,
        document.body
      )}
    </ToastContext.Provider>
  )
}

interface ToastContainerProps {
  toasts: Toast[]
  onRemove: (id: string) => void
}

function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  )
}

interface ToastItemProps {
  toast: Toast
  onRemove: (id: string) => void
}

const typeStyles: Record<ToastType, { bg: string; border: string; icon: string }> = {
  success: {
    bg: 'bg-success/10',
    border: 'border-l-4 border-success',
    icon: '✓'
  },
  error: {
    bg: 'bg-error/10',
    border: 'border-l-4 border-error',
    icon: '✕'
  },
  info: {
    bg: 'bg-accent/10',
    border: 'border-l-4 border-accent',
    icon: 'ℹ'
  },
  warning: {
    bg: 'bg-warning/10',
    border: 'border-l-4 border-warning',
    icon: '⚠'
  }
}

function ToastItem({ toast, onRemove }: ToastItemProps) {
  const [isExiting, setIsExiting] = useState(false)
  const styles = typeStyles[toast.type]

  const handleRemove = () => {
    setIsExiting(true)
    setTimeout(() => onRemove(toast.id), 200)
  }

  return (
    <div
      className={`
        flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg
        bg-[var(--bg-secondary)] border border-[var(--border)]
        ${styles.border}
        ${isExiting ? 'animate-slide-out' : 'animate-slide-in'}
        min-w-[280px] max-w-md
      `}
    >
      <span className={`text-lg ${toast.type === 'success' ? 'text-success' : toast.type === 'error' ? 'text-error' : toast.type === 'warning' ? 'text-warning' : 'text-accent'}`}>
        {styles.icon}
      </span>
      <p className="flex-1 text-sm text-[var(--text-primary)]">{toast.message}</p>
      <button
        onClick={handleRemove}
        className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
