import { InputHTMLAttributes, forwardRef } from 'react'

interface ToggleProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: string
  description?: string
  size?: 'sm' | 'md'
}

export const Toggle = forwardRef<HTMLInputElement, ToggleProps>(({
  label,
  description,
  size = 'md',
  className = '',
  ...props
}, ref) => {
  const sizeClasses = {
    sm: {
      track: 'w-8 h-4',
      thumb: 'w-3 h-3',
      translate: 'translate-x-4'
    },
    md: {
      track: 'w-11 h-6',
      thumb: 'w-5 h-5',
      translate: 'translate-x-5'
    }
  }

  const sizes = sizeClasses[size]

  return (
    <label className={`inline-flex items-start gap-3 cursor-pointer ${className}`}>
      <div className="relative flex-shrink-0">
        <input
          ref={ref}
          type="checkbox"
          className="sr-only peer"
          {...props}
        />
        <div className={`
          ${sizes.track} rounded-full transition-colors
          bg-[var(--border)]
          peer-checked:bg-accent
          peer-focus:ring-2 peer-focus:ring-accent peer-focus:ring-offset-2 peer-focus:ring-offset-[var(--bg-primary)]
          peer-disabled:opacity-50 peer-disabled:cursor-not-allowed
        `} />
        <div className={`
          absolute top-0.5 left-0.5 ${sizes.thumb}
          bg-white rounded-full shadow transition-transform
          peer-checked:${sizes.translate}
        `} />
      </div>
      {(label || description) && (
        <div className="flex flex-col">
          {label && (
            <span className="text-sm font-medium text-[var(--text-primary)]">
              {label}
            </span>
          )}
          {description && (
            <span className="text-xs text-[var(--text-muted)]">
              {description}
            </span>
          )}
        </div>
      )}
    </label>
  )
})

Toggle.displayName = 'Toggle'

// Checkbox variant
interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(({
  label,
  className = '',
  ...props
}, ref) => {
  return (
    <label className={`inline-flex items-center gap-2 cursor-pointer ${className}`}>
      <input
        ref={ref}
        type="checkbox"
        className="
          w-4 h-4 rounded border-[var(--border)] bg-[var(--bg-primary)]
          text-accent focus:ring-accent focus:ring-offset-[var(--bg-primary)]
          disabled:opacity-50 disabled:cursor-not-allowed
        "
        {...props}
      />
      {label && (
        <span className="text-sm text-[var(--text-primary)]">{label}</span>
      )}
    </label>
  )
})

Checkbox.displayName = 'Checkbox'
