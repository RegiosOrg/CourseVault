interface ProgressBarProps {
  value: number
  max?: number
  label?: string
  showValue?: boolean
  size?: 'sm' | 'md' | 'lg'
  variant?: 'default' | 'success' | 'warning' | 'error'
  className?: string
}

const sizeClasses = {
  sm: 'h-1',
  md: 'h-2',
  lg: 'h-3'
}

const variantClasses = {
  default: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error'
}

export function ProgressBar({
  value,
  max = 100,
  label,
  showValue = false,
  size = 'md',
  variant = 'default',
  className = ''
}: ProgressBarProps) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100))

  return (
    <div className={className}>
      {(label || showValue) && (
        <div className="flex justify-between items-center mb-1.5">
          {label && (
            <span className="text-sm text-[var(--text-primary)]">{label}</span>
          )}
          {showValue && (
            <span className="text-sm text-[var(--text-muted)]">{Math.round(percentage)}%</span>
          )}
        </div>
      )}
      <div className={`w-full ${sizeClasses[size]} bg-[var(--bg-tertiary)] rounded-full overflow-hidden`}>
        <div
          className={`h-full ${variantClasses[variant]} rounded-full transition-all duration-300 ease-out`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}

// Circular progress / spinner
interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const spinnerSizes = {
  sm: 'w-4 h-4 border-2',
  md: 'w-6 h-6 border-2',
  lg: 'w-10 h-10 border-3'
}

export function Spinner({ size = 'md', className = '' }: SpinnerProps) {
  return (
    <div
      className={`
        ${spinnerSizes[size]}
        border-[var(--border)] border-t-accent
        rounded-full animate-spin
        ${className}
      `}
    />
  )
}

// Circular progress with percentage
interface CircularProgressProps {
  value: number
  max?: number
  size?: number
  strokeWidth?: number
  showValue?: boolean
  className?: string
}

export function CircularProgress({
  value,
  max = 100,
  size = 48,
  strokeWidth = 4,
  showValue = true,
  className = ''
}: CircularProgressProps) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100))
  const radius = (size - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const offset = circumference - (percentage / 100) * circumference

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`}>
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--bg-tertiary)"
          strokeWidth={strokeWidth}
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="text-accent transition-all duration-300 ease-out"
        />
      </svg>
      {showValue && (
        <span className="absolute text-xs font-medium text-[var(--text-primary)]">
          {Math.round(percentage)}%
        </span>
      )}
    </div>
  )
}
