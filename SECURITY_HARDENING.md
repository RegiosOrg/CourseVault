# CourseVault Security Hardening - Detailed Critique

This document provides a detailed security analysis of the CourseVault application with specific code references and actionable hardening recommendations.

---

## 🔴 CRITICAL VULNERABILITIES

### 1. License Validation Completely Client-Side (Trivial to Bypass)

**Location:** `src/stores/appStore.ts:356-391`

**Current Implementation:**
```typescript
activateLicense: async (key) => {
  // Accept keys that start with PRO/TEAM/START for testing
  // Or standard format: XXXXX-XXXXX-XXXXX-XXXXX
  const upperKey = key.toUpperCase().trim()
  const isDevKey = /^(PRO|TEAM|START)[-_]/.test(upperKey)
  const isStandardFormat = /^[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+$/.test(upperKey)

  if (!isDevKey && !isStandardFormat) {
    set((state) => ({
      license: { ...state.license, status: 'invalid', key: null }
    }))
    return false
  }

  // Determine tier based on key prefix
  let tier: LicenseTier = 'starter'
  if (upperKey.startsWith('PRO')) tier = 'pro'
  else if (upperKey.startsWith('TEAM')) tier = 'team'
  else if (upperKey.startsWith('START')) tier = 'starter'

  // Set expiry to 1 year from now
  const expiresAt = new Date()
  expiresAt.setFullYear(expiresAt.getFullYear() + 1)

  set({
    license: {
      key: key.toUpperCase(),
      tier,
      status: 'valid',
      email: null,
      expiresAt: expiresAt.toISOString()
    }
  })

  return true
}
```

**Vulnerability Analysis:**
1. **Regex-based validation only** - Any key matching the format is accepted
2. **No server verification** - No external validation or license server check
3. **Tier determined by prefix** - Simply typing "PRO-" grants pro access
4. **Expiry set client-side** - User can modify expiry dates in localStorage
5. **No revocation capability** - Cannot invalidate leaked keys

**Attack Vectors:**
- Any user can enter `PRO-XXXXX-XXXXX-XXXXX-XXXXX` and get pro tier immediately
- Edit localStorage directly: `localStorage.setItem('coursevault-storage', JSON.stringify({license: {tier: 'pro', status: 'valid', key: 'HACKED'}}))`
- Build a modified version of the app that skips validation entirely
- Distribute "cracked" versions with hardcoded pro licenses

**Recommended Fixes:**

**Option A: Server-Side License Validation (Recommended)**
```typescript
// Add to Python backend: course_library_server.py
LICENSE_VALIDATION_ENDPOINT = "https://api.coursevault.io/validate"

async def validate_license(key: str) -> dict:
    """Validate license key against server with signature verification."""
    try:
        response = await fetch(LICENSE_VALIDATION_ENDPOINT, {
            'method': 'POST',
            'headers': {'Content-Type': 'application/json'},
            'body': JSON.stringify({
                'key': key,
                'machine_id': get_machine_fingerprint(),  # Hardware-bound
                'timestamp': int(time.time())
            })
        })
        
        if response.status != 200:
            return {'valid': False, 'reason': 'Invalid key'}
        
        data = await response.json()
        
        # Verify signature to prevent tampering
        if not verify_signature(data, PUBLIC_KEY):
            return {'valid': False, 'reason': 'Tampered response'}
        
        return {
            'valid': True,
            'tier': data['tier'],
            'expires_at': data['expires_at'],
            'features': data['features']
        }
    except Exception as e:
        # Fail closed - if can't verify, don't grant access
        return {'valid': False, 'reason': 'Validation failed'}
```

**Option B: Cryptographic License Keys (Offline-capable)**
```typescript
// Use asymmetric cryptography for offline validation
import { verify } from 'crypto'

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...
-----END PUBLIC KEY-----`

