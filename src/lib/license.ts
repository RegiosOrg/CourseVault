/**
 * License validation and management for CourseVault
 *
 * License tiers:
 * - free: 100 courses / 200 hours limit
 * - pro: Unlimited local (one-time purchase)
 * - pro_plus: Unlimited + cloud features (subscription)
 */

import { Buffer } from 'buffer'

// Ed25519 public key for verifying license signatures
export const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAmknyDiOKfYcPcKC1jtGlJ8yWnYj8L03sC/QIa1FF5ro=
-----END PUBLIC KEY-----`

export type LicenseTier = 'free' | 'pro' | 'pro_plus'
export type LicenseStatus = 'valid' | 'invalid' | 'expired' | 'none'

export interface LicenseData {
  tier: LicenseTier
  email: string
  issued: string
  expires: string | null  // null = lifetime
  machineLimit: number
  features: string[]
}

export interface License {
  key: string | null
  tier: LicenseTier
  status: LicenseStatus
  email: string | null
  expiresAt: string | null
  features: string[]
}

export interface UsageData {
  coursesIndexed: number
  hoursTranscribed: number
  lastUpdated: string
}

// Feature definitions
export type Feature =
  | 'transcribe'
  | 'summarize'
  | 'chat'
  | 'export'
  | 'cloud_backup'
  | 'auto_transcribe'
  | 'unlimited_courses'

export const TIER_FEATURES: Record<LicenseTier, Feature[]> = {
  free: ['transcribe', 'summarize', 'chat'],
  pro: ['transcribe', 'summarize', 'chat', 'export', 'unlimited_courses'],
  pro_plus: ['transcribe', 'summarize', 'chat', 'export', 'unlimited_courses',
             'cloud_backup', 'auto_transcribe']
}

export const FREE_LIMITS = {
  maxCourses: 100,
  maxHours: 200
}

/**
 * Check if a feature is available for a given tier
 */
export function canUseFeature(tier: LicenseTier, feature: Feature): boolean {
  return TIER_FEATURES[tier].includes(feature)
}

/**
 * Check if usage is within free tier limits
 */
export function isWithinLimits(tier: LicenseTier, usage: UsageData): boolean {
  if (tier !== 'free') return true
  return usage.coursesIndexed < FREE_LIMITS.maxCourses &&
         usage.hoursTranscribed < FREE_LIMITS.maxHours
}

/**
 * Get remaining usage for free tier
 */
export function getRemainingUsage(usage: UsageData): { courses: number; hours: number } {
  return {
    courses: Math.max(0, FREE_LIMITS.maxCourses - usage.coursesIndexed),
    hours: Math.max(0, FREE_LIMITS.maxHours - usage.hoursTranscribed)
  }
}

/**
 * Parse a license key and extract the data
 * Format: CV-{TIER}-{BASE64_DATA}.{SIGNATURE}
 */
export function parseLicenseKey(key: string): { data: LicenseData; signature: string } | null {
  try {
    const trimmed = key.trim().toUpperCase()

    // Check prefix
    if (!trimmed.startsWith('CV-')) {
      return null
    }

    // Split into parts: CV-{TIER}-{DATA}.{SIGNATURE}
    const withoutPrefix = trimmed.substring(3)
    const dashIndex = withoutPrefix.indexOf('-')
    if (dashIndex === -1) return null

    const tierPart = withoutPrefix.substring(0, dashIndex)
    const rest = withoutPrefix.substring(dashIndex + 1)

    const dotIndex = rest.lastIndexOf('.')
    if (dotIndex === -1) return null

    const dataBase64 = rest.substring(0, dotIndex)
    const signature = rest.substring(dotIndex + 1)

    // Decode data
    const dataJson = Buffer.from(dataBase64, 'base64').toString('utf-8')
    const data = JSON.parse(dataJson) as LicenseData

    // Verify tier matches
    if (data.tier.toUpperCase() !== tierPart) {
      return null
    }

    return { data, signature }
  } catch {
    return null
  }
}

/**
 * Validate a license key via Electron main process
 *
 * Ed25519 signature verification runs in the main process for security.
 * Use window.electronAPI.validateLicense(key) from the renderer.
 * This function is a convenience wrapper.
 */
export async function validateLicenseKey(
  key: string
): Promise<{ valid: boolean; license?: License; error?: string }> {
  if (window.electronAPI?.validateLicense) {
    const result = await window.electronAPI.validateLicense(key)
    return {
      valid: result.valid,
      error: result.error,
      license: {
        key: result.valid ? key : null,
        tier: result.tier as LicenseTier,
        status: result.status as LicenseStatus,
        email: result.email,
        expiresAt: result.expiresAt,
        features: result.features
      }
    }
  }
  return { valid: false, error: 'License validation not available (no Electron API)' }
}

/**
 * Create a default free license
 */
export function createFreeLicense(): License {
  return {
    key: null,
    tier: 'free',
    status: 'none',
    email: null,
    expiresAt: null,
    features: TIER_FEATURES.free
  }
}

/**
 * Create default usage data
 */
export function createDefaultUsage(): UsageData {
  return {
    coursesIndexed: 0,
    hoursTranscribed: 0,
    lastUpdated: new Date().toISOString()
  }
}

/**
 * Format tier name for display
 */
export function formatTierName(tier: LicenseTier): string {
  switch (tier) {
    case 'free': return 'Free'
    case 'pro': return 'Pro'
    case 'pro_plus': return 'Pro+'
    default: return tier
  }
}

/**
 * Get tier badge color
 */
export function getTierColor(tier: LicenseTier): string {
  switch (tier) {
    case 'free': return 'text-gray-400'
    case 'pro': return 'text-blue-400'
    case 'pro_plus': return 'text-purple-400'
    default: return 'text-gray-400'
  }
}
