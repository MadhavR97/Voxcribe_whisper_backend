const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const os = require('os');
const { exec, execSync } = require('child_process');
const https = require('https');

// Use process.cwd() to reliably find the project root
const PROJECT_ROOT = process.cwd();

/**
 * Determine the correct bin directory.
 */
function getBinDir() {
  const backendPath = path.join(PROJECT_ROOT, 'backend');
  if (fs.existsSync(backendPath)) {
    return path.join(backendPath, 'bin');
  }
  return path.join(PROJECT_ROOT, 'bin');
}

/**
 * Check global PATH
 */
function isBinaryInPath(binaryName) {
  try {
    const command = os.platform() === 'win32' ? `where ${binaryName}` : `which ${binaryName}`;
    execSync(command, { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Get path to Whisper binary
 */
function getWhisperBinaryPath() {
  const platform = os.platform();
  const binDir = getBinDir();
  
  const standardPath = path.join(binDir, platform === 'win32' ? 'whisper-core.exe' : 'whisper');
  if (fs.existsSync(standardPath)) return standardPath;

  if (platform === 'win32') {
    const candidates = ['whisper-core.exe', 'whisper-cli.exe', 'main.exe', 'whisper.exe'];
    for (const c of candidates) {
       const p = path.join(binDir, c);
       if (fs.existsSync(p)) return p;
    }
  } else {
    const p = path.join(binDir, 'whisper');
    if (fs.existsSync(p)) return p;
    const pMain = path.join(binDir, 'main');
    if (fs.existsSync(pMain)) return pMain;
  }

  if (isBinaryInPath('whisper')) return 'whisper';
  return standardPath;
}

function getWhisperBinaryPathCandidates() {
  const binDir = getBinDir();
  if (os.platform() === 'win32') {
    return [
      path.join(binDir, 'whisper-core.exe'),
      path.join(binDir, 'whisper-cli.exe'),
      path.join(binDir, 'main.exe'),
      path.join(binDir, 'whisper.exe')
    ];
  }
  return [path.join(binDir, 'whisper')];
}

function getWhisperModelPath() {
  const backendModels = path.join(PROJECT_ROOT, 'backend', 'models');
  if (fs.existsSync(path.join(PROJECT_ROOT, 'backend'))) {
      return path.join(backendModels, 'ggml-small.bin');
  }
  return path.join(PROJECT_ROOT, 'models', 'ggml-small.bin');
}

function isWhisperInstalledSync() {
  try {
    const binaryPath = getWhisperBinaryPath();
    if (binaryPath === 'whisper') return true;
    fs.accessSync(binaryPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isModelAvailableSync() {
  try {
    const modelPath = getWhisperModelPath();
    fs.accessSync(modelPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/octet-stream'
      }
    };

    const request = https.get(url, options, (response) => {
      if ([301, 302, 307, 308].includes(response.statusCode)) {
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        return reject(new Error(`Download failed with status code: ${response.statusCode}`));
      }
      const file = fs.createWriteStream(dest);
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

async function findFileRecursively(dir, filenamePatterns) {
  if (!fs.existsSync(dir)) return null;
  const items = await fsPromises.readdir(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isFile()) {
      if (filenamePatterns.some(p => item.name.toLowerCase() === p.toLowerCase())) {
        return fullPath;
      }
    } else if (item.isDirectory()) {
      const found = await findFileRecursively(fullPath, filenamePatterns);
      if (found) return found;
    }
  }
  return null;
}

// Windows Download
async function downloadWhisperWindows() {
  const binDir = getBinDir();
  const zipPath = path.join(binDir, 'whisper.zip');
  const extractPath = path.join(binDir, 'temp_whisper_extract');
  const whisperUrl = 'https://github.com/ggerganov/whisper.cpp/releases/download/v1.7.1/whisper-bin-x64.zip';

  try {
    if (!fs.existsSync(binDir)) await fsPromises.mkdir(binDir, { recursive: true });
    
    console.log(`⬇️  Downloading Whisper from ${whisperUrl}...`);
    await downloadFile(whisperUrl, zipPath);
    
    if (fs.existsSync(extractPath)) await fsPromises.rm(extractPath, { recursive: true, force: true });

    console.log('📦 Extracting...');
    await new Promise((resolve, reject) => {
      exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractPath}' -Force"`, 
        (error) => (error ? reject(error) : resolve()));
    });

    await new Promise(r => setTimeout(r, 1000));

    const binarySource = await findFileRecursively(extractPath, ['main.exe', 'whisper-cli.exe', 'whisper.exe']);
    if (!binarySource) throw new Error('No valid Whisper binary found.');

    const destPath = path.join(binDir, 'whisper-core.exe');
    await fsPromises.copyFile(binarySource, destPath);

    // Copy DLLs
    const sourceDir = path.dirname(binarySource);
    const siblings = await fsPromises.readdir(sourceDir);
    for (const file of siblings) {
        if (file.toLowerCase().endsWith('.dll')) {
            await fsPromises.copyFile(path.join(sourceDir, file), path.join(binDir, file));
        }
    }
    
    // Unblock
    exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -Path '${binDir}' -Recurse | Unblock-File"`, () => {});
    
    console.log(`✅ Whisper installed to: ${destPath}`);
  } catch (error) {
    console.error('❌ Whisper Installation failed:', error.message);
    throw error;
  } finally {
    try {
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      if (fs.existsSync(extractPath)) fs.rmSync(extractPath, { recursive: true, force: true });
    } catch (e) {}
  }
}

// Unix Build
async function downloadAndBuildWhisperUnix() {
  const binDir = getBinDir();
  
  // Use os.tmpdir() to avoid nodemon watching the build files and causing reload loops
  const buildBase = os.tmpdir();
  const timestamp = Date.now();
  const tarPath = path.join(buildBase, `whisper-src-${timestamp}.tar.gz`);
  const buildPath = path.join(buildBase, `whisper_build_${timestamp}`);
  
  const url = 'https://github.com/ggerganov/whisper.cpp/archive/refs/tags/v1.7.1.tar.gz';

  try {
     try {
         execSync('make --version', { stdio: 'ignore' });
         execSync('tar --version', { stdio: 'ignore' });
     } catch (e) {
         throw new Error('Missing "make" or "tar".');
     }

     if (!fs.existsSync(binDir)) await fsPromises.mkdir(binDir, { recursive: true });

     console.log(`⬇️  Downloading Whisper source...`);
     await downloadFile(url, tarPath);

     if (fs.existsSync(buildPath)) await fsPromises.rm(buildPath, { recursive: true, force: true });
     await fsPromises.mkdir(buildPath, { recursive: true });

     console.log('📦 Extracting source...');
     execSync(`tar -xzf "${tarPath}" -C "${buildPath}" --strip-components=1`);

     console.log('🔨 Building Whisper...');
     await new Promise((resolve, reject) => {
         exec('make', { cwd: buildPath }, (error, stdout, stderr) => {
             if (error) {
                 console.error(stderr);
                 reject(new Error('Build failed.'));
             } else {
                 resolve();
             }
         });
     });

     const builtBinary = path.join(buildPath, 'main');
     if (!fs.existsSync(builtBinary)) throw new Error('Build completed but binary "main" not found.');

     const destPath = path.join(binDir, 'whisper');
     await fsPromises.copyFile(builtBinary, destPath);
     await fsPromises.chmod(destPath, 0o755);

     console.log(`✅ Whisper built: ${destPath}`);

  } catch (err) {
      console.error('❌ Unix Build failed:', err.message);
      throw err;
  } finally {
      try {
          if (fs.existsSync(tarPath)) await fsPromises.unlink(tarPath);
          if (fs.existsSync(buildPath)) await fsPromises.rm(buildPath, { recursive: true, force: true });
      } catch (e) {}
  }
}

async function installWhisper() {
  if (isWhisperInstalledSync()) {
      console.log('✅ Whisper is already installed.');
      return;
  }
  const platform = os.platform();
  if (platform === 'win32') {
    await downloadWhisperWindows();
  } else {
    await downloadAndBuildWhisperUnix();
  }
}

async function ensureModelDownloaded() {
  // Model download logic is handled in server.js or on-demand
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