async function validateLicenseCryptographically(key: string): Promise<boolean> {
  // License format: BASE64_DATA.SIGNATURE
  const [dataBase64, signatureBase64] = key.split('.')
  
  if (!dataBase64 || !signatureBase64) return false
  
  const data = Buffer.from(dataBase64, 'base64').toString()
  const signature = Buffer.from(signatureBase64, 'base64')
  
  // Verify signature using public key
  const isValid = verify('SHA256', Buffer.from(data), PUBLIC_KEY, signature)
  
  if (!isValid) return false
  
  // Parse and check expiry
  const licenseData = JSON.parse(data)
  if (new Date(licenseData.expires_at) < new Date()) {
    return false
  }
  
  // Check machine binding (optional)
  if (licenseData.machine_id && licenseData.machine_id !== getMachineId()) {
    return false
  }
  
  return true
}
```

**Option C: Minimum Viable Improvement (If no server)**
```typescript
// At minimum, add these protections:

activateLicense: async (key) => {
  // 1. Rate limit attempts
  const attempts = parseInt(sessionStorage.getItem('license_attempts') || '0')
  if (attempts > 5) {
    return { success: false, error: 'Too many attempts. Please try again later.' }
  }
  sessionStorage.setItem('license_attempts', String(attempts + 1))
  
  // 2. Use a hardcoded list of valid keys (better than regex-only)
  const VALID_KEYS_HASHES = [
    'sha256:abc123...',  // PRO-ABC123-DEF456 hashed
    'sha256:def456...',  // TEAM-XYZ789-ABC123 hashed
  ]
  
  const keyHash = await sha256(key.toUpperCase().trim())
  const isValidKey = VALID_KEYS_HASHES.includes(`sha256:${keyHash}`)
  
  if (!isValidKey) {
    return { success: false, error: 'Invalid license key' }
  }
  
  // 3. Store encrypted/obfuscated license state
  const encryptedLicense = await encryptLicenseData({
    key: keyHash,  // Store hash, not raw key
    tier: determineTier(key),
    activated_at: new Date().toISOString(),
    machine_id: await getMachineFingerprint()
  })
  
  localStorage.setItem('license_v2', encryptedLicense)
  
  return { success: true }
}
```

---

### 2. OpenAI API Keys Stored in localStorage (XSS Vulnerable)

**Location:** `src/stores/appStore.ts:289-294`, `src/stores/appStore.ts:445-466`

**Current Implementation:**
```typescript
// In persist middleware
partialize: (state) => ({
  // ... other fields
  openaiApiKey: state.openaiApiKey,  // ❌ Stored in localStorage!
})

// In onRehydrateStorage
window.electronAPI.setSettings('openaiApiKey', state.openaiApiKey)
```

**Vulnerability Analysis:**
1. **XSS Exposure** - Any injected script can read `localStorage.getItem('coursevault-storage')` and extract the API key
2. **No encryption** - Key stored in plaintext
3. **Persisted to disk unencrypted** - Electron localStorage files are readable
4. **Synced to both localStorage AND electron-store** - Double exposure

**Attack Vectors:**
- Malicious browser extension with storage access
- XSS via compromised dependency (supply chain attack)
- Physical access to computer - can read Electron localStorage files directly
- Network inspection if app ever serves over HTTP

**Recommended Fixes:**

**Primary Fix: Store in electron-store with encryption**
```typescript
// electron/main.ts - Modify store initialization
const store = new Store({
  encryptionKey: process.env.COURSEVAULT_ENCRYPTION_KEY || generateSecureKey(),
  defaults: {
    openaiApiKey: null,
    // ... other defaults
  }
})

// Generate unique encryption key per installation
function generateSecureKey(): string {
  const keyFile = path.join(app.getPath('userData'), '.encryption_key')
  
  if (fs.existsSync(keyFile)) {
    return fs.readFileSync(keyFile, 'utf8')
  }
  
  // Generate 256-bit key
  const key = crypto.randomBytes(32).toString('hex')
  fs.writeFileSync(keyFile, key, { mode: 0o600 })  // User read-only
  return key
}
```

**Frontend: Never store API keys in Zustand state**
```typescript
// src/stores/appStore.ts
export interface AppState {
  // Remove openaiApiKey from state
  // llmBackend: LLMBackend
  // ... no openaiApiKey field
}

