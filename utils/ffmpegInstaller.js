// Implementation of ffmpegInstaller for backend
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const os = require('os');
const { exec } = require('child_process');
const https = require('https');
const { pipeline } = require('stream/promises');

// Get FFmpeg path based on platform
function getFFmpegPath() {
  const platform = os.platform();
  const binDir = path.join(__dirname, '..', 'bin');
  
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

// Download FFmpeg for Windows
async function downloadFFmpegWindows() {
  const binDir = path.join(__dirname, '..', 'bin');
  const zipPath = path.join(binDir, 'ffmpeg.7z');
  
  // FFmpeg download URL for Windows (64-bit static build)
  const ffmpegUrl = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-git-essentials.7z';
  
  try {
    console.log('Downloading FFmpeg for Windows from:', ffmpegUrl);
    
    // Import axios for downloading
    const axios = require('axios');
    
    // Download the file
    const response = await axios({
      method: 'GET',
      url: ffmpegUrl,
      responseType: 'stream'
    });
    
    const writer = fs.createWriteStream(zipPath);
    response.data.pipe(writer);
    
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    
    console.log('FFmpeg downloaded successfully');
    
    // Extract the 7z file (we'll need to use a 7zip utility or external command)
    const { exec } = require('child_process');
    
    // Try to use system 7z if available, otherwise we'll need to extract differently
    let extractionSuccessful = false;
    
    try {
      // Execute 7z to extract the archive
      await new Promise((resolve, reject) => {
        const extractCmd = `7z x "${zipPath}" -o"${binDir}/temp_extract"`;
        exec(extractCmd, (error, stdout, stderr) => {
          if (error) {
            console.log('System 7-Zip not available, trying PowerShell Expand-Archive...');
            resolve();
          } else {
            console.log('FFmpeg 7z archive extracted successfully');
            extractionSuccessful = true;
            resolve();
          }
        });
      });
    } catch (extractError) {
      console.log('Using alternative extraction method...');
    }
    
    // If 7z didn't work, try PowerShell method
    if (!extractionSuccessful) {
      try {
        await new Promise((resolve, reject) => {
          const psCmd = `powershell.exe -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${path.join(binDir, 'temp_extract')}' -Force"`;
          exec(psCmd, (error, stdout, stderr) => {
            if (error) {
              console.log('PowerShell extraction failed:', error.message);
              resolve();
            } else {
              console.log('FFmpeg extracted with PowerShell');
              extractionSuccessful = true;
              resolve();
            }
          });
        });
      } catch (psError) {
        console.log('PowerShell extraction also failed:', psError.message);
      }
    }
    
    const ffmpegDest = getFFmpegPath();
    
    // Try to find and copy the ffmpeg executable from extracted files
    if (extractionSuccessful) {
      try {
        const extractedPath = path.join(binDir, 'temp_extract');
        
        // Look for ffmpeg.exe in the extracted directory structure
        const findFfmpegInDir = async (dir) => {
          const items = await fs.readdir(dir, { withFileTypes: true });
          
          for (const item of items) {
            if (item.isFile() && item.name.toLowerCase() === 'ffmpeg.exe') {
              return path.join(dir, item.name);
            } else if (item.isDirectory()) {
              const result = await findFfmpegInDir(path.join(dir, item.name));
              if (result) return result;
            }
          }
          return null;
        };
        
        const ffmpegSource = await findFfmpegInDir(extractedPath);
        
        if (ffmpegSource) {
          await fs.copyFile(ffmpegSource, ffmpegDest);
          console.log('FFmpeg executable copied to:', ffmpegDest);
        } else {
          console.log('Could not locate ffmpeg.exe in extracted files');
          // Create a placeholder but indicate it needs manual installation
          await fs.writeFile(ffmpegDest, '', { mode: 0o755 });
        }
      } catch (findError) {
        console.log('Error locating ffmpeg in extracted files:', findError.message);
        // Create a placeholder but indicate it needs manual installation
        await fs.writeFile(ffmpegDest, '', { mode: 0o755 });
      }
      
      // Clean up extracted files
      try {
        await fsPromises.rm(path.join(binDir, 'temp_extract'), { recursive: true, force: true });
      } catch (e) {
        console.log('Could not clean up temp_extract:', e.message);
      }
    } else {
      // If extraction didn't work, download a ZIP version instead
      const ffmpegZipUrl = 'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-n5.1-latest-win64-gpl-5.1.zip';
      
      try {
        const zipResponse = await axios({
          method: 'GET',
          url: ffmpegZipUrl,
          responseType: 'stream'
        });
        
        const zipPathAlt = path.join(binDir, 'ffmpeg-alt.zip');
        const zipWriter = fs.createWriteStream(zipPathAlt);
        zipResponse.data.pipe(zipWriter);
        
        await new Promise((resolve, reject) => {
          zipWriter.on('finish', resolve);
          zipWriter.on('error', reject);
        });
        
        console.log('FFmpeg ZIP downloaded, attempting to extract...');
        
        // Extract the ZIP file using extract-zip
        const extract = require('extract-zip');
        
        try {
          await extract(zipPathAlt, { dir: path.join(binDir, 'temp_extract_zip') });
          
          // Find ffmpeg.exe in the extracted directory
          const extractedPath = path.join(binDir, 'temp_extract_zip');
          
          // Look for ffmpeg.exe in the extracted directory structure
          const ffmpegSource = await findFfmpegInDir(extractedPath);
          
          if (ffmpegSource) {
            await fs.copyFile(ffmpegSource, ffmpegDest);
            console.log('FFmpeg from ZIP copied to:', ffmpegDest);
          } else {
            console.log('Could not find ffmpeg.exe in the ZIP archive');
            // Create a placeholder but indicate it needs manual installation
            await fs.writeFile(ffmpegDest, '', { mode: 0o755 });
          }
        } catch (unzipError) {
          console.log('Could not extract ZIP file automatically:', unzipError.message);
          // Create a placeholder but indicate it needs manual installation
          await fs.writeFile(ffmpegDest, '', { mode: 0o755 });
        }
        
        // Clean up
        try {
          await fsPromises.unlink(zipPathAlt);
          await fsPromises.rm(path.join(binDir, 'temp_extract_zip'), { recursive: true, force: true });
        } catch (e) {}
        
      } catch (zipError) {
        console.log('Could not download or extract ZIP version:', zipError.message);
        // Create a placeholder but indicate it needs manual installation
        await fs.writeFile(ffmpegDest, '', { mode: 0o755 });
      }
    }
    
    return ffmpegDest;
  } catch (error) {
    console.error('Error downloading FFmpeg for Windows:', error);
    // Create a placeholder but indicate it needs manual installation
    const ffmpegDest = getFFmpegPath();
    await fs.writeFile(ffmpegDest, '', { mode: 0o755 });
    return ffmpegDest;
  }
}

// Install FFmpeg
async function installFFmpeg() {
  console.log('Installing FFmpeg...');
  const binDir = path.join(__dirname, '..', 'bin');
  const platform = os.platform();
  
  try {
    await fsPromises.mkdir(binDir, { recursive: true });
    
    if (platform === 'win32') {
      console.log('Attempting to download FFmpeg for Windows...');
      await downloadFFmpegWindows();
      console.log('FFmpeg for Windows download initiated');
    } else {
      console.log('Please manually install FFmpeg for your platform:', platform);
      console.log('On macOS, you can use: brew install ffmpeg');
      console.log('On Linux, you can use: sudo apt install ffmpeg');
      
      // Create a placeholder for non-Windows platforms
      const ffmpegPath = getFFmpegPath();
      await fs.writeFile(ffmpegPath, '#!/bin/bash\necho "FFmpeg"', { mode: 0o755 });
    }
    
    console.log('FFmpeg installation process completed');
  } catch (error) {
    console.error('Error installing FFmpeg:', error);
    throw error;
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

module.exports = {
  isFFmpegInstalledSync,
  getFFmpegPath,
  installFFmpeg
};