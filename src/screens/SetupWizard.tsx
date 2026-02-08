import { useState, useEffect } from 'react'
import { useAppStore, LLMBackend } from '@/stores/appStore'
import { api } from '@/api/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { ProgressBar, Spinner } from '@/components/ui/Progress'

type SetupStep = 'welcome' | 'llm-backend' | 'model-selection' | 'whisper' | 'complete'

interface BackendOption {
  id: LLMBackend
  name: string
  description: string
  icon: string
  requiresDownload: boolean
  downloadSize?: string
}

const backends: BackendOption[] = [
  {
    id: 'ollama',
    name: 'Ollama (Recommended)',
    description: 'Free, runs locally, no API key needed',
    icon: '🦙',
    requiresDownload: true,
    downloadSize: '~500MB + model (~4GB)'
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    description: 'Free, visual interface, many model options',
    icon: '🎨',
    requiresDownload: true,
    downloadSize: '~400MB + model (~4GB)'
  },
  {
    id: 'openai',
    name: 'OpenAI API',
    description: 'Requires API key and internet connection',
    icon: '🤖',
    requiresDownload: false
  }
]

const whisperModels = [
  { id: 'base.en', name: 'Base (Recommended)', description: 'Good accuracy, fast', size: '140 MB' },
  { id: 'small.en', name: 'Small', description: 'Better accuracy, slower', size: '460 MB' },
  { id: 'medium.en', name: 'Medium', description: 'High accuracy, requires patience', size: '1.5 GB' },
  { id: 'large', name: 'Large', description: 'Best accuracy, very slow without GPU', size: '3.1 GB' }
]