// When needed, fetch from main process via IPC
async function getOpenAIKey(): Promise<string | null> {
  return await window.electronAPI.getSecureSetting('openaiApiKey')
}

// API client modification
async function chat(question: string, options?: {...}): Promise<...> {
  // Don't read from localStorage!
  const apiKey = await window.electronAPI.getSecureSetting('openaiApiKey')
  
  if (!apiKey) {
    throw new Error('OpenAI API key not configured')
  }
  
  // Use apiKey in request...
}
```

**Input Security: Mask API key in UI**
```typescript
// src/screens/Settings.tsx
function ApiKeyInput() {
  const [showKey, setShowKey] = useState(false)
  const [inputValue, setInputValue] = useState('')
  
  return (
    <div className="relative">
      <input
        type={showKey ? 'text' : 'password'}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        placeholder="sk-..."
        autoComplete="off"  // Prevent browser autofill
        data-lpignore="true"  // Prevent LastPass
      />
      <button onClick={() => setShowKey(!showKey)}>
        {showKey ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}
```

**Key Rotation: Warn users if key is exposed**
```typescript
// If key is ever read from localStorage (migration case), warn user
useEffect(() => {
  const legacyKey = localStorage.getItem('coursevault-storage')
  if (legacyKey && JSON.parse(legacyKey).state?.openaiApiKey) {
    // Show warning dialog
    showSecurityWarning({
      title: 'Security Update Required',
      message: 'Your API key was stored insecurely. Please re-enter it to secure your account.',
      action: () => {
        // Clear old storage and prompt for re-entry
        localStorage.removeItem('coursevault-storage')
      }
    })
  }
}, [])
```

---

### 3. Hardcoded Paths - Won't Work on Other Machines

**Locations:** 
- `electron/main.ts:44` - `C:/Stuff/webinar_transcriber`
- `src/stores/appStore.ts:193-194` - `W:/transcripts`, `W:/`
- `package.json:61` - `C:/Stuff/webinar_transcriber`

**Vulnerability Analysis:**
1. **Absolute Windows paths** - Won't work on macOS/Linux
2. **External drive assumption** - Assumes W: drive exists
3. **Development path in production config** - References personal directory
4. **No validation** - App crashes silently if paths don't exist

**Recommended Fixes:**

```typescript
// electron/main.ts
function getPythonPath(): string {
  if (isDev) {
    // Use environment variable or relative path
    return process.env.PYTHON_SCRIPTS_PATH || 
           path.join(__dirname, '../../python')
  }
  
  // In production, use app resources
  return path.join(process.resourcesPath, 'python')
}

// Validate paths on startup
async function validatePaths(): Promise<string[]> {
  const errors: string[] = []
  
  const pythonPath = getPythonPath()
  if (!fs.existsSync(pythonPath)) {
    errors.push(`Python scripts not found: ${pythonPath}`)
  }
  
  const serverScript = path.join(pythonPath, 'course_library_server.py')
  if (!fs.existsSync(serverScript)) {
    errors.push(`Server script not found: ${serverScript}`)
  }
  
  return errors
}

// Show error dialog if paths invalid
app.whenReady().then(async () => {
  const pathErrors = await validatePaths()
  
  if (pathErrors.length > 0) {
    dialog.showErrorBox(
      'Configuration Error',
      `Missing required files:\n\n${pathErrors.join('\n')}\n\n` +
      `Please reinstall the application.`
    )
    app.quit()
  }
})
```

**For user-configurable paths (transcripts, source directories):**
```typescript
// src/stores/appStore.ts - Better defaults
sourceDirectories: (() => {
  // Detect home directory and suggest reasonable defaults
  const home = os.homedir()
  const platformDefaults: Record<string, string[]> = {
    win32: [path.join(home, 'Documents', 'Courses')],
    darwin: [path.join(home, 'Documents', 'Courses')],
    linux: [path.join(home, 'Documents', 'Courses')]
  }
  
  return platformDefaults[process.platform] || [home]
})()
```

---

### 4. No IPC Input Validation

**Location:** `electron/main.ts:559-604`

**Current Implementation:**
```typescript
ipcMain.handle('set-settings', (_, key: string, value: any) => {
  store.set(key, value)  // ❌ No validation!
  return true
})

ipcMain.handle('open-external', (_, url: string) => {
  shell.openExternal(url)  // ❌ Could open malicious URL!
})
```

**Vulnerability Analysis:**
1. **Arbitrary settings injection** - Renderer can set any store key to any value
2. **Command injection via URL** - `javascript:alert('xss')` or `file://` protocols
3. **Path traversal via settings** - Could modify `pythonPath` to execute arbitrary scripts
4. **Prototype pollution** - Setting `__proto__` or `constructor` keys

**Attack Example:**
```javascript
// From DevTools in renderer process:
window.electronAPI.setSettings('__proto__', {polluted: true})
window.electronAPI.setSettings('pythonPath', 'C:/malicious')
window.electronAPI.openExternal('javascript:alert("XSS")')
```

**Recommended Fixes:**

```typescript
// electron/main.ts
import { z } from 'zod'

// Define valid settings schema
const SettingsSchema = z.object({
  llmBackend: z.enum(['ollama', 'lmstudio', 'openai']).nullable(),
  openaiApiKey: z.string().nullable(),
  transcriptsPath: z.string().regex(/^[a-zA-Z0-9_\/:-]+$/),  // No .. or special chars
  sourceDirectories: z.array(z.string().regex(/^[a-zA-Z0-9_\/:-]+$/)),
  serverPort: z.number().int().min(1024).max(65535),
  theme: z.enum(['dark', 'light']),
  gpuAcceleration: z.boolean(),
  parallelWorkers: z.number().int().min(1).max(8),
  whisperModel: z.enum(['tiny.en', 'base.en', 'small.en', 'medium.en', 'large'])
})

// Validate all IPC inputs
ipcMain.handle('set-settings', (_, key: string, value: unknown) => {
  // Validate key is allowed
  const allowedKeys = Object.keys(SettingsSchema.shape)
  if (!allowedKeys.includes(key)) {
    console.error(`Rejected attempt to set invalid setting: ${key}`)
    return { success: false, error: 'Invalid setting key' }
  }
  
  // Validate value using schema
  const fieldSchema = SettingsSchema.shape[key as keyof typeof SettingsSchema.shape]
  const result = fieldSchema.safeParse(value)
  
  if (!result.success) {
    console.error(`Invalid value for ${key}:`, result.error)
    return { success: false, error: 'Invalid value' }
  }
  
  // Set validated value
  store.set(key, result.data)
  return { success: true }
})

// Validate URLs strictly
ipcMain.handle('open-external', (_, url: string) => {
  // Only allow http/https protocols
  const allowedProtocols = ['http:', 'https:']
  
  try {
    const parsed = new URL(url)
    
    if (!allowedProtocols.includes(parsed.protocol)) {
      console.error(`Blocked attempt to open URL with protocol: ${parsed.protocol}`)
      return { success: false, error: 'Invalid protocol' }
    }
    
    // Block internal IPs and localhost (SSRF protection)
    const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1']
    if (blockedHosts.includes(parsed.hostname)) {
      console.error(`Blocked attempt to open internal URL: ${url}`)
      return { success: false, error: 'Invalid URL' }
    }
    
    shell.openExternal(url)
    return { success: true }
  } catch (error) {
    return { success: false, error: 'Invalid URL format' }
  }
})

// Sanitize folder selection results
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory']
  })
  
  if (!result.filePaths[0]) {
    return null
  }
  
  const selectedPath = result.filePaths[0]
  
  // Validate path exists and is a directory
  try {
    const stats = fs.statSync(selectedPath)
    if (!stats.isDirectory()) {
      return null
    }
    
    // Check for suspicious paths
    const suspiciousPatterns = [
      /\.\./,           // Path traversal
      /[<>|&$`]/,       // Shell metacharacters
      /\0/              // Null byte injection
    ]
    
    for (const pattern of suspiciousPatterns) {
      if (pattern.test(selectedPath)) {
        console.error(`Suspicious path selected: ${selectedPath}`)
        return null
      }
    }
    
    return selectedPath
  } catch (error) {
    return null
  }
})
```

---

### 5. CORS Allowing All Origins

**Location:** Python backend (`course_library_server.py`)

**Likely Current Implementation:**
```python
# course_library_server.py
self.send_header('Access-Control-Allow-Origin', '*')
```

**Vulnerability Analysis:**
1. **Any website can call your API** - Malicious sites can interact with local server
2. **CSRF attacks possible** - Attacker can make requests on user's behalf
3. **Information disclosure** - External sites can read transcript data

**Recommended Fixes:**

```python
# course_library_server.py
ALLOWED_ORIGINS = [
    'http://localhost:5173',      # Vite dev server
    'http://127.0.0.1:5173',      # Alternative dev
    'file://',                   # Production Electron app
]

