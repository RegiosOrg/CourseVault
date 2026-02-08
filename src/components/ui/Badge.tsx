import { ReactNode } from 'react'

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info'

interface BadgeProps {
  variant?: BadgeVariant
  children: ReactNode
  className?: string
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]',
  success: 'bg-success/20 text-success',
  warning: 'bg-warning/20 text-warning',
  error: 'bg-error/20 text-error',
  info: 'bg-accent/20 text-accent'
}

export function Badge({
  variant = 'default',
  children,
  className = ''
}: BadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center px-2 py-0.5 rounded text-xs font-medium
        ${variantClasses[variant]}
        ${className}
      `}
    >
      {children}
    </span>
  )
}

// Count badge for showing numbers
interface CountBadgeProps {
  count: number
  max?: number
  variant?: BadgeVariant
  className?: string
}

export function CountBadge({
  count,
  max = 99,
  variant = 'default',
  className = ''
}: CountBadgeProps) {
  const displayCount = count > max ? `${max}+` : count

  return (
    <Badge variant={variant} className={className}>
      {displayCount}
    </Badge>
  )
}

// Status badge with dot indicator
type StatusType = 'online' | 'offline' | 'busy' | 'away'

interface StatusBadgeProps {
  status: StatusType
  label?: string
  className?: string
}

const statusColors: Record<StatusType, string> = {
  online: 'bg-success',
  offline: 'bg-[var(--text-muted)]',
  busy: 'bg-error',
  away: 'bg-warning'
}

const statusLabels: Record<StatusType, string> = {
  online: 'Online',
  offline: 'Offline',
  busy: 'Busy',
  away: 'Away'
}

export function StatusBadge({
  status,
  label,
  className = ''
}: StatusBadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${className}`}>
      <span className={`w-2 h-2 rounded-full ${statusColors[status]}`} />
      <span className="text-[var(--text-muted)]">
        {label ?? statusLabels[status]}
      </span>
    </span>
  )
}
