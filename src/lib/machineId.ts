/**
 * Machine ID generation for license binding
 *
 * Creates a unique identifier for the machine based on hardware characteristics.
 * This prevents unlimited license sharing while allowing reasonable portability.
 */

/**
 * Get machine ID from the Electron main process
 * The actual fingerprinting is done in the main process for security
 */
export async function getMachineId(): Promise<string> {
  if (window.electronAPI?.getMachineId) {
    return await window.electronAPI.getMachineId()
  }

  // Fallback for browser/dev mode - use localStorage-based ID
  const storageKey = 'coursevault-machine-id'
  let machineId = localStorage.getItem(storageKey)

  if (!machineId) {
    // Generate a random ID for development/browser mode
    machineId = 'DEV-' + crypto.randomUUID().substring(0, 16)
    localStorage.setItem(storageKey, machineId)
  }

  return machineId
}

/**
 * Hash a string using SHA-256
 */
export async function hashString(input: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}
