// Implementation of ffmpegInstaller for backend
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const os = require('os');
const { exec } = require('child_process');
const https = require('https');

// Get FFmpeg path based on platform
function getFFmpegPath() {
  const platform = os.platform();
  // Assuming this file is in a subdirectory (e.g., utils/), go up one level to backend root, then into bin
  const binDir = path.resolve(__dirname, '..', 'bin');
  
  if (platform === 'win32') {
    return path.join(binDir, 'ffmpeg.exe');
  } else if (platform === 'darwin') {
    return path.join(binDir, 'ffmpeg-mac');
  } else {
    return path.join(binDir, 'ffmpeg');
  }
}

// Check if FFmpeg is installed
async function isFFmpegInstalled() {
  try {
    const ffmpegPath = getFFmpegPath();
    await fsPromises.access(ffmpegPath);
    return true;
  } catch {
    return false;
  }
}

// Check if FFmpeg is installed synchronously
function isFFmpegInstalledSync() {
  try {
    const ffmpegPath = getFFmpegPath();
    require('fs').accessSync(ffmpegPath);
    return true;
  } catch {
    return false;
  }
}

// Robust file downloader with progress bar and redirect support
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' // Prevent 403 blocks from some servers
      }
    };

    const request = https.get(url, options, (response) => {
      // Handle Redirects (301, 302, 307, 308)
      if ([301, 302, 307, 308].includes(response.statusCode)) {
        downloadFile(response.headers.location, dest)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download. Status Code: ${response.statusCode}`));
        return;
      }

      const totalSize = parseInt(response.headers['content-length'], 10);
      const file = fs.createWriteStream(dest);
      let downloaded = 0;
      let lastLoggedTime = 0;
      
      response.on('data', (chunk) => {
        downloaded += chunk.length;
        const now = Date.now();
        
        // Log progress every 1 second
        if (now - lastLoggedTime > 1000) {
            const mb = (downloaded / 1024 / 1024).toFixed(1);
            if (totalSize) {
                const totalMb = (totalSize / 1024 / 1024).toFixed(1);
                const percent = ((downloaded / totalSize) * 100).toFixed(0);
                process.stdout.write(`Downloading... ${percent}% (${mb} / ${totalMb} MB)\r`);
            } else {
                process.stdout.write(`Downloading... ${mb} MB\r`);
            }
            lastLoggedTime = now;
        }
      });

      file.on('finish', () => {
        process.stdout.write('\n'); // Clear line
        file.close(() => resolve());
      });

      file.on('error', (err) => {
        fs.unlink(dest, () => {}); // Clean up partial file
        reject(err);
      });

      response.pipe(file);
    });

    request.on('error', (err) => {
      fs.unlink(dest, () => {}); // Clean up partial file
      reject(err);
    });
  });
}

// Recursively find a file in a directory
async function findFileRecursively(dir, filename) {
  const items = await fsPromises.readdir(dir, { withFileTypes: true });
  
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isFile() && item.name.toLowerCase() === filename.toLowerCase()) {
      return fullPath;
    } else if (item.isDirectory()) {
      const found = await findFileRecursively(fullPath, filename);
      if (found) return found;
    }
  }
  return null;
}

// Download and install FFmpeg for Windows
async function downloadFFmpegWindows() {
  const binDir = path.resolve(__dirname, '..', 'bin');
  const zipPath = path.join(binDir, 'ffmpeg.zip');
  const extractPath = path.join(binDir, 'temp_extract');
  
  // Use a reliable GitHub release ZIP
  const ffmpegUrl = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
  
  try {
    console.log(`Downloading FFmpeg for Windows from: ${ffmpegUrl}`);
    await downloadFile(ffmpegUrl, zipPath);
    console.log('Download complete. Extracting...');

    // Ensure extraction directory exists
    if (!fs.existsSync(extractPath)) {
      await fsPromises.mkdir(extractPath, { recursive: true });
    }

    // Use PowerShell to extract ZIP (Native Windows tool, no external deps required)
    const psCommand = `powershell.exe -NoProfile -InputFormat None -ExecutionPolicy Bypass -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractPath}' -Force"`;
    
    await new Promise((resolve, reject) => {
      exec(psCommand, (error, stdout, stderr) => {
        if (error) {
          console.error('PowerShell extraction failed:', stderr);
          reject(error);
        } else {
          resolve();
        }
      });
    });

    console.log('Extraction complete. Locating ffmpeg.exe...');

    // Find ffmpeg.exe in the extracted folder structure
    const ffmpegSource = await findFileRecursively(extractPath, 'ffmpeg.exe');
    const ffmpegDest = getFFmpegPath();

    if (ffmpegSource) {
      // Copy to final destination
      await fsPromises.copyFile(ffmpegSource, ffmpegDest);
      console.log(`FFmpeg installed successfully to: ${ffmpegDest}`);
    } else {
      throw new Error('ffmpeg.exe not found in downloaded archive');
    }

  } catch (error) {
    console.error('FFmpeg installation failed:', error.message);
    // Cleanup on fail
    try {
      if (fs.existsSync(zipPath)) await fsPromises.unlink(zipPath);
      if (fs.existsSync(extractPath)) await fsPromises.rm(extractPath, { recursive: true, force: true });
    } catch (e) { /* ignore cleanup errors */ }
    throw error;
  } finally {
    // Always cleanup temp files on success
    try {
      if (fs.existsSync(zipPath)) await fsPromises.unlink(zipPath);
      if (fs.existsSync(extractPath)) await fsPromises.rm(extractPath, { recursive: true, force: true });
    } catch (e) {
      console.log('Warning: Could not clean up temporary files:', e.message);
    }
  }
}

// Install FFmpeg wrapper
async function installFFmpeg() {
  const binDir = path.resolve(__dirname, '..', 'bin');
  const platform = os.platform();
  
  console.log('Starting FFmpeg auto-installation...');
  
  try {
    // Ensure bin directory exists
    await fsPromises.mkdir(binDir, { recursive: true });
    
    if (platform === 'win32') {
      await downloadFFmpegWindows();
    } else {
      // For Linux/Mac, we still recommend manual install, but we can try to download a static binary if needed.
      // For now, consistent with your original code, we warn the user.
      console.warn('Auto-install is primarily supported for Windows. Please install FFmpeg manually.');
      console.warn('MacOS: brew install ffmpeg');
      console.warn('Linux: sudo apt install ffmpeg');
      throw new Error(`Auto-install not fully supported on ${platform}`);
    }
    
  } catch (error) {
    console.error('Error installing FFmpeg:', error);
    // We do NOT create a dummy file here anymore, because a 0-byte exe causes more confusion.
    // We let the error propagate so the application knows it's missing.
    throw error;
  }
}

module.exports = {
  isFFmpegInstalled,
  isFFmpegInstalledSync,
  getFFmpegPath,
  installFFmpeg
};