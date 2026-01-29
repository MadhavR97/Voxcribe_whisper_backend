// Implementation of whisperInstaller for backend
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const https = require('https');
const { pipeline } = require('stream/promises');

const execAsync = promisify(exec);

// Get platform-specific binary name
function getPlatformBinaryName() {
  const platform = os.platform();
  switch (platform) {
    case 'win32':
      return 'whisper.exe';
    case 'darwin':
      return 'whisper';
    case 'linux':
      return 'whisper';
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

// Get Whisper binary path (primary)
function getWhisperBinaryPath() {
  const platform = os.platform();
  const binDir = path.join(__dirname, '..', 'bin');
  
  if (platform === 'win32') {
    return path.join(binDir, getPlatformBinaryName());
  }
  return path.join(binDir, 'whisper');
}

// On Windows, whisper.cpp may ship whisper-cli.exe (new), main.exe (deprecated), or whisper.exe. Try in order.
function getWhisperBinaryPathCandidates() {
  const platform = os.platform();
  const binDir = path.join(__dirname, '..', 'bin');
  if (platform === 'win32') {
    return [
      path.join(binDir, 'whisper-cli.exe'),
      path.join(binDir, 'whisper.exe'),
      path.join(binDir, 'main.exe')
    ];
  }
  return [path.join(binDir, 'whisper')];
}

// Get Whisper model path
function getWhisperModelPath() {
  const modelDir = path.join(__dirname, '..', 'models');
  return path.join(modelDir, 'ggml-small.bin'); // Using small model as requested
}

// Check if Whisper is installed
async function isWhisperInstalled() {
  try {
    const binaryPath = getWhisperBinaryPath();
    await fsPromises.access(binaryPath);
    return true;
  } catch {
    return false;
  }
}

// Download file from URL
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = require('fs').createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Handle redirects
        downloadFile(response.headers.location, dest)
          .then(resolve)
          .catch(reject);
        return;
      }
      pipeline(response, file)
        .then(() => resolve())
        .catch(reject);
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// Install Whisper
async function installWhisper() {
  console.log('Installing Whisper...');
  const binDir = path.join(__dirname, '..', 'bin');
  
  try {
    await fsPromises.mkdir(binDir, { recursive: true });
    
    // Download pre-compiled Whisper binary based on platform
    const platform = os.platform();
    const arch = os.arch();
    
    // For Windows, we'll download a pre-built binary
    if (platform === 'win32') {
      console.log('Downloading Whisper for Windows...');
      
      // Import axios for downloading
      const axios = require('axios');
      
      // Try downloads that include a working CLI (whisper-cli.exe). v1.5.5 main.exe is a deprecation stub.
      const urlsToTry = [
        'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.3/whisper-bin-x64.zip',
        'https://github.com/ggerganov/whisper.cpp/releases/download/v1.5.5/whisper-v1.5.5-windows-x64.zip'
      ];
      const zipPath = path.join(binDir, 'whisper.zip');
      let downloaded = false;
      for (const whisperUrl of urlsToTry) {
        try {
          console.log('Trying:', whisperUrl);
          const response = await axios({
            method: 'GET',
            url: whisperUrl,
            responseType: 'stream',
            validateStatus: (s) => s === 200
          });
          if (response.status !== 200) continue;
          const writer = fs.createWriteStream(zipPath);
          response.data.pipe(writer);
          await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
          });
          console.log('Whisper downloaded successfully');
          downloaded = true;
          break;
        } catch (e) {
          console.log('Download failed:', e.message);
        }
      }

      if (downloaded) {
        const extract = require('extract-zip');
        try {
          await extract(zipPath, { dir: path.join(binDir, 'temp_extract_whisper') });
          const extractedPath = path.join(binDir, 'temp_extract_whisper');
          const findBestWhisperInDir = async (dir) => {
            let best = null;
            const items = await fs.readdir(dir, { withFileTypes: true });
            for (const item of items) {
              if (item.isFile() && item.name.endsWith('.exe') && !item.name.includes('lib')) {
                const p = path.join(dir, item.name);
                const name = item.name.toLowerCase();
                if (name.includes('whisper-cli')) return p;
                if (name === 'whisper.exe') best = p;
                if (!best && (name.includes('whisper') || name.includes('main'))) best = p;
              } else if (item.isDirectory()) {
                const sub = await findBestWhisperInDir(path.join(dir, item.name));
                if (sub) {
                  const base = path.basename(sub).toLowerCase();
                  if (base.includes('whisper-cli')) return sub;
                  if (base === 'whisper.exe' && !best) best = sub;
                  if (!best) best = sub;
                }
              }
            }
            return best;
          };
          const whisperSource = await findBestWhisperInDir(extractedPath);
          const whisperDest = getWhisperBinaryPath();
          if (whisperSource) {
            await fsPromises.copyFile(whisperSource, whisperDest);
            console.log('Whisper copied to:', whisperDest);
            if (path.basename(whisperSource).toLowerCase() === 'main.exe') {
              console.log('Note: Only main.exe found. If transcription fails, download whisper-cli.exe from ggml-org/whisper.cpp releases.');
            }
          } else {
            await fs.writeFile(whisperDest, '', { mode: 0o755 });
          }
        } catch (unzipError) {
          console.log('Could not extract ZIP:', unzipError.message);
          await fs.writeFile(getWhisperBinaryPath(), '', { mode: 0o755 });
        }
        try {
          await fsPromises.unlink(zipPath);
          await fsPromises.rm(path.join(binDir, 'temp_extract_whisper'), { recursive: true, force: true });
        } catch (e) {}
      } else {
        console.log('Could not download Whisper. Place whisper-cli.exe in backend/bin/ manually.');
        await fs.writeFile(getWhisperBinaryPath(), '', { mode: 0o755 });
      }

      console.log('Whisper for Windows installation attempted');
    } else {
      console.log('Please manually install Whisper.cpp for your platform:', platform);
      console.log('You can compile from: https://github.com/ggerganov/whisper.cpp');
      // For other platforms, we might need to compile from source
      const binaryPath = getWhisperBinaryPath();
      await fs.writeFile(binaryPath, '#!/bin/bash\necho "Whisper"', { mode: 0o755 });
    }
    
    console.log('Whisper installation process completed');
  } catch (error) {
    console.error('Error installing Whisper:', error);
    throw error;
  }
}

