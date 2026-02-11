#!/usr/bin/env node
/**
 * Download bundled dependencies for CourseVault
 * 
 * This downloads:
 * - FFmpeg (Windows x64)
 * - whisper.cpp (Windows x64)
 * - Whisper models (base.en)
 * 
 * Run: node scripts/download-deps.js
 */

const https = require('https')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const RESOURCES_DIR = path.join(__dirname, '../resources')
const BIN_DIR = path.join(RESOURCES_DIR, 'bin')
const MODELS_DIR = path.join(RESOURCES_DIR, 'models')

// Ensure directories exist
for (const dir of [BIN_DIR, MODELS_DIR, path.join(BIN_DIR, 'ffmpeg'), path.join(BIN_DIR, 'whisper')]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading: ${path.basename(dest)}`)
    console.log(`  From: ${url}`)
    
    const file = fs.createWriteStream(dest)
    https.get(url, { redirect: 'follow' }, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        // Follow redirect
        file.close()
        fs.unlinkSync(dest)
        downloadFile(response.headers.location, dest).then(resolve).catch(reject)
        return
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`))
        return
      }

      const totalSize = parseInt(response.headers['content-length'], 10)
      let downloaded = 0
      let lastPercent = 0

      response.on('data', (chunk) => {
        downloaded += chunk.length
        if (totalSize) {
          const percent = Math.floor((downloaded / totalSize) * 100)
          if (percent !== lastPercent && percent % 10 === 0) {
            process.stdout.write(`  ${percent}%... `)
            lastPercent = percent
          }
        }
      })

      response.pipe(file)
      file.on('finish', () => {
        file.close()
        console.log(' Done!')
        resolve()
      })
    }).on('error', (err) => {
      fs.unlinkSync(dest)
      reject(err)
    })
  })
}

function extractZip(zipPath, destDir) {
  console.log(`Extracting: ${path.basename(zipPath)}`)
  
  if (process.platform === 'win32') {
    // Use PowerShell Expand-Archive
    execSync(`PowerShell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`, {
      stdio: 'inherit'
    })
  } else {
    // Use unzip on Unix
    execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: 'inherit' })
  }
  
  fs.unlinkSync(zipPath)
  console.log('  Extracted!')
}

async function downloadFFmpeg() {
  const ffmpegDir = path.join(BIN_DIR, 'ffmpeg')
  const whisperCli = path.join(ffmpegDir, 'ffmpeg.exe')
  
  if (fs.existsSync(whisperCli)) {
    console.log('FFmpeg already downloaded.')
    return
  }

  const zipPath = path.join(ffmpegDir, 'ffmpeg.zip')
  const url = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'
  
  await downloadFile(url, zipPath)
  extractZip(zipPath, ffmpegDir)
  
  // Move files from nested directory
  const extractedDir = path.join(ffmpegDir, 'ffmpeg-master-latest-win64-gpl')
  if (fs.existsSync(extractedDir)) {
    const binDir = path.join(extractedDir, 'bin')
    for (const file of ['ffmpeg.exe', 'ffprobe.exe']) {
      const src = path.join(binDir, file)
      const dest = path.join(ffmpegDir, file)
      if (fs.existsSync(src)) {
        fs.renameSync(src, dest)
      }
    }
    // Clean up
    fs.rmSync(extractedDir, { recursive: true, force: true })
  }
  
  console.log('FFmpeg ready!')
}

async function downloadWhisperCpp() {
  const whisperDir = path.join(BIN_DIR, 'whisper')
  const whisperCli = path.join(whisperDir, 'whisper-cli.exe')
  
  if (fs.existsSync(whisperCli)) {
    console.log('whisper.cpp already downloaded.')
    return
  }

  const zipPath = path.join(whisperDir, 'whisper.zip')
  // Use a specific stable release
  const url = 'https://github.com/ggerganov/whisper.cpp/releases/download/v1.6.0/whisper-bin-x64.zip'
  
  try {
    await downloadFile(url, zipPath)
  } catch (err) {
    // Fallback to latest
    console.log('  Failed, trying latest release...')
    const latestUrl = 'https://github.com/ggerganov/whisper.cpp/releases/latest/download/whisper-bin-x64.zip'
    await downloadFile(latestUrl, zipPath)
  }
  
  extractZip(zipPath, whisperDir)
  
  // Move files from Release directory
  const releaseDir = path.join(whisperDir, 'Release')
  if (fs.existsSync(releaseDir)) {
    for (const file of fs.readdirSync(releaseDir)) {
      fs.renameSync(path.join(releaseDir, file), path.join(whisperDir, file))
    }
    fs.rmdirSync(releaseDir)
  }
  
  console.log('whisper.cpp ready!')
}

async function downloadModel() {
  const modelPath = path.join(MODELS_DIR, 'ggml-base.en.bin')
  
  if (fs.existsSync(modelPath)) {
    const stats = fs.statSync(modelPath)
    const sizeMB = (stats.size / 1024 / 1024).toFixed(1)
    console.log(`Model already downloaded (${sizeMB} MB).`)
    return
  }

  const url = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin'
  await downloadFile(url, modelPath)
  
  const stats = fs.statSync(modelPath)
  const sizeMB = (stats.size / 1024 / 1024).toFixed(1)
  console.log(`Model ready! (${sizeMB} MB)`)
}

async function main() {
  console.log('='.repeat(60))
  console.log('CourseVault - Downloading Bundled Dependencies')
  console.log('='.repeat(60))
  console.log()

  try {
    await downloadFFmpeg()
    console.log()
    await downloadWhisperCpp()
    console.log()
    await downloadModel()
    console.log()
    
    console.log('='.repeat(60))
    console.log('All dependencies downloaded successfully!')
    console.log('='.repeat(60))
  } catch (err) {
    console.error('Error:', err.message)
    process.exit(1)
  }
}

main()