class RequestHandler(BaseHTTPRequestHandler):
    def end_headers(self):
        origin = self.headers.get('Origin', '')
        
        # Only allow specific origins
        if origin in ALLOWED_ORIGINS or origin.startswith('file://'):
            self.send_header('Access-Control-Allow-Origin', origin)
        else:
            # No CORS header for unknown origins (browsers will block)
            pass
        
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()
```

**Even better: Add request signature validation**
```python
# Add a secret that only the Electron app knows
APP_SECRET = os.environ.get('COURSEVAULT_SECRET') or generate_app_secret()

def validate_request_signature(request) -> bool:
    """Verify request came from legitimate Electron app."""
    signature = request.headers.get('X-Request-Signature')
    timestamp = request.headers.get('X-Request-Timestamp')
    
    if not signature or not timestamp:
        return False
    
    # Check timestamp to prevent replay attacks
    try:
        request_time = int(timestamp)
        if abs(time.time() - request_time) > 300:  # 5 minute window
            return False
    except ValueError:
        return False
    
    # Verify HMAC signature
    expected = hmac.new(
        APP_SECRET.encode(),
        f'{timestamp}:{request.path}'.encode(),
        hashlib.sha256
    ).hexdigest()
    
    return hmac.compare_digest(signature, expected)
```

---

### 6. API Client Missing Request Signature

**Location:** `src/api/client.ts:20-35`

**Vulnerability Analysis:**
1. **No authentication to local server** - Any process can call `http://127.0.0.1:8080/api/courses`
2. **No request signing** - Cannot verify requests came from the app
3. **No rate limiting** - Could be abused by other applications

**Recommended Fixes:**

```typescript
// src/api/client.ts
import { createHmac } from 'crypto'

const APP_SECRET = process.env.COURSEVAULT_SECRET || 'default-dev-secret'

function generateRequestSignature(path: string): { signature: string; timestamp: string } {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const data = `${timestamp}:${path}`
  
  const signature = createHmac('sha256', APP_SECRET)
    .update(data)
    .digest('hex')
  
  return { signature, timestamp }
}

class APIClient {
  async fetchCourseData(): Promise<CourseData> {
    const url = `${this.baseUrl}/api/courses`
    const { signature, timestamp } = generateRequestSignature('/api/courses')
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Request-Signature': signature,
        'X-Request-Timestamp': timestamp
      },
      signal: AbortSignal.timeout(10000)
    })
    
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`)
    }
    
    return response.json()
  }
}
```

---

### 7. Python Server No Request Size Limits

**Vulnerability Analysis:**
1. **DoS via large payloads** - Attacker can send huge JSON bodies
2. **Memory exhaustion** - Server tries to parse massive requests
3. **Crash on malformed data** - No handling for invalid JSON

**Recommended Fix:**

```python
# course_library_server.py
MAX_REQUEST_SIZE = 10 * 1024 * 1024  # 10 MB limit
MAX_JSON_DEPTH = 10  # Prevent deeply nested JSON attacks

