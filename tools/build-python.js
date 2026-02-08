#!/usr/bin/env node
/**
 * CourseVault Python Build Script
 *
 * Builds Python backend into standalone executables using PyInstaller.
 * Output goes to python-dist/ directory.
 *
 * Prerequisites:
 *   pip install pyinstaller
 *
 * Usage:
 *   node tools/build-python.js          -- Build both server and worker
 *   node tools/build-python.js server   -- Build server only
 *   node tools/build-python.js worker   -- Build worker only
 *   node tools/build-python.js clean    -- Remove build artifacts
 */

const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const ROOT_DIR = path.join(__dirname, '..')
const PYTHON_DIR = path.join(ROOT_DIR, 'python')
const OUTPUT_DIR = path.join(ROOT_DIR, 'python-dist')

function findPython() {
  const commands = ['python', 'python3', 'py']
  for (const cmd of commands) {
    try {
      const result = execSync(`${cmd} --version`, { encoding: 'utf-8', windowsHide: true })
      if (result.includes('Python 3')) {
        return cmd
      }
    } catch {
      continue
    }
  }
  throw new Error('Python 3 not found. Install Python 3.10+ and ensure it is in PATH.')
}

function checkPyInstaller(python) {
  try {
    execSync(`${python} -m PyInstaller --version`, { encoding: 'utf-8', windowsHide: true })
    return true
  } catch {
    return false
  }
}

function buildTarget(python, specFile, name) {
  console.log(`\n--- Building ${name} ---`)
  const startTime = Date.now()

  const distDir = path.join(OUTPUT_DIR, name)

  // Clean previous build for this target
  if (fs.existsSync(distDir)) {
    console.log(`  Cleaning previous build: ${distDir}`)
    fs.rmSync(distDir, { recursive: true, force: true })
  }

  const cmd = [
    python, '-m', 'PyInstaller',
    '--distpath', OUTPUT_DIR,
    '--workpath', path.join(ROOT_DIR, 'build', 'pyinstaller', name),
    '--specpath', PYTHON_DIR,
    '--clean',
    '--noconfirm',
    specFile
  ].join(' ')

  console.log(`  Running: ${cmd}`)

  try {
    execSync(cmd, {
      cwd: PYTHON_DIR,
      stdio: 'inherit',
      windowsHide: true,
      timeout: 300000  // 5 minute timeout
    })
  } catch (err) {
    console.error(`\nERROR: PyInstaller build failed for ${name}`)
    process.exit(1)
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

  // Verify output
  const exeExt = process.platform === 'win32' ? '.exe' : ''
  const exePath = path.join(distDir, `${name}${exeExt}`)
  if (fs.existsSync(exePath)) {
    const stats = fs.statSync(exePath)
    console.log(`  Output: ${exePath}`)
    console.log(`  Size: ${(stats.size / 1024 / 1024).toFixed(1)} MB`)
    console.log(`  Time: ${elapsed}s`)
  } else {
    console.error(`  ERROR: Expected output not found at ${exePath}`)
    process.exit(1)
  }
}

function clean() {
  console.log('Cleaning build artifacts...')

  const dirs = [
    OUTPUT_DIR,
    path.join(ROOT_DIR, 'build', 'pyinstaller'),
  ]

  for (const dir of dirs) {
    if (fs.existsSync(dir)) {
      console.log(`  Removing: ${dir}`)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }

  // Clean PyInstaller temp files in python/
  const pyiFiles = ['coursevault-server.spec.bak', 'coursevault-worker.spec.bak']
  for (const f of pyiFiles) {
    const p = path.join(PYTHON_DIR, f)
    if (fs.existsSync(p)) fs.unlinkSync(p)
  }

  console.log('Done.')
}

// Main
const [,, target] = process.argv

if (target === 'clean') {
  clean()
  process.exit(0)
}

console.log('CourseVault Python Build')
console.log('========================')

// Find Python
const python = findPython()
console.log(`Python: ${python}`)
console.log(`Output: ${OUTPUT_DIR}`)

// Check PyInstaller
if (!checkPyInstaller(python)) {
  console.error('\nPyInstaller not found. Install it:')
  console.error(`  ${python} -m pip install pyinstaller`)
  process.exit(1)
}

// Ensure output directory
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
}

const startTotal = Date.now()

if (!target || target === 'server') {
  buildTarget(python, 'coursevault-server.spec', 'coursevault-server')
}

if (!target || target === 'worker') {
  buildTarget(python, 'coursevault-worker.spec', 'coursevault-worker')
}

const totalElapsed = ((Date.now() - startTotal) / 1000).toFixed(1)
console.log(`\nAll builds completed in ${totalElapsed}s`)
console.log(`Output directory: ${OUTPUT_DIR}`)
