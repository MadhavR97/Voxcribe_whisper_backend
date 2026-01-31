const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const os = require('os');
const { exec } = require('child_process');
const https = require('https');

// Helper to get the absolute path to the backend root
const BACKEND_ROOT = process.cwd();

/**
 * Get FFmpeg path based on platform.
 * It looks for the /bin folder in the root of the backend directory.
 */
function getFFmpegPath() {
  const isRender = process.env.RENDER || os.platform() === 'linux';
  const binDir = path.join(process.cwd(), 'bin');
  const ffmpegPath = isRender
    ? path.join(binDir, 'ffmpeg')      // Linux (Render)
    : path.join(binDir, 'ffmpeg.exe'); // Local Windows

  // Fix for Linux: Ensure the file is executable
  if (isRender && fs.existsSync(ffmpegPath)) {
    try {
      fs.chmodSync(ffmpegPath, '755');
    } catch (err) {
      console.warn("Could not set executable permissions:", err.message);
    }
  }

  return ffmpegPath;
}

async function isFFmpegInstalled() {
  try {
    const ffmpegPath = getFFmpegPath();
    await fsPromises.access(ffmpegPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isFFmpegInstalledSync() {
  try {
    const ffmpegPath = getFFmpegPath();
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
    const options = {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) VoxScribe/1.0' }
    };

    const request = https.get(url, options, (response) => {
      // Handle Redirects
      if ([301, 302, 307, 308].includes(response.statusCode)) {
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        return reject(new Error(`Download failed: ${response.statusCode}`));
      }

      const totalSize = parseInt(response.headers['content-length'], 10);
      let downloadedSize = 0;
      const file = fs.createWriteStream(dest);

      response.on('data', (chunk) => {
        downloadedSize += chunk.length;

        if (totalSize) {
          const percent = ((downloadedSize / totalSize) * 100).toFixed(2);
          const mbDownloaded = (downloadedSize / (1024 * 1024)).toFixed(2);
          const mbTotal = (totalSize / (1024 * 1024)).toFixed(2);
          process.stdout.write(`  > Downloading FFmpeg: ${percent}% (${mbDownloaded}/${mbTotal} MB)\r`);
        } else {
          const mbDownloaded = (downloadedSize / (1024 * 1024)).toFixed(2);
          process.stdout.write(`  > Downloading FFmpeg: ${mbDownloaded} MB...\r`);
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        process.stdout.write('\n'); // Move to next line after progress is done
        file.close();
        resolve();
      });

      file.on('error', (err) => {
        fs.unlink(dest, () => { });
        reject(err);
      });
    });

    request.on('error', (err) => {
      fs.unlink(dest, () => { });
      reject(err);
    });
  });
}

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

async function downloadFFmpegWindows() {
  const binDir = path.join(BACKEND_ROOT, 'bin');
  const zipPath = path.join(binDir, 'ffmpeg.zip');
  const extractPath = path.join(binDir, 'temp_extract');

  // High-reliability URL for Windows FFmpeg
  const ffmpegUrl = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';

  try {
    if (!fs.existsSync(binDir)) {
      await fsPromises.mkdir(binDir, { recursive: true });
    }

    console.log('Starting FFmpeg Auto-Download...');
    await downloadFile(ffmpegUrl, zipPath);

    console.log('Extraction starting (this may take a moment)...');
    const psCommand = `powershell.exe -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractPath}' -Force"`;

    await new Promise((resolve, reject) => {
      exec(psCommand, (error) => (error ? reject(error) : resolve()));
    });

    console.log('Locating ffmpeg.exe in extracted files...');
    const ffmpegSource = await findFileRecursively(extractPath, 'ffmpeg.exe');
    const ffmpegDest = getFFmpegPath();

    if (ffmpegSource) {
      await fsPromises.copyFile(ffmpegSource, ffmpegDest);
      console.log(`✅ FFmpeg successfully installed to: ${ffmpegDest}`);
    } else {
      throw new Error('ffmpeg.exe not found in extracted archive.');
    }
  } catch (error) {
    console.error('❌ Installation failed:', error.message);
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
  if (platform === 'win32') {
    await downloadFFmpegWindows();
  } else {
    throw new Error(`Auto-install not supported on ${platform}. Please install FFmpeg manually using your package manager.`);
  }
}

module.exports = {
  isFFmpegInstalled,
  isFFmpegInstalledSync,
  getFFmpegPath,
  installFFmpeg
};