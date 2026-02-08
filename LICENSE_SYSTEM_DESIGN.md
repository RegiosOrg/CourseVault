# CourseVault License System Design

## Overview

One-time purchase + optional subscription model using cryptographic license validation.

---

## License Tiers

### Free Tier
- **Limits:** 100 courses OR 200 hours transcription (whichever first)
- **Features:**
  - Local transcription (Whisper)
  - Local summarization (Ollama)
  - Local AI chat (Ollama)
  - Basic search
  - Local storage only
- **No expiry** - free forever within limits

### Pro (One-Time Purchase: $49-79)
- **Limits:** Unlimited local transcription
- **Features:**
  - Everything in Free
  - No course/hour limits
  - Priority in transcription queue
  - Export features (PDF, markdown)
- **Lifetime license** - one-time payment, works forever
- **Offline capable** - validates once, then works offline

### Pro+ Cloud (Subscription: $7.99/month or $79/year)
- **Limits:** Unlimited everything
- **Features:**
  - Everything in Pro
  - Cloud backup of transcripts
  - Cross-device sync
  - Auto-transcribe new courses (folder watching)
  - Priority support
  - Early access to new features
- **Requires internet** - monthly validation check

---

## Technical Implementation

### License Key Format

Using Ed25519 signed license keys (offline-verifiable):

```
CV-{TIER}-{DATA}.{SIGNATURE}

Example:
CV-PRO-eyJ0aWVyIjoicHJvIiwiZW1haWwiOiJ1c2VyQGV4YW1wbGUuY29tIiwiaXNzdWVkIjoiMjAyNi0wMi0wMyIsIm1hY2hpbmVfbGltaXQiOjN9.MEUCIQDKZv...
```

**Data payload (base64 JSON):**
```json
{
  "tier": "pro",
  "email": "user@example.com",
  "issued": "2026-02-03",
  "expires": null,           // null = lifetime
  "machine_limit": 3,        // Max activations
  "features": ["unlimited_courses", "export"]
}
```

### Validation Flow

```
┌─────────────────┐
│   User enters   │
│   license key   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Verify signature│ ◄── Using embedded PUBLIC key
│  (offline OK)   │
└────────┬────────┘
         │ Valid?
         ▼
┌─────────────────┐
│ Check expiry &  │
│ machine binding │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Online check?   │────►│ Validate with   │
│ (optional)      │     │ license server  │
└────────┬────────┘     └────────┬────────┘
         │                       │
         ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│ Store license   │     │ Get latest tier │
│   locally       │     │ & features      │
└─────────────────┘     └─────────────────┘
```

### Machine Binding

To prevent unlimited sharing, licenses are bound to machine IDs:

```typescript
function getMachineId(): string {
  // Combine hardware identifiers
  const components = [
    os.hostname(),
    os.cpus()[0]?.model,
    os.totalmem(),
    // On Windows: HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography\MachineGuid
    // On Mac: IOPlatformUUID
    // On Linux: /etc/machine-id
  ]
  return crypto.createHash('sha256')
    .update(components.join('|'))
    .digest('hex')
    .substring(0, 16)
}
```

### Usage Tracking

Track usage for free tier limits:

```typescript
interface UsageData {
  coursesIndexed: number        // Total courses ever indexed
  hoursTranscribed: number      // Total hours transcribed
  lastUpdated: string           // ISO timestamp
}

// Stored in electron-store (encrypted)
// Synced to server for Pro+ users
```

---

## Server-Side (Future)

### License Server Endpoints

```
POST /api/license/validate
  Request: { key: string, machine_id: string }
  Response: { valid: boolean, tier: string, features: [], expires: string | null }

POST /api/license/activate
  Request: { key: string, machine_id: string, email: string }
  Response: { success: boolean, activations_remaining: number }

POST /api/license/deactivate
  Request: { key: string, machine_id: string }
  Response: { success: boolean }

GET /api/license/status
  Request: { key: string }
  Response: { tier: string, activations: number, expires: string | null }
```

### For MVP (No Server)

Use cryptographic keys that can be validated offline:
1. Generate key pair (private stays with you, public embedded in app)
2. Create signed license keys using private key
3. App verifies signatures using embedded public key
4. Machine binding stored locally (honor system + basic protection)

---

## Implementation Files

### New Files to Create

1. `src/lib/license.ts` - License validation logic
2. `src/lib/machineId.ts` - Machine fingerprinting
3. `src/lib/usage.ts` - Usage tracking
4. `electron/license.ts` - Electron-side license handling
5. `src/components/LicenseModal.tsx` - License activation UI

### Files to Modify

1. `src/stores/appStore.ts` - Update license state management
2. `electron/main.ts` - Add IPC handlers for license
3. `src/screens/Settings.tsx` - License management UI

---

## Feature Gating

```typescript
// src/lib/features.ts

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

export function canUseFeature(tier: LicenseTier, feature: Feature): boolean {
  return TIER_FEATURES[tier].includes(feature)
}

export function isWithinLimits(tier: LicenseTier, usage: UsageData): boolean {
  if (tier !== 'free') return true
  return usage.coursesIndexed < FREE_LIMITS.maxCourses &&
         usage.hoursTranscribed < FREE_LIMITS.maxHours
}
```

---

## Security Considerations

1. **Public key embedded** - Cannot be modified without rebuilding app
2. **License stored encrypted** - Uses electron-store encryption
3. **Machine binding** - Prevents unlimited sharing
4. **Offline-first** - Works without internet (Pro tier)
5. **Grace period** - Pro+ has 7-day offline grace period
6. **Obfuscation** - License logic can be obfuscated in production build

---

## Migration Path

### Phase 1 (MVP - Now)
- Implement offline cryptographic validation
- Basic usage tracking
- Feature gating for free tier
- No server required

### Phase 2 (Post-Launch)
- Add license server for Pro+ subscription management
- Cloud features
- Automatic renewal handling

### Phase 3 (Scale)
- Stripe integration for payments
- Self-serve license portal
- Usage analytics
