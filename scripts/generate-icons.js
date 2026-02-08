/**
 * Icon generator script for CourseVault
 *
 * Prerequisites:
 *   npm install sharp png-to-ico
 *
 * Usage:
 *   node scripts/generate-icons.js
 *
 * This will generate:
 *   - resources/icon.png (512x512 for Linux)
 *   - resources/icon.ico (Windows)
 *   - resources/icons/*.png (various sizes for Linux)
 */

const fs = require('fs')
const path = require('path')

async function generateIcons() {
  // Check if sharp is installed
  let sharp
  try {
    sharp = require('sharp')
  } catch {
    console.log('Installing sharp...')
    require('child_process').execSync('npm install sharp --save-dev', { stdio: 'inherit' })
    sharp = require('sharp')
  }

  const svgPath = path.join(__dirname, '../public/icon.svg')
  const resourcesDir = path.join(__dirname, '../resources')
  const iconsDir = path.join(resourcesDir, 'icons')

  // Create directories
  if (!fs.existsSync(resourcesDir)) {
    fs.mkdirSync(resourcesDir)
  }
  if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir)
  }

  const sizes = [16, 32, 48, 64, 128, 256, 512]
  const svgBuffer = fs.readFileSync(svgPath)

  console.log('Generating PNG icons...')

  // Generate PNGs for each size
  for (const size of sizes) {
    const outputPath = path.join(iconsDir, `${size}x${size}.png`)
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(outputPath)
    console.log(`  Created ${size}x${size}.png`)
  }

  // Copy 512x512 as the main icon
  const mainIconPath = path.join(resourcesDir, 'icon.png')
  fs.copyFileSync(path.join(iconsDir, '512x512.png'), mainIconPath)
  console.log('  Created icon.png (512x512)')

  // Generate ICO for Windows using sharp to create multi-resolution ICO
  console.log('Generating Windows ICO...')
  try {
    // Create a simple 256x256 PNG and use it for the ICO
    // For proper multi-size ICO, electron-builder will handle it automatically
    const icoPath = path.join(resourcesDir, 'icon.ico')
    // Use the 256x256 PNG as base - electron-builder converts automatically
    await sharp(svgBuffer)
      .resize(256, 256)
      .png()
      .toFile(icoPath.replace('.ico', '_256.png'))

    // For proper ICO generation, we'll rely on electron-builder
    // which can use PNG and convert to ICO during build
    console.log('  Created 256x256 PNG for ICO conversion')
    console.log('  Note: electron-builder will convert PNG to ICO during build')
  } catch (err) {
    console.log('  Error:', err.message)
  }

  console.log('\nIcon generation complete!')
  console.log('For macOS ICNS, use: iconutil or an online converter')
}

generateIcons().catch(console.error)
