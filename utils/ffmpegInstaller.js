const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const os = require('os');
const { exec, execSync } = require('child_process');
const https = require('https');

// Helper to get the absolute path to the backend root
// In Next.js, process.cwd() is usually the project root
const BACKEND_ROOT = process.cwd();

/**
 * Check if FFmpeg is in the global system PATH
 */
function isFFmpegInPath() {
  try {
    const command = os.platform() === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
    execSync(command, { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Get FFmpeg path based on platform.
 * It looks for the /bin folder in the root of the backend directory.
 */
function getFFmpegPath() {
  // 1. If we have a local binary, prioritize it
  const binDir = path.join(BACKEND_ROOT, 'bin');
  const platform = os.platform();
  
  let localPath;
  if (platform === 'win32') {
    localPath = path.join(binDir, 'ffmpeg.exe');
  } else if (platform === 'darwin') {
    localPath = path.join(binDir, 'ffmpeg'); // Removed -mac suffix for standard consistency
  } else {
    localPath = path.join(binDir, 'ffmpeg');
  }

  if (fs.existsSync(localPath)) {
    return localPath;
  }

  // 2. Fallback: If global ffmpeg exists, just return 'ffmpeg' command
  if (isFFmpegInPath()) {
    return 'ffmpeg';
  }

  // 3. Return local path (even if missing) so the installer knows where to put it
  return localPath;
}

async function isFFmpegInstalled() {
  try {
    const ffmpegPath = getFFmpegPath();
    
    // If it returns just 'ffmpeg', it's global
    if (ffmpegPath === 'ffmpeg') return true;

    // Otherwise check file existence
    await fsPromises.access(ffmpegPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isFFmpegInstalledSync() {
  try {
    const ffmpegPath = getFFmpegPath();
    if (ffmpegPath === 'ffmpeg') return true;
    
    fs.accessSync(ffmpegPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Downloads a file with a progress bar in the console
 */
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    // Use a standard browser User-Agent to avoid 403 Forbidden errors
    const options = {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/octet-stream' 
      }
    };

    const request = https.get(url, options, (response) => {
      // Handle Redirects
      if ([301, 302, 307, 308].includes(response.statusCode)) {
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        return reject(new Error(`Download failed with status code: ${response.statusCode}`));
      }

      const totalSize = parseInt(response.headers['content-length'], 10);
      let downloadedSize = 0;
      const file = fs.createWriteStream(dest);

      response.on('data', (chunk) => {
        downloadedSize += chunk.length;
        // Optional: reduce log spam in production
        if (process.stdout.isTTY) { 
           // Only log progress if in an interactive terminal
           // Logic omitted to keep logs clean in server logs, 
           // but you can uncomment strict logging if needed.
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close(() => resolve());
      });

      file.on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    });

    request.on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function findFileRecursively(dir, filename) {
  // Guard against reading a directory that doesn't exist
  if (!fs.existsSync(dir)) return null;

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

async function downloadFFmpegWindows() {
  const binDir = path.join(BACKEND_ROOT, 'bin');
  const zipPath = path.join(binDir, 'ffmpeg.zip');
  const extractPath = path.join(binDir, 'temp_extract');
  
  // Use the Essentials build (smaller, reliable) provided by Gyan.dev (git-essentials)
  // or stick to BtbN if preferred. Gyan is extremely stable for Windows.
  const ffmpegUrl = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-git-essentials.7z'; 
  // Note: Node cannot natively extract .7z easily without 7zip installed. 
  // Let's stick to .zip for Node.js compatibility using the BtbN build.
  
  const ffmpegZipUrl = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';

  try {
    // 1. Ensure bin directory exists
    if (!fs.existsSync(binDir)) {
      await fsPromises.mkdir(binDir, { recursive: true });
    }

    console.log('⬇️  Starting FFmpeg Auto-Download...');
    await downloadFile(ffmpegZipUrl, zipPath);
    
    console.log('📦 Extraction starting...');
    
    // Check if PowerShell exists before trying
    try {
        execSync('powershell -version', { stdio: 'ignore' });
    } catch {
        throw new Error('PowerShell is required for auto-installation on Windows.');
    }

    // Force remove previous temp directory if it exists
    if (fs.existsSync(extractPath)) {
        await fsPromises.rm(extractPath, { recursive: true, force: true });
    }

    const psCommand = `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractPath}' -Force"`;
    
    await new Promise((resolve, reject) => {
      exec(psCommand, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    // Small delay to ensure FS lock release
    await new Promise(r => setTimeout(r, 1000));

    console.log('🔍 Locating ffmpeg.exe...');
    const ffmpegSource = await findFileRecursively(extractPath, 'ffmpeg.exe');
    
    // Explicit destination construction
    const ffmpegDest = path.join(binDir, 'ffmpeg.exe');

    if (ffmpegSource) {
      await fsPromises.copyFile(ffmpegSource, ffmpegDest);
      console.log(`✅ FFmpeg successfully installed to: ${ffmpegDest}`);
    } else {
      throw new Error('ffmpeg.exe not found in extracted archive.');
    }
  } catch (error) {
    console.error('❌ FFmpeg Installation failed:', error.message);
    throw error;
  } finally {
    // Cleanup temporary files
    try {
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      if (fs.existsSync(extractPath)) fs.rmSync(extractPath, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

async function installFFmpeg() {
  const platform = os.platform();
  
  // Quick check: If it's already in path, don't download
  if (isFFmpegInPath()) {
    console.log('✅ FFmpeg is already installed globally.');
    return;
  }

  if (platform === 'win32') {
    await downloadFFmpegWindows();
  } else {
    throw new Error(`Auto-install not supported on ${platform}. Please install FFmpeg manually: 'brew install ffmpeg' (Mac) or 'sudo apt install ffmpeg' (Linux).`);
  }
}

module.exports = {
  isFFmpegInstalled,
  isFFmpegInstalledSync,
  getFFmpegPath,
  installFFmpeg
};