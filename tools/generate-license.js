#!/usr/bin/env node
/**
 * CourseVault License Key Generator (NOT SHIPPED WITH APP)
 *
 * Generates Ed25519-signed license keys for CourseVault.
 *
 * Usage:
 *   node tools/generate-license.js init                        -- Generate new keypair
 *   node tools/generate-license.js pro user@example.com        -- Generate Pro key
 *   node tools/generate-license.js pro_plus user@example.com --months 12
 *   node tools/generate-license.js verify CV-PRO-xxx.yyy       -- Verify a key
 *   node tools/generate-license.js show-public                 -- Show public key
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const KEYS_DIR = path.join(__dirname, '..', '.keys')
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'private.pem')
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'public.pem')

const TIER_FEATURES = {
  pro: ['transcribe', 'summarize', 'chat', 'export', 'unlimited_courses'],
  pro_plus: ['transcribe', 'summarize', 'chat', 'export', 'unlimited_courses', 'cloud_backup', 'auto_transcribe']
}

function ensureKeysDir() {
  if (!fs.existsSync(KEYS_DIR)) {
    fs.mkdirSync(KEYS_DIR, { recursive: true })
  }
}

function generateKeypair() {
  ensureKeysDir()

  if (fs.existsSync(PRIVATE_KEY_PATH)) {
    console.error('ERROR: Keypair already exists at', KEYS_DIR)
    console.error('Delete .keys/ directory first if you want to regenerate.')
    process.exit(1)
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })

  fs.writeFileSync(PRIVATE_KEY_PATH, privateKey, 'utf-8')
  fs.writeFileSync(PUBLIC_KEY_PATH, publicKey, 'utf-8')

  console.log('Keypair generated successfully!')
  console.log(`  Private key: ${PRIVATE_KEY_PATH}`)
  console.log(`  Public key:  ${PUBLIC_KEY_PATH}`)
  console.log('')
  console.log('PUBLIC KEY (embed in src/lib/license.ts):')
  console.log(publicKey.trim())
  console.log('')
  console.log('IMPORTANT: Keep the private key SECRET. Never commit it to git.')
  console.log('Add .keys/ to your .gitignore.')
}

function loadPrivateKey() {
  if (!fs.existsSync(PRIVATE_KEY_PATH)) {
    console.error('ERROR: No private key found. Run "init" first.')
    process.exit(1)
  }
  return crypto.createPrivateKey(fs.readFileSync(PRIVATE_KEY_PATH, 'utf-8'))
}

function loadPublicKey() {
  if (!fs.existsSync(PUBLIC_KEY_PATH)) {
    console.error('ERROR: No public key found. Run "init" first.')
    process.exit(1)
  }
  return crypto.createPublicKey(fs.readFileSync(PUBLIC_KEY_PATH, 'utf-8'))
}

function generateLicenseKey(tier, email, months) {
  const privateKey = loadPrivateKey()

  const payload = {
    tier,
    email,
    issued: new Date().toISOString().split('T')[0],
    expires: null,
    machineLimit: 3,
    features: TIER_FEATURES[tier]
  }

  // Pro+ is subscription-based, set expiry
  if (tier === 'pro_plus') {
    const expiry = new Date()
    expiry.setMonth(expiry.getMonth() + (months || 1))
    payload.expires = expiry.toISOString().split('T')[0]
  }

  // Encode payload as base64url
  const payloadJson = JSON.stringify(payload)
  const payloadBase64 = Buffer.from(payloadJson).toString('base64url')

  // Sign the tier + payload (to prevent tier tampering)
  const tierPrefix = tier === 'pro_plus' ? 'PROPLUS' : 'PRO'
  const dataToSign = `${tierPrefix}-${payloadBase64}`

  const signature = crypto.sign(null, Buffer.from(dataToSign), privateKey)
  const signatureBase64 = signature.toString('base64url')

  return `CV-${tierPrefix}-${payloadBase64}.${signatureBase64}`
}

function verifyLicenseKey(key) {
  const publicKey = loadPublicKey()

  if (!key.startsWith('CV-')) {
    console.error('Invalid key format: must start with CV-')
    process.exit(1)
  }

  const withoutPrefix = key.substring(3)
  const dashIndex = withoutPrefix.indexOf('-')
  if (dashIndex === -1) {
    console.error('Invalid key format: missing tier separator')
    process.exit(1)
  }

  const tierPart = withoutPrefix.substring(0, dashIndex)
  const rest = withoutPrefix.substring(dashIndex + 1)
  const dotIndex = rest.lastIndexOf('.')
  if (dotIndex === -1) {
    console.error('Invalid key format: missing signature separator')
    process.exit(1)
  }

  const payloadBase64 = rest.substring(0, dotIndex)
  const signatureBase64 = rest.substring(dotIndex + 1)

  // Verify signature
  const dataToVerify = `${tierPart}-${payloadBase64}`
  const signature = Buffer.from(signatureBase64, 'base64url')
  const isValid = crypto.verify(null, Buffer.from(dataToVerify), publicKey, signature)

  if (!isValid) {
    console.error('INVALID: Signature verification failed!')
    process.exit(1)
  }

  // Decode payload
  const payloadJson = Buffer.from(payloadBase64, 'base64url').toString('utf-8')
  const payload = JSON.parse(payloadJson)

  console.log('VALID LICENSE KEY')
  console.log('  Tier:', payload.tier)
  console.log('  Email:', payload.email)
  console.log('  Issued:', payload.issued)
  console.log('  Expires:', payload.expires || 'Never (lifetime)')
  console.log('  Machine Limit:', payload.machineLimit)
  console.log('  Features:', payload.features.join(', '))

  if (payload.expires) {
    const expiryDate = new Date(payload.expires)
    if (expiryDate < new Date()) {
      console.log('  STATUS: EXPIRED')
    } else {
      const daysLeft = Math.ceil((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      console.log(`  STATUS: Active (${daysLeft} days remaining)`)
    }
  } else {
    console.log('  STATUS: Active (lifetime)')
  }
}

// CLI entry point
const [,, command, ...args] = process.argv

switch (command) {
  case 'init':
    generateKeypair()
    break

  case 'pro':
  case 'pro_plus': {
    const email = args[0]
    if (!email || !email.includes('@')) {
      console.error('Usage: generate-license.js pro <email>')
      console.error('       generate-license.js pro_plus <email> [--months N]')
      process.exit(1)
    }

    let months
    const monthsIdx = args.indexOf('--months')
    if (monthsIdx !== -1 && args[monthsIdx + 1]) {
      months = parseInt(args[monthsIdx + 1], 10)
    }

    const key = generateLicenseKey(command, email, months)
    console.log('Generated License Key:')
    console.log('')
    console.log(key)
    console.log('')
    console.log(`Tier: ${command}`)
    console.log(`Email: ${email}`)
    if (command === 'pro_plus') {
      console.log(`Expires: ${months || 1} month(s) from now`)
    } else {
      console.log('Expires: Never (lifetime)')
    }
    break
  }

  case 'verify': {
    const keyToVerify = args[0]
    if (!keyToVerify) {
      console.error('Usage: generate-license.js verify <key>')
      process.exit(1)
    }
    verifyLicenseKey(keyToVerify)
    break
  }

  case 'show-public': {
    const pem = fs.readFileSync(PUBLIC_KEY_PATH, 'utf-8')
    console.log('Public key for embedding in src/lib/license.ts:')
    console.log('')
    console.log(pem.trim())
    break
  }

  default:
    console.log('CourseVault License Key Generator')
    console.log('')
    console.log('Commands:')
    console.log('  init                              Generate new Ed25519 keypair')
    console.log('  pro <email>                       Generate Pro license (lifetime)')
    console.log('  pro_plus <email> [--months N]     Generate Pro+ license (subscription)')
    console.log('  verify <key>                      Verify a license key')
    console.log('  show-public                       Show public key for embedding')
    break
}