export default function SetupWizard() {
  const {
    setLLMBackend,
    setWhisperModel,
    setIsFirstRun,
    setScreen,
    setCourseData
  } = useAppStore()

  const [step, setStep] = useState<SetupStep>('welcome')
  const [selectedBackend, setSelectedBackend] = useState<LLMBackend>(null)
  const [apiKey, setApiKey] = useState('')
  const [selectedWhisper, setSelectedWhisper] = useState('base.en')
  const [isInstalling, setIsInstalling] = useState(false)
  const [installProgress, setInstallProgress] = useState(0)
  const [installStatus, setInstallStatus] = useState('')
  const [backendStatus, setBackendStatus] = useState<Record<string, boolean>>({})

  // Check existing backends
  useEffect(() => {
    const checkBackends = async () => {
      if (typeof window !== 'undefined' && window.electronAPI) {
        const [ollama, lmstudio] = await Promise.all([
          window.electronAPI.checkOllama(),
          window.electronAPI.checkLmStudio()
        ])
        setBackendStatus({ ollama, lmstudio })
      }
    }
    checkBackends()
  }, [])

  // Handle backend selection
  const handleSelectBackend = (backend: LLMBackend) => {
    setSelectedBackend(backend)

    if (backend === 'openai') {
      // OpenAI doesn't need installation
      setStep('llm-backend')
    } else if (backend && backendStatus[backend]) {
      // Already installed
      setStep('whisper')
    }
  }

  // Handle continue from backend selection
  const handleBackendContinue = async () => {
    if (selectedBackend === 'openai') {
      if (!apiKey.trim()) return
      if (window.electronAPI) {
        await window.electronAPI.setSecureSetting('openaiApiKey', apiKey.trim())
      }
      setLLMBackend('openai')
      setStep('whisper')
      return
    }

    if (selectedBackend && backendStatus[selectedBackend]) {
      setLLMBackend(selectedBackend)
      setStep('whisper')
      return
    }

    // Need to install
    setIsInstalling(true)
    setInstallStatus('Preparing installation...')

    // Simulate installation progress (in real app, this would be actual installation)
    for (let i = 0; i <= 100; i += 10) {
      setInstallProgress(i)
      if (i === 20) setInstallStatus('Downloading installer...')
      if (i === 50) setInstallStatus('Installing...')
      if (i === 80) setInstallStatus('Configuring...')
      await new Promise(r => setTimeout(r, 500))
    }

    setInstallStatus('Installation complete!')
    setLLMBackend(selectedBackend)
    setIsInstalling(false)
    setStep('whisper')
  }

  // Handle skip
  const handleSkip = () => {
    setStep('complete')
  }

  // Handle complete
  const handleComplete = async () => {
    setWhisperModel(selectedWhisper)
    setIsFirstRun(false)

    // Try to load course data
    try {
      const data = await api.fetchCourseData()
      setCourseData(data)
    } catch (err) {
      // Will show error on dashboard
    }

    setScreen('dashboard')
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center p-6">
      <div className="w-full max-w-xl">
        {/* Welcome Step */}
        {step === 'welcome' && (
          <div className="text-center">
            <div className="text-6xl mb-6">📚</div>
            <h1 className="text-3xl font-bold text-[var(--text-secondary)] mb-3">
              Welcome to CourseVault
            </h1>
            <p className="text-[var(--text-muted)] mb-8 max-w-md mx-auto">
              Your course library, searchable at last. Let's set up your AI backend
              for summaries and intelligent search.
            </p>
            <Button size="lg" onClick={() => setStep('llm-backend')}>
              Get Started →
            </Button>
          </div>
        )}

        {/* LLM Backend Selection */}
        {step === 'llm-backend' && (
          <div>
            <h2 className="text-2xl font-bold text-[var(--text-secondary)] mb-2 text-center">
              Select AI Backend
            </h2>
            <p className="text-[var(--text-muted)] mb-6 text-center">
              Choose how you'd like to power AI summaries and chat
            </p>

            <div className="space-y-3 mb-6">
              {backends.map((backend) => (
                <Card
                  key={backend.id}
                  hover
                  padding="md"
                  onClick={() => handleSelectBackend(backend.id)}
                  className={`cursor-pointer ${
                    selectedBackend === backend.id
                      ? 'border-accent ring-1 ring-accent'
                      : ''
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div className="text-3xl">{backend.icon}</div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-[var(--text-secondary)]">
                          {backend.name}
                        </h3>
                        {backend.id && backendStatus[backend.id] && (
                          <span className="text-xs text-success">✓ Installed</span>
                        )}
                      </div>
                      <p className="text-sm text-[var(--text-muted)]">
                        {backend.description}
                      </p>
                      {backend.downloadSize && (
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                          Download: {backend.downloadSize}
                        </p>
                      )}
                    </div>
                    <div className={`
                      w-5 h-5 rounded-full border-2 flex items-center justify-center
                      ${selectedBackend === backend.id
                        ? 'border-accent bg-accent text-white'
                        : 'border-[var(--border)]'
                      }
                    `}>
                      {selectedBackend === backend.id && '✓'}
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            {/* OpenAI API Key input */}
            {selectedBackend === 'openai' && (
              <div className="mb-6">
                <Input
                  label="OpenAI API Key"
                  type="password"
                  placeholder="sk-..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </div>
            )}

            {/* Installation progress */}
            {isInstalling && (
              <div className="mb-6 p-4 bg-[var(--bg-secondary)] rounded-lg">
                <div className="flex items-center gap-3 mb-3">
                  <Spinner size="sm" />
                  <span className="text-sm text-[var(--text-primary)]">{installStatus}</span>
                </div>
                <ProgressBar value={installProgress} />
              </div>
            )}

            <div className="flex gap-3">
              <Button
                variant="ghost"
                onClick={handleSkip}
                className="flex-1"
              >
                Skip for now
              </Button>
              <Button
                variant="primary"
                onClick={handleBackendContinue}
                disabled={!selectedBackend || (selectedBackend === 'openai' && !apiKey.trim()) || isInstalling}
                isLoading={isInstalling}
                className="flex-1"
              >
                Continue →
              </Button>
            </div>
          </div>
        )}

        {/* Whisper Model Selection */}
        {step === 'whisper' && (
          <div>
            <h2 className="text-2xl font-bold text-[var(--text-secondary)] mb-2 text-center">
              Select Transcription Model
            </h2>
            <p className="text-[var(--text-muted)] mb-6 text-center">
              Choose the Whisper model for transcribing videos
            </p>

            <div className="space-y-3 mb-6">
              {whisperModels.map((model) => (
                <Card
                  key={model.id}
                  hover
                  padding="md"
                  onClick={() => setSelectedWhisper(model.id)}
                  className={`cursor-pointer ${
                    selectedWhisper === model.id
                      ? 'border-accent ring-1 ring-accent'
                      : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-[var(--text-secondary)]">
                        {model.name}
                      </h3>
                      <p className="text-sm text-[var(--text-muted)]">
                        {model.description}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-[var(--text-muted)]">{model.size}</span>
                      <div className={`
                        w-5 h-5 rounded-full border-2 flex items-center justify-center
                        ${selectedWhisper === model.id
                          ? 'border-accent bg-accent text-white'
                          : 'border-[var(--border)]'
                        }
                      `}>
                        {selectedWhisper === model.id && '✓'}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            <div className="flex gap-3">
              <Button
                variant="ghost"
                onClick={() => setStep('llm-backend')}
                className="flex-1"
              >
                ← Back
              </Button>
              <Button
                variant="primary"
                onClick={() => setStep('complete')}
                className="flex-1"
              >
                Continue →
              </Button>
            </div>
          </div>
        )}

        {/* Complete */}
        {step === 'complete' && (
          <div className="text-center">
            <div className="text-6xl mb-6">🎉</div>
            <h1 className="text-3xl font-bold text-[var(--text-secondary)] mb-3">
              You're all set!
            </h1>
            <p className="text-[var(--text-muted)] mb-8 max-w-md mx-auto">
              CourseVault is ready to use. You can change these settings
              anytime from the Settings page.
            </p>
            <Button size="lg" onClick={handleComplete}>
              Open CourseVault →
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
