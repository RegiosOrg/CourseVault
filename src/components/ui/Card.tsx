import { ReactNode, HTMLAttributes, forwardRef } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  hover?: boolean
  padding?: 'none' | 'sm' | 'md' | 'lg'
}

const paddingClasses = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6'
}

export const Card = forwardRef<HTMLDivElement, CardProps>(({
  children,
  hover = false,
  padding = 'md',
  className = '',
  ...props
}, ref) => {
  return (
    <div
      ref={ref}
      className={`
        bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg
        ${hover ? 'hover:border-accent/50 transition-colors cursor-pointer' : ''}
        ${paddingClasses[padding]}
        ${className}
      `}
      {...props}
    >
      {children}
    </div>
  )
})

Card.displayName = 'Card'

// Card header component
interface CardHeaderProps {
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export function CardHeader({
  title,
  description,
  action,
  className = ''
}: CardHeaderProps) {
  return (
    <div className={`flex items-start justify-between gap-4 ${className}`}>
      <div>
        <h3 className="font-semibold text-[var(--text-secondary)]">{title}</h3>
        {description && (
          <p className="text-sm text-[var(--text-muted)] mt-0.5">{description}</p>
        )}
      </div>
      {action}
    </div>
  )
}

// Collapsible card
interface CollapsibleCardProps extends Omit<CardProps, 'children'> {
  title: string
  description?: string
  isExpanded: boolean
  onToggle: () => void
  children: ReactNode
  badge?: ReactNode
}

export function CollapsibleCard({
  title,
  description,
  isExpanded,
  onToggle,
  children,
  badge,
  className = '',
  ...props
}: CollapsibleCardProps) {
  return (
    <Card padding="none" className={className} {...props}>
      {/* Header - always visible */}
      <button
        onClick={onToggle}
        className="w-full p-4 flex items-center justify-between text-left bg-[var(--bg-tertiary)] hover:bg-[var(--border)] transition-colors rounded-t-lg"
      >
        <div className="flex items-center gap-3">
          <span
            className={`text-[var(--text-muted)] transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          >
            ▶
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-accent">{title}</span>
              {badge}
            </div>
            {description && (
              <p className="text-sm text-[var(--text-muted)]">{description}</p>
            )}
          </div>
        </div>
      </button>

      {/* Content - collapsible */}
      {isExpanded && (
        <div className="border-t border-[var(--border)] max-h-[300px] overflow-y-auto">
          {children}
        </div>
      )}
    </Card>
  )
}