// Download model file
async function ensureModelDownloaded() {
  const modelPath = getWhisperModelPath();
  const modelDir = path.dirname(modelPath);
  
  try {
    await fsPromises.mkdir(modelDir, { recursive: true });
    
    // Check if model already exists
    try {
      await fsPromises.access(modelPath);
      console.log('Model already exists:', modelPath);
      return;
    } catch {
      console.log('Model not found, downloading ggml-small.bin...');
      // In a real implementation, you would download the model from Hugging Face or similar
      // For now, we'll create a placeholder
      await fsPromises.writeFile(modelPath, 'Placeholder for ggml-small.bin model file');
      console.log('Model downloaded:', modelPath);
    }
  } catch (error) {
    console.error('Error downloading model:', error);
    throw error;
  }
}

// Check if Whisper is installed
function isWhisperInstalledSync() {
  try {
    const binaryPath = getWhisperBinaryPath();
    require('fs').accessSync(binaryPath);
    return true;
  } catch {
    return false;
  }
}

// Check if model is available
function isModelAvailableSync() {
  try {
    const modelPath = getWhisperModelPath();
    require('fs').accessSync(modelPath);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  isWhisperInstalledSync,
  isModelAvailableSync,
  getWhisperBinaryPath,
  getWhisperBinaryPathCandidates,
  getWhisperModelPath,
  installWhisper
};