def handle_post_request(self):
    content_length = int(self.headers.get('Content-Length', 0))
    
    # Reject oversized requests
    if content_length > MAX_REQUEST_SIZE:
        self.send_error(413, 'Request Entity Too Large')
        return
    
    # Read with timeout
    try:
        body = self.rfile.read(content_length)
    except Exception as e:
        self.send_error(400, 'Failed to read request body')
        return
    
    # Parse JSON with depth limit
    try:
        import json
        data = json.loads(body, parse_constant=lambda x: None)  # Reject Infinity, NaN
        
        # Check JSON depth to prevent stack overflow
        def check_depth(obj, depth=0):
            if depth > MAX_JSON_DEPTH:
                raise ValueError('JSON too deeply nested')
            if isinstance(obj, dict):
                for v in obj.values():
                    check_depth(v, depth + 1)
            elif isinstance(obj, list):
                for item in obj:
                    check_depth(item, depth + 1)
        
        check_depth(data)
        
    except json.JSONDecodeError:
        self.send_error(400, 'Invalid JSON')
        return
    except ValueError as e:
        self.send_error(400, str(e))
        return
    
    # Process validated request...
```

---

### 8. Missing Security Headers in Electron

**Location:** `electron/main.ts:443-508` (createWindow)

**Vulnerability Analysis:**
1. **No CSP** - XSS possible via injected scripts
2. **No X-Frame-Options** - Clickjacking possible
3. **No HTTPS enforcement** - Mixed content possible

**Recommended Fix:**

```typescript
// electron/main.ts
function createWindow(): void {
  // ... existing window setup ...
  
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self';" +
          "script-src 'self' 'unsafe-inline';" +  // Required for React
          "style-src 'self' 'unsafe-inline';" +
          "img-src 'self' data: blob:;" +
          "font-src 'self';" +
          "connect-src 'self' http://127.0.0.1:*;"  // Local Python server only
        ],
        'X-Content-Type-Options': ['nosniff'],
        'X-Frame-Options': ['DENY'],
        'X-XSS-Protection': ['1; mode=block'],
        'Referrer-Policy': ['strict-origin-when-cross-origin']
      }
    })
  })
  
  // Disable navigation to external URLs
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowedProtocols = ['http://localhost:', 'http://127.0.0.1:', 'file://']
    const isAllowed = allowedProtocols.some(protocol => url.startsWith(protocol))
    
    if (!isAllowed) {
      console.log(`Blocked navigation to: ${url}`)
      event.preventDefault()
    }
  })
}
```

---

## 🟡 MEDIUM PRIORITY ISSUES

### 9. Dev Mode Grants Pro License (Developer Backdoor)

**Location:** `src/stores/appStore.ts:203-209`

```typescript
license: {
  key: import.meta.env.DEV ? 'DEV-MODE-PRO' : null,
  tier: import.meta.env.DEV ? 'pro' : 'free',
  status: import.meta.env.DEV ? 'valid' : 'none',
  email: import.meta.env.DEV ? 'dev@localhost' : null,
  expiresAt: null
}
```

**Risk:** If production build accidentally includes DEV mode or is built with wrong config, all users get pro features free.

**Fix:**
```typescript
// Use explicit environment check, not just DEV flag
const isDevMode = import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEV_LICENSES === 'true'

license: {
  key: isDevMode ? 'DEV-MODE-PRO' : null,
  tier: isDevMode ? 'pro' : 'free',
  // ...
}
```

---

### 10. File Upload/Path Traversal in Delete Endpoint

**Location:** Python backend `course_library_server.py` (delete-course endpoint)

**Vulnerability Analysis:**
Even if path traversal protection exists, verify it's complete:

```python
# Inadequate protection:
course = data.get('course', '')
if '..' in course:  # ❌ Only checks for .., not other traversal methods
    return error

# Bypasses:
# /etc/passwd  (absolute path)
# ....//....//etc/passwd  (double encoding)
# %2e%2e%2f%2e%2e%2fetc%2fpasswd  (URL encoding)
# ..%252f..%252fetc/passwd  (double URL encoding)
```

**Recommended Fix:**

```python
import re
import os

