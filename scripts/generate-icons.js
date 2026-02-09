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

  // Generate ICO for Windows using png-to-ico
  console.log('Generating Windows ICO...')
  try {
    const pngToIco = require('png-to-ico').default || require('png-to-ico')
    const icoPath = path.join(resourcesDir, 'icon.ico')
    
    // Use multiple sizes for better quality ICO
    const pngFiles = [
      path.join(iconsDir, '16x16.png'),
      path.join(iconsDir, '32x32.png'),
      path.join(iconsDir, '48x48.png'),
      path.join(iconsDir, '256x256.png')
    ]
    
    const icoBuffer = await pngToIco(pngFiles)
    fs.writeFileSync(icoPath, icoBuffer)
    console.log('  Created icon.ico')
  } catch (err) {
    console.log('  Error creating ICO:', err.message)
    console.log('  You may need to install png-to-ico: npm install --save-dev png-to-ico')
  }

  console.log('\nIcon generation complete!')
  console.log('For macOS ICNS, use: iconutil or an online converter')
}

generateIcons().catch(console.error)
