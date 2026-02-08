import { InputHTMLAttributes, forwardRef } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({
  label,
  error,
  leftIcon,
  rightIcon,
  className = '',
  ...props
}, ref) => {
  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
          {label}
        </label>
      )}
      <div className="relative">
        {leftIcon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">
            {leftIcon}
          </div>
        )}
        <input
          ref={ref}
          className={`
            w-full px-3 py-2 bg-[var(--bg-primary)] border rounded-md
            text-[var(--text-primary)] placeholder:text-[var(--text-muted)]
            focus:outline-none focus:ring-1 transition-colors
            ${leftIcon ? 'pl-10' : ''}
            ${rightIcon ? 'pr-10' : ''}
            ${error
              ? 'border-error focus:border-error focus:ring-error'
              : 'border-[var(--border)] focus:border-accent focus:ring-accent'
            }
            ${className}
          `}
          {...props}
        />
        {rightIcon && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">
            {rightIcon}
          </div>
        )}
      </div>
      {error && (
        <p className="mt-1.5 text-sm text-error">{error}</p>
      )}
    </div>
  )
})

Input.displayName = 'Input'

// Search input variant
interface SearchInputProps extends Omit<InputProps, 'leftIcon'> {
  onClear?: () => void
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(({
  value,
  onClear,
  ...props
}, ref) => {
  return (
    <Input
      ref={ref}
      value={value}
      leftIcon={
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      }
      rightIcon={
        value && onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="p-0.5 hover:text-[var(--text-primary)] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        ) : undefined
      }
      {...props}
    />
  )
})

SearchInput.displayName = 'SearchInput'