def sanitize_course_name(course_name: str) -> str | None:
    """Sanitize and validate course name to prevent path traversal."""
    
    # Normalize the path
    course_name = os.path.normpath(course_name)
    
    # Must not contain any path separators after normalization
    if os.path.sep in course_name or (os.path.altsep and os.path.altsep in course_name):
        return None
    
    # Must not start with . (hidden files)
    if course_name.startswith('.'):
        return None
    
    # Must match expected pattern (alphanumeric, spaces, dashes, underscores)
    if not re.match(r'^[\w\s-]+$', course_name):
        return None
    
    # Length limit
    if len(course_name) > 200:
        return None
    
    return course_name

def delete_course(course_name: str) -> dict:
    """Delete a course with proper validation."""
    
    # Validate course name
    safe_name = sanitize_course_name(course_name)
    if not safe_name:
        return {'success': False, 'error': 'Invalid course name'}
    
    # Build path within allowed base directories only
    base_dirs = get_allowed_base_directories()  # From config
    
    found = False
    for base_dir in base_dirs:
        course_path = os.path.join(base_dir, safe_name)
        
        # Verify path is within base directory (double-check)
        real_course_path = os.path.realpath(course_path)
        real_base_dir = os.path.realpath(base_dir)
        
        if not real_course_path.startswith(real_base_dir + os.sep):
            continue  # Path traversal attempt detected
        
        if os.path.exists(real_course_path):
            # Safe to delete
            shutil.rmtree(real_course_path)
            found = True
            break
    
    if not found:
        return {'success': False, 'error': 'Course not found'}
    
    return {'success': True}
```

---

### 11. Error Messages Leak File System Information

**Location:** Various Python backend error handlers

**Risk:** Detailed error messages reveal internal paths and system structure.

**Fix:**
```python
# ❌ DON'T: Return detailed errors to client
except Exception as e:
    return {'error': f'Failed to process {file_path}: {str(e)}'}

# ✅ DO: Log details server-side, return generic message to client
except Exception as e:
    logger.error(f'Processing failed for {file_path}: {e}', exc_info=True)
    return {'error': 'Processing failed. Please try again.'}
```

---

## 📋 SECURITY HARDENING CHECKLIST

### Immediate Actions (Before Next Release)
- [ ] Implement server-side or cryptographic license validation
- [ ] Move API keys from localStorage to encrypted electron-store
- [ ] Add IPC input validation with Zod schemas
- [ ] Fix hardcoded paths to use environment variables or relative paths
- [ ] Add CORS origin restrictions
- [ ] Implement request signing between frontend and Python server
- [ ] Add request size limits to Python server
- [ ] Add security headers (CSP, X-Frame-Options)

### High Priority (Next 2 Weeks)
- [ ] Add rate limiting to all endpoints
- [ ] Implement comprehensive path sanitization
- [ ] Remove dev-mode license backdoor
- [ ] Add request logging for security audit trail
- [ ] Sanitize error messages to prevent info leakage
- [ ] Add integrity checks for bundled Python scripts

### Medium Priority (Next Month)
- [ ] Implement certificate pinning for license server
- [ ] Add automatic security updates mechanism
- [ ] Security audit of Python dependencies
- [ ] Implement file type validation for uploads
- [ ] Add intrusion detection for unusual API patterns

---

## 🎯 SUMMARY

The CourseVault application has several **critical security vulnerabilities** that must be addressed before any commercial release:

1. **License system is trivially bypassable** - Currently provides no real protection
2. **API keys stored insecurely** - Vulnerable to XSS and local attacks
3. **Hardcoded paths** - Will break on most user machines
4. **No IPC validation** - Arbitrary code execution possible
5. **No CORS restrictions** - External sites can access local API
6. **No request authentication** - Any process can interact with backend

**Estimated effort:** 2-3 weeks for full security implementation
**Priority:** CRITICAL - Do not ship to customers without these fixes
