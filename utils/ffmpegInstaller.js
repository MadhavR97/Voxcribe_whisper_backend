const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const https = require('https');

const PROJECT_ROOT = process.cwd();

function getBinDir() {
  // Always check root bin first in this flat structure
  return path.join(PROJECT_ROOT, 'bin');
}

/**
 * Returns the path to the FFmpeg binary.
 */
function getFFmpegPath() {
  const binDir = getBinDir();
  const platform = os.platform();
  const localBinary = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const localPath = path.join(binDir, localBinary);

  // 1. Prefer local binary if it exists
  if (fs.existsSync(localPath)) return localPath;

  // 2. Check global PATH
  try {
    const cmd = platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
    execSync(cmd, { stdio: 'ignore' });
    return 'ffmpeg';
  } catch (e) {
    // 3. Default to local path
    return localPath;
  }
}

function isFFmpegInstalledSync() {
  const p = getFFmpegPath();
  if (p === 'ffmpeg') return true;
  return fs.existsSync(p);
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const request = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    }, (response) => {
      if ([301, 302, 307, 308].includes(response.statusCode)) {
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve());
      });
    });
    request.on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function findFileRecursively(dir, filename) {
  const items = await fs.promises.readdir(dir, { withFileTypes: true });
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

async function installFFmpeg() {
  const binDir = getBinDir();
  if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });
  
  const platform = os.platform();
  console.log(`[FFmpeg] Installing for platform: ${platform}...`);

  try {
    if (platform === 'linux') {
      const url = 'https://johnvansickle.com/ffmpeg/releases/download/release/ffmpeg-release-amd64-static.tar.xz';
      const tarPath = path.join(binDir, 'ffmpeg.tar.xz');
      
      console.log(`[FFmpeg] Downloading from ${url}...`);
      await downloadFile(url, tarPath);
      
      console.log('[FFmpeg] Extracting...');
      try {
        execSync(`tar -xJf "${tarPath}" -C "${binDir}" --strip-components=1 --wildcards "*/ffmpeg"`, { stdio: 'inherit' });
      } catch (e) {
        execSync(`tar -xJf "${tarPath}" -C "${binDir}" --strip-components=1`, { stdio: 'inherit' });
      }

      if (fs.existsSync(tarPath)) fs.unlinkSync(tarPath);
      const ffPath = path.join(binDir, 'ffmpeg');
      if (fs.existsSync(ffPath)) fs.chmodSync(ffPath, 0o755);
      console.log('[FFmpeg] Installation complete.');

    } else if (platform === 'win32') {
      const zipUrl = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
      const zipPath = path.join(binDir, 'ffmpeg.zip');
      const extractPath = path.join(binDir, 'temp_ffmpeg_extract');

      console.log(`[FFmpeg] Downloading from ${zipUrl}...`);
      await downloadFile(zipUrl, zipPath);
      
      console.log('[FFmpeg] Extracting...');
      execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractPath}' -Force"`);

      const ffmpegSource = await findFileRecursively(extractPath, 'ffmpeg.exe');
      if (ffmpegSource) {
        fs.copyFileSync(ffmpegSource, path.join(binDir, 'ffmpeg.exe'));
        console.log('[FFmpeg] Installed successfully.');
      } else {
        throw new Error('ffmpeg.exe not found');
      }

      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      if (fs.existsSync(extractPath)) fs.rmSync(extractPath, { recursive: true, force: true });
    }
  } catch (error) {
    console.error('[FFmpeg] Installation failed:', error.message);
    throw error;
  }
}

module.exports = {
  isFFmpegInstalledSync,
  getFFmpegPath,
  installFFmpeg
};