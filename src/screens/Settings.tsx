import { useState, useEffect } from 'react'
import { useAppStore, LLMBackend, TIER_LIMITS } from '@/stores/appStore'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Toggle } from '@/components/ui/Toggle'
import { Card, CardHeader } from '@/components/ui/Card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs'
import { ToastProvider, useToast } from '@/components/ui/Toast'

function SettingsContent() {
  const {
    theme,
    setTheme,
    llmBackend,
    setLLMBackend,
    transcriptsPath,
    setTranscriptsPath,
    sourceDirectories,
    addSourceDirectory,
    removeSourceDirectory,
    serverPort,
    setServerPort,
    whisperModel,
    setWhisperModel,
    parallelWorkers,
    setParallelWorkers,
    gpuAcceleration,
    setGpuAcceleration,
    setScreen,
    setIsFirstRun,
    license,
    activateLicense,
    clearLicense
  } = useAppStore()

  const toast = useToast()
  const [localPort, setLocalPort] = useState(String(serverPort))
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false)
  const [licenseKey, setLicenseKey] = useState('')
  const [isActivating, setIsActivating] = useState(false)
  const [lmStudioModel, setLmStudioModel] = useState(localStorage.getItem('lmstudio-model') || 'default')
  const [ollamaModels, setOllamaModels] = useState<Array<{ name: string; size: number }>>([])
  const [ollamaModel, setOllamaModel] = useState(localStorage.getItem('ollama-model') || '')
  const [isLoadingModels, setIsLoadingModels] = useState(false)

  // Calculate actual usage from course data
  const courseData = useAppStore((s) => s.courseData)
  const actualCoursesIndexed = courseData?.courses?.length || 0
  const actualHoursTranscribed = courseData?.courses?.reduce((total, course) => {
    // Estimate ~3 minutes per video on average
    return total + (course.videos.length * 3 / 60)
  }, 0) || 0

  const handleSavePort = () => {
    const port = parseInt(localPort)
    if (port > 0 && port < 65536) {
      setServerPort(port)
      toast.success('Port updated. Restart the app to apply.')
    } else {
      toast.error('Invalid port number')
    }
  }

  const handleSelectFolder = async () => {
    if (window.electronAPI) {
      const folder = await window.electronAPI.selectFolder()
      if (folder) {
        setTranscriptsPath(folder)
        toast.success('Transcripts folder updated')
      }
    }
  }

  const handleRestartSetup = () => {
    setIsFirstRun(true)
    setScreen('setup')
  }

  const handleQuitApp = () => {
    if (window.electronAPI?.quitApp) {
      window.electronAPI.quitApp()
    }
  }

  const handleActivateLicense = async () => {
    if (!licenseKey.trim()) {
      toast.error('Please enter a license key')
      return
    }

    setIsActivating(true)
    try {
      const success = await activateLicense(licenseKey)
      if (success) {
        toast.success('License activated successfully!')
        setLicenseKey('')
      } else {
        toast.error('Invalid license key format')
      }
    } catch {
      toast.error('Failed to activate license')
    } finally {
      setIsActivating(false)
    }
  }

  const handleClearLicense = () => {
    clearLicense()
    toast.info('License cleared. You are now on the Free tier.')
  }

  const handleCheckUpdates = async () => {
    setIsCheckingUpdates(true)
    try {
      // Simulate checking for updates - in production this would call a real API
      await new Promise(resolve => setTimeout(resolve, 1500))
      toast.success('You are running the latest version (1.0.0)')
    } catch {
      toast.error('Failed to check for updates')
    } finally {
      setIsCheckingUpdates(false)
    }
  }

  const handleLmStudioModelChange = (model: string) => {
    setLmStudioModel(model)
    localStorage.setItem('lmstudio-model', model)
    toast.success(`LM Studio model set to: ${model}`)
  }

  const handleOllamaModelChange = (model: string) => {
    setOllamaModel(model)
    localStorage.setItem('ollama-model', model)
    toast.success(`Ollama model set to: ${model}`)
  }

  // Fetch Ollama models when backend is set to Ollama
  useEffect(() => {
    if (llmBackend !== 'ollama') return

    const fetchModels = async () => {
      if (!window.electronAPI?.getOllamaModels) return
      setIsLoadingModels(true)
      try {
        const result = await window.electronAPI.getOllamaModels()
        if (result.success && result.models.length > 0) {
          setOllamaModels(result.models)
          // Auto-select first model if none selected
          if (!ollamaModel && result.models.length > 0) {
            const firstModel = result.models[0].name
            setOllamaModel(firstModel)
            localStorage.setItem('ollama-model', firstModel)
          }
        }
      } catch (err) {
        console.error('Failed to fetch Ollama models:', err)
      } finally {
        setIsLoadingModels(false)
      }
    }

    fetchModels()
  }, [llmBackend])


  const tierLimits = TIER_LIMITS[license.tier]

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="flex-shrink-0 bg-[var(--bg-secondary)] border-b border-[var(--border)] px-6 py-4 flex items-center gap-4">
        <button
          onClick={() => setScreen('dashboard')}
          className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-xl font-semibold text-[var(--text-secondary)]">Settings</h1>
      </div>

      {/* Content - scrollable with padding for status bar */}
      <div className="flex-1 overflow-y-auto pb-24">
        <div className="max-w-2xl mx-auto p-6">
          <Tabs defaultValue="general">
          <TabsList className="mb-6 bg-[var(--bg-secondary)] rounded-lg">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="ai">AI Models</TabsTrigger>
            <TabsTrigger value="processing">Processing</TabsTrigger>
            <TabsTrigger value="about">About</TabsTrigger>
          </TabsList>

          {/* General Settings */}
          <TabsContent value="general" className="space-y-6">
            <Card padding="lg">
              <CardHeader
                title="Appearance"
                description="Customize how CourseVault looks"
              />
              <div className="mt-4">
                <Select
                  label="Theme"
                  value={theme}
                  onChange={(e) => setTheme(e.target.value as any)}
                  options={[
                    { value: 'dark', label: 'Dark' },
                    { value: 'light', label: 'Light' }
                  ]}
                />
              </div>
            </Card>

            <Card padding="lg">
              <CardHeader
                title="Transcripts Location"
                description="Where your course transcripts are stored"
              />
              <div className="mt-4 flex gap-3">
                <Input
                  value={transcriptsPath}
                  readOnly
                  className="flex-1"
                />
                <Button variant="secondary" onClick={handleSelectFolder}>
                  Browse
                </Button>
              </div>
            </Card>

            <Card padding="lg">
              <CardHeader
                title="Source Directories"
                description="Folders to scan for video courses"
              />
              <div className="mt-4 space-y-3">
                {/* List of directories */}
                {sourceDirectories.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)]">No directories configured</p>
                ) : (
                  <div className="space-y-2">
                    {sourceDirectories.map((dir, idx) => (
                      <div key={idx} className="flex items-center gap-2 p-2 bg-[var(--bg-tertiary)] rounded">
                        <span className="flex-1 text-sm text-[var(--text-primary)] truncate">{dir}</span>
                        <button
                          onClick={() => {
                            removeSourceDirectory(dir)
                            toast.info(`Removed ${dir}`)
                          }}
                          className="p-1 text-[var(--text-muted)] hover:text-error hover:bg-error/10 rounded"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {/* Add directory button */}
                <Button
                  variant="secondary"
                  onClick={async () => {
                    if (window.electronAPI) {
                      const folder = await window.electronAPI.selectFolder()
                      if (folder) {
                        addSourceDirectory(folder)
                        toast.success(`Added ${folder}`)
                      }
                    }
                  }}
                >
                  Add Directory
                </Button>
                <p className="text-xs text-[var(--text-muted)]">
                  Add drives or folders containing your video courses. The transcriber will scan all of them.
                </p>
              </div>
            </Card>

            <Card padding="lg">
              <CardHeader
                title="Server Port"
                description="Port for the local backend server"
              />
              <div className="mt-4 flex gap-3">
                <Input
                  type="number"
                  value={localPort}
                  onChange={(e) => setLocalPort(e.target.value)}
                  className="w-32"
                />
                <Button variant="secondary" onClick={handleSavePort}>
                  Save
                </Button>
              </div>
            </Card>
          </TabsContent>

          {/* AI Models */}
          <TabsContent value="ai" className="space-y-6">
            <Card padding="lg">
              <CardHeader
                title="LLM Backend"
                description="Service used for AI summaries and chat"
              />
              <div className="mt-4 space-y-4">
                <Select
                  label="Backend"
                  value={llmBackend || ''}
                  onChange={(e) => {
                    const backend = (e.target.value || null) as LLMBackend
                    setLLMBackend(backend)
                    if (backend) {
                      toast.success(`LLM backend set to ${backend === 'lmstudio' ? 'LM Studio' : 'Ollama'}`)
                    } else {
                      toast.info('LLM backend disabled')
                    }
                  }}
                  options={[
                    { value: '', label: 'None (disabled)' },
                    { value: 'ollama', label: 'Ollama (Recommended)' },
                    { value: 'lmstudio', label: 'LM Studio' }
                  ]}
                />

                {llmBackend === 'lmstudio' && (
                  <div className="space-y-3">
                    <Select
                      label="LM Studio Model"
                      value={lmStudioModel}
                      onChange={(e) => handleLmStudioModelChange(e.target.value)}
                      options={[
                        { value: 'default', label: 'Default (use LM Studio selection)' },
                        { value: 'llama-3.2-3b-instruct', label: 'Llama 3.2 3B Instruct' },
                        { value: 'llama-3.1-8b-instruct', label: 'Llama 3.1 8B Instruct' },
                        { value: 'mistral-7b-instruct-v0.3', label: 'Mistral 7B Instruct v0.3' },
                        { value: 'qwen2.5-7b-instruct', label: 'Qwen 2.5 7B Instruct' },
                        { value: 'phi-3-mini-4k-instruct', label: 'Phi-3 Mini 4K Instruct' },
                        { value: 'gemma-2-9b-it', label: 'Gemma 2 9B IT' }
                      ]}
                    />
                    <p className="text-xs text-[var(--text-muted)]">
                      Make sure LM Studio is running on localhost:1234 with your chosen model loaded.
                    </p>
                  </div>
                )}


                {llmBackend === 'ollama' && (
                  <div className="space-y-3">
                    {isLoadingModels ? (
                      <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                        <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                        Loading models...
                      </div>
                    ) : ollamaModels.length > 0 ? (
                      <Select
                        label="Ollama Model"
                        value={ollamaModel}
                        onChange={(e) => handleOllamaModelChange(e.target.value)}
                        options={ollamaModels.map(m => ({
                          value: m.name,
                          label: `${m.name} (${(m.size / 1e9).toFixed(1)}GB)`
                        }))}
                      />
                    ) : (
                      <div className="space-y-2">
                        <p className="text-sm text-[var(--text-muted)]">
                          No models found. Make sure Ollama is running.
                        </p>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={async () => {
                            if (!window.electronAPI?.getOllamaModels) return
                            setIsLoadingModels(true)
                            const result = await window.electronAPI.getOllamaModels()
                            if (result.success) {
                              setOllamaModels(result.models)
                              if (result.models.length > 0) {
                                toast.success(`Found ${result.models.length} models`)
                              } else {
                                toast.warning('No models installed. Run: ollama pull llama3.2:3b')
                              }
                            } else {
                              toast.error(result.error || 'Failed to fetch models')
                            }
                            setIsLoadingModels(false)
                          }}
                        >
                          Refresh Models
                        </Button>
                      </div>
                    )}
                    <p className="text-xs text-[var(--text-muted)]">
                      {ollamaModels.length > 0
                        ? 'Select a model from your installed Ollama models.'
                        : 'Install models with: ollama pull llama3.2:3b'}
                    </p>
                  </div>
                )}
              </div>
            </Card>

            <Card padding="lg">
              <CardHeader
                title="Whisper Model"
                description="Model used for transcription"
              />
              <div className="mt-4">
                <Select
                  value={whisperModel}
                  onChange={(e) => setWhisperModel(e.target.value)}
                  options={[
                    { value: 'base.en', label: 'Base (140MB) - Fast' },
                    { value: 'small.en', label: 'Small (460MB) - Better' },
                    { value: 'medium.en', label: 'Medium (1.5GB) - High quality' },
                    { value: 'large', label: 'Large (3.1GB) - Best quality' }
                  ]}
                />
              </div>
            </Card>

            <div className="flex gap-3">
              <Button variant="secondary" onClick={handleRestartSetup}>
                Run Setup Wizard Again
              </Button>
              <Button variant="danger" onClick={handleQuitApp}>
                Quit Application
              </Button>
            </div>
          </TabsContent>

          {/* Processing */}
          <TabsContent value="processing" className="space-y-6">
            <Card padding="lg">
              <CardHeader
                title="GPU Acceleration"
                description="Use GPU for faster transcription (if available)"
              />
              <div className="mt-4">
                <Toggle
                  label="Enable GPU acceleration"
                  description="Requires NVIDIA GPU with CUDA support. Restart transcription to apply."
                  checked={gpuAcceleration}
                  onChange={async (e) => {
                    setGpuAcceleration(e.target.checked)
                    toast.success(`GPU acceleration ${e.target.checked ? 'enabled' : 'disabled'}`)
                    // Restart transcription worker to apply the new setting
                    if (window.electronAPI) {
                      const status = await window.electronAPI.getTranscriptionStatus?.()
                      if (status?.running) {
                        await window.electronAPI.stopTranscription?.()
                        await window.electronAPI.startTranscription?.()
                        toast.info('Transcription worker restarted with new settings')
                      }
                    }
                  }}
                />
              </div>
            </Card>

            <Card padding="lg">
              <CardHeader
                title="Parallel Processing"
                description="Number of courses to process simultaneously"
              />
              <div className="mt-4">
                <Select
                  value={String(parallelWorkers)}
                  onChange={async (e) => {
                    const workers = Number(e.target.value)
                    setParallelWorkers(workers)
                    // Sync to electron store and restart workers
                    if (window.electronAPI) {
                      await window.electronAPI.setSettings('parallelWorkers', workers)
                      // Check if workers are running and restart them
                      const status = await window.electronAPI.getTranscriptionStatus?.()
                      if (status?.running) {
                        toast.info(`Restarting with ${workers} workers...`)
                        await window.electronAPI.stopTranscription?.()
                        await window.electronAPI.startTranscription?.()
                        toast.success(`Now running ${workers} workers`)
                      } else {
                        toast.success(`Worker count set to ${workers}`)
                      }
                    }
                  }}
                  options={[
                    { value: '1', label: '1 worker (Low memory usage)' },
                    { value: '2', label: '2 workers (Balanced)' },
                    { value: '4', label: '4 workers (Fast, high memory)' }
                  ]}
                />
                <p className="text-xs text-[var(--text-muted)] mt-2">
                  Run multiple transcription workers in parallel. Each worker processes one course at a time.
                  Higher values use more CPU/GPU and memory.
                </p>
              </div>
            </Card>
          </TabsContent>

          {/* About */}
          <TabsContent value="about" className="space-y-6">
            <Card padding="lg">
              <div className="text-center">
                <div className="text-5xl mb-4">📚</div>
                <h2 className="text-xl font-bold text-[var(--text-secondary)]">
                  CourseVault
                </h2>
                <p className="text-[var(--text-muted)] mt-1">
                  Version 1.0.0
                </p>
                <p className="text-sm text-[var(--text-muted)] mt-4">
                  Your course library, searchable at last
                </p>
              </div>
            </Card>

            <Card padding="lg">
              <CardHeader
                title="Check for Updates"
                description="Make sure you have the latest version"
              />
              <div className="mt-4">
                <Button
                  variant="secondary"
                  onClick={handleCheckUpdates}
                  disabled={isCheckingUpdates}
                >
                  {isCheckingUpdates ? 'Checking...' : 'Check for Updates'}
                </Button>
              </div>
            </Card>

            <Card padding="lg">
              <CardHeader
                title="License"
                description="Manage your CourseVault license"
              />
              <div className="mt-4 space-y-4">
                {/* Current tier info */}
                <div className="flex items-center justify-between p-3 bg-[var(--bg-tertiary)] rounded-lg">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[var(--text-primary)] capitalize">
                        {license.tier} Plan
                      </span>
                      {license.status === 'valid' && license.tier !== 'free' && (
                        <span className="px-2 py-0.5 text-xs bg-success/20 text-success rounded-full">
                          Active
                        </span>
                      )}
                    </div>
                    {license.expiresAt && (
                      <p className="text-xs text-[var(--text-muted)] mt-1">
                        Expires: {new Date(license.expiresAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  {license.key && license.tier !== 'free' && (
                    <Button variant="ghost" size="sm" onClick={handleClearLicense}>
                      Clear
                    </Button>
                  )}
                </div>

                {/* Usage stats */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className={`p-3 rounded-lg ${actualHoursTranscribed > tierLimits.hours ? 'bg-warning/10 border border-warning/30' : 'bg-[var(--bg-tertiary)]'}`}>
                    <div className="text-[var(--text-muted)]">Hours Transcribed</div>
                    <div className={`text-lg font-medium ${actualHoursTranscribed > tierLimits.hours ? 'text-warning' : 'text-[var(--text-primary)]'}`}>
                      {actualHoursTranscribed.toFixed(1)} / {tierLimits.hours === Infinity ? '∞' : tierLimits.hours}
                    </div>
                  </div>
                  <div className={`p-3 rounded-lg ${actualCoursesIndexed > tierLimits.courses ? 'bg-warning/10 border border-warning/30' : 'bg-[var(--bg-tertiary)]'}`}>
                    <div className="text-[var(--text-muted)]">Courses Indexed</div>
                    <div className={`text-lg font-medium ${actualCoursesIndexed > tierLimits.courses ? 'text-warning' : 'text-[var(--text-primary)]'}`}>
                      {actualCoursesIndexed} / {tierLimits.courses === Infinity ? '∞' : tierLimits.courses}
                    </div>
                  </div>
                </div>

                {/* Upgrade warning if over limit */}
                {(actualHoursTranscribed > tierLimits.hours || actualCoursesIndexed > tierLimits.courses) && license.tier === 'free' && (
                  <div className="p-3 rounded-lg bg-warning/10 border border-warning/30">
                    <div className="flex items-center gap-2 text-warning">
                      <span>⚠️</span>
                      <span className="text-sm">You've exceeded free tier limits. Consider upgrading for continued access.</span>
                    </div>
                  </div>
                )}

                {/* License key input */}
                {license.tier === 'free' && (
                  <>
                    <div className="flex gap-3">
                      <Input
                        placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
                        value={licenseKey}
                        onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
                        className="flex-1 font-mono"
                      />
                      <Button
                        variant="primary"
                        onClick={handleActivateLicense}
                        disabled={isActivating}
                      >
                        {isActivating ? 'Activating...' : 'Activate'}
                      </Button>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] text-center">
                      Enter a license key starting with START-, PRO-, or TEAM- to upgrade.
                    </p>
                  </>
                )}

                {/* Tier comparison */}
                <div className="text-xs text-[var(--text-muted)] pt-2 border-t border-[var(--border)]">
                  <div className="font-medium mb-2">Plan Limits:</div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>Free: 100 hrs, 20 courses</div>
                    <div>Starter: 500 hrs, 100 courses</div>
                    <div>Pro/Team: Unlimited</div>
                  </div>
                </div>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
        </div>
      </div>
    </div>
  )
}

export default function Settings() {
  return (
    <ToastProvider>
      <SettingsContent />
    </ToastProvider>
  )
}
