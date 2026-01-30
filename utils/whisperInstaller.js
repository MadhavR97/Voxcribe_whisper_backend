// Implementation of whisperInstaller for backend
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const os = require('os');
const { exec } = require('child_process');
const https = require('https');

// Get platform-specific binary name
function getPlatformBinaryName() {
  const platform = os.platform();
  switch (platform) {
    case 'win32':
      // We use 'whisper-core.exe' to avoid legacy name checks and force a fresh install
      return 'whisper-core.exe'; 
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
  const binDir = path.resolve(__dirname, '..', 'bin');
  
  if (platform === 'win32') {
    // Changing name to whisper-core.exe to invalidate previous installs of the deprecated binary
    return path.join(binDir, 'whisper-core.exe');
  }
  return path.join(binDir, 'whisper');
}

// On Windows, whisper.cpp may ship whisper-cli.exe, main.exe, or whisper.exe
function getWhisperBinaryPathCandidates() {
  const platform = os.platform();
  const binDir = path.resolve(__dirname, '..', 'bin');
  if (platform === 'win32') {
    return [
      path.join(binDir, 'whisper-core.exe'), // New standard
      path.join(binDir, 'whisper-main.exe'), // Previous attempt
      path.join(binDir, 'whisper-cli.exe'), 
      path.join(binDir, 'main.exe'),
      path.join(binDir, 'whisper.exe')
    ];
  }
  return [path.join(binDir, 'whisper')];
}

// Get Whisper model path
function getWhisperModelPath() {
  const modelDir = path.resolve(__dirname, '..', 'models');
  return path.join(modelDir, 'ggml-small.bin');
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

// Robust file downloader with progress bar and redirect support
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' // Prevent 403 blocks
      }
    };

    const request = https.get(url, options, (response) => {
      // Handle Redirects
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
        fs.unlink(dest, () => {}); 
        reject(err);
      });

      response.pipe(file);
    });

    request.on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

// Recursively find a file in a directory
async function findFileRecursively(dir, filenamePatterns) {
  const items = await fsPromises.readdir(dir, { withFileTypes: true });
  
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isFile()) {
      const lowerName = item.name.toLowerCase();
      // Check if file matches any of the patterns
      if (filenamePatterns.some(pattern => lowerName === pattern.toLowerCase())) {
        return fullPath;
      }
    } else if (item.isDirectory()) {
      const found = await findFileRecursively(fullPath, filenamePatterns);
      if (found) return found;
    }
  }
  return null;
}

