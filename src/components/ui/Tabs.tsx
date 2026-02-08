import { ReactNode, createContext, useContext, useState } from 'react'

interface TabsContextType {
  activeTab: string
  setActiveTab: (tab: string) => void
}

const TabsContext = createContext<TabsContextType | null>(null)

interface TabsProps {
  defaultValue?: string
  value?: string
  onValueChange?: (value: string) => void
  children: ReactNode
  className?: string
}

export function Tabs({
  defaultValue = '',
  value,
  onValueChange,
  children,
  className = ''
}: TabsProps) {
  const [internalValue, setInternalValue] = useState(value ?? defaultValue)
  const activeTab = value ?? internalValue

  const setActiveTab = (tab: string) => {
    if (!value) {
      setInternalValue(tab)
    }
    onValueChange?.(tab)
  }

  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab }}>
      <div className={className}>
        {children}
      </div>
    </TabsContext.Provider>
  )
}

interface TabsListProps {
  children: ReactNode
  className?: string
}

export function TabsList({ children, className = '' }: TabsListProps) {
  return (
    <div className={`flex border-b border-[var(--border)] bg-[var(--bg-secondary)] ${className}`}>
      {children}
    </div>
  )
}

interface TabsTriggerProps {
  value: string
  children: ReactNode
  className?: string
  disabled?: boolean
}

export function TabsTrigger({
  value,
  children,
  className = '',
  disabled = false
}: TabsTriggerProps) {
  const context = useContext(TabsContext)
  if (!context) throw new Error('TabsTrigger must be used within Tabs')

  const { activeTab, setActiveTab } = context
  const isActive = activeTab === value

  return (
    <button
      onClick={() => !disabled && setActiveTab(value)}
      disabled={disabled}
      className={`
        px-5 py-2.5 text-sm font-medium transition-colors
        border-b-2 -mb-px
        ${isActive
          ? 'text-accent border-accent'
          : 'text-[var(--text-muted)] border-transparent hover:text-[var(--text-primary)]'
        }
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${className}
      `}
    >
      {children}
    </button>
  )
}

interface TabsContentProps {
  value: string
  children: ReactNode
  className?: string
}

export function TabsContent({ value, children, className = '' }: TabsContentProps) {
  const context = useContext(TabsContext)
  if (!context) throw new Error('TabsContent must be used within Tabs')

  const { activeTab } = context

  if (activeTab !== value) return null

  return (
    <div className={`animate-fade-in ${className}`}>
      {children}
    </div>
  )
}