// Download Whisper for Windows
async function downloadWhisperWindows() {
  const binDir = path.resolve(__dirname, '..', 'bin');
  const zipPath = path.join(binDir, 'whisper.zip');
  const extractPath = path.join(binDir, 'temp_extract_whisper');
  
  // Strategy: 
  // 1. Prefer v1.5.5 because it contains a stable, standalone 'main.exe' that is NOT a deprecation stub.
  // 2. Avoid v1.8.3's 'main.exe' because it is a stub that prints a warning and exits.
  // 3. Only use v1.8.3 if we can find 'whisper-cli.exe' (which is often missing in the zip).
  const attempts = [
    {
      version: 'v1.5.5',
      url: 'https://github.com/ggerganov/whisper.cpp/releases/download/v1.5.5/whisper-v1.5.5-windows-x64.zip',
      binaries: ['main.exe']
    },
    {
      version: 'v1.8.3',
      url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.3/whisper-bin-x64.zip',
      binaries: ['whisper-cli.exe'] // Do NOT include main.exe
    }
  ];

  let installed = false;

  for (const attempt of attempts) {
    console.log(`Attempting to install Whisper ${attempt.version} from ${attempt.url}`);
    
    try {
      // Cleanup previous attempts
      try {
        if (fs.existsSync(zipPath)) await fsPromises.unlink(zipPath);
        if (fs.existsSync(extractPath)) await fsPromises.rm(extractPath, { recursive: true, force: true });
      } catch (e) {}

      // Download
      await downloadFile(attempt.url, zipPath);
      console.log('Download complete. Extracting...');

      // Extract
      if (!fs.existsSync(extractPath)) {
        await fsPromises.mkdir(extractPath, { recursive: true });
      }
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

      console.log('Extraction complete. Searching for valid binary...');
      
      // Find valid binary
      const whisperSource = await findFileRecursively(extractPath, attempt.binaries);
      
      if (whisperSource) {
        console.log(`Found valid binary at: ${whisperSource}`);
        
        // DESTINATION: We use whisper-core.exe to avoid naming conflict and invalidation
        const whisperDest = getWhisperBinaryPath(); 
        const sourceDir = path.dirname(whisperSource);
        
        // 1. Copy the main executable to whisper-core.exe
        await fsPromises.copyFile(whisperSource, whisperDest);
        
        // 2. Copy dependencies (DLLs) and other assets from the same folder
        // Many whisper builds rely on dlls in the same folder. Copying siblings ensures we get them.
        const siblingFiles = await fsPromises.readdir(sourceDir);
        for (const file of siblingFiles) {
          const srcFile = path.join(sourceDir, file);
          const destFile = path.join(binDir, file);
          
          // Don't overwrite the whisper-core.exe we just created
          if (path.resolve(srcFile) !== path.resolve(whisperSource)) {
             const stats = await fsPromises.stat(srcFile);
             if (stats.isFile()) {
                await fsPromises.copyFile(srcFile, destFile);
             }
          }
        }
        
        console.log(`Whisper installed successfully to: ${whisperDest}`);
        
        // 3. Unblock files (Windows specific fix for "Access Denied" / "Mark of the Web")
        // This is crucial for downloaded executables on Windows 10/11
        console.log('Unblocking downloaded files...');
        const unblockCmd = `powershell.exe -NoProfile -InputFormat None -ExecutionPolicy Bypass -Command "Get-ChildItem -Path '${binDir}' -Recurse | Unblock-File"`;
        await new Promise((resolve) => {
            exec(unblockCmd, (err) => {
                if (err) console.log('Warning: Failed to unblock files:', err.message);
                resolve();
            });
        });

        // 4. Clean up old 'whisper.exe' / 'whisper-main.exe' if they exist to avoid confusion
        try {
            const oldFiles = ['whisper.exe', 'whisper-main.exe'];
            for (const f of oldFiles) {
                const oldPath = path.join(binDir, f);
                if (fs.existsSync(oldPath)) {
                    await fsPromises.unlink(oldPath);
                }
            }
        } catch (e) {}

        installed = true;
        break; // Success!
      } else {
        console.warn(`No valid binary found in ${attempt.version} (checked for: ${attempt.binaries.join(', ')}).`);
      }

    } catch (err) {
      console.warn(`Failed to install ${attempt.version}:`, err.message);
    }
  }

  // Final cleanup
  try {
    if (fs.existsSync(zipPath)) await fsPromises.unlink(zipPath);
    if (fs.existsSync(extractPath)) await fsPromises.rm(extractPath, { recursive: true, force: true });
  } catch (e) {}

  if (!installed) {
    throw new Error('All Whisper installation attempts failed. Please install manually.');
  }
}

// Install Whisper wrapper
async function installWhisper() {
  console.log('Installing Whisper...');
  const binDir = path.resolve(__dirname, '..', 'bin');
  const platform = os.platform();
  
  try {
    await fsPromises.mkdir(binDir, { recursive: true });
    
    if (platform === 'win32') {
      await downloadWhisperWindows();
    } else {
      console.warn('Auto-install is primarily supported for Windows. Please install Whisper.cpp manually.');
      console.warn('See: https://github.com/ggerganov/whisper.cpp');
      throw new Error(`Auto-install not fully supported on ${platform}`);
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
    
    // Check if model already exists and has content
    try {
      const stats = await fsPromises.stat(modelPath);
      if (stats.size > 1000) { // Check if it's not just a placeholder
        console.log('Model already exists:', modelPath);
        return;
      }
    } catch {}

    const modelUrl = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin';
    console.log(`Downloading Whisper model (ggml-small.bin) from: ${modelUrl}`);
    console.log('This may take a while...');
    
    await downloadFile(modelUrl, modelPath);
    console.log('Model downloaded successfully:', modelPath);

  } catch (error) {
    console.error('Error downloading model:', error.message);
    console.log('Please manually download ggml-small.bin to backend/models/');
    // We don't throw here to avoid crashing the server loop, but transcription will fail if model is missing.
  }
}

// Check if Whisper is installed synchronously
function isWhisperInstalledSync() {
  try {
    const binaryPath = getWhisperBinaryPath();
    require('fs').accessSync(binaryPath);
    return true;
  } catch {
    return false;
  }
}

// Check if model is available synchronously
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
  installWhisper,
  ensureModelDownloaded
};