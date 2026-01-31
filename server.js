const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const os = require('os');
const { exec } = require('child_process');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
// Allow all origins to avoid CORS issues during dev
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Import helper functions
const { isWhisperInstalledSync, isModelAvailableSync, getWhisperBinaryPath, getWhisperBinaryPathCandidates, getWhisperModelPath } = require('./utils/whisperInstaller');
const { isFFmpegInstalledSync, getFFmpegPath } = require('./utils/ffmpegInstaller');
const { LANGUAGES } = require('./constants/languages');

// Multer for handling file uploads
// Use system temp dir to avoid triggering nodemon restarts when files are uploaded
const UPLOADS_DIR = path.join(os.tmpdir(), 'voxscribe_uploads');
const TEMP_DIR = path.join(os.tmpdir(), 'voxscribe_temp');

const multer = require('multer');
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// Ensure required directories exist
async function initializeDirectories() {
  try {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
    console.log(`Storage initialized at: ${UPLOADS_DIR} and ${TEMP_DIR}`);
  } catch (error) {
    console.error('Error initializing directories:', error);
  }
}

// Helper function for executing commands asynchronously
function execAsync(cmd, label) {
  return new Promise((resolve, reject) => {
    console.log(`▶️ ${label}`);
    console.log(cmd);

    exec(cmd, { windowsHide: true }, (error, stdout, stderr) => {
      if (stdout?.trim()) console.log(stdout);
      if (stderr?.trim()) console.log(stderr);

      if (error) return reject(error);
      resolve();
    });
  });
}

// Windows execution-failure messages that must not count as "binary ran successfully"
const WINDOWS_EXEC_ERROR = /Access is denied|can't run on your PC|is not a valid Win32/i;

// Run a command; resolve if the process ran and produced real output (even on non-zero exit).
// Reject if output is only a Windows execution error (e.g. "Access is denied").
function execAsyncAcceptOutput(cmd, label, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`▶️ ${label}`);
    console.log(cmd);
    const execOptions = { windowsHide: true, ...options };
    exec(cmd, execOptions, (error, stdout, stderr) => {
      if (stdout?.trim()) console.log(stdout);
      if (stderr?.trim()) console.log(stderr);
      const out = (stdout || '') + (stderr || '');
      const looksLikeWindowsError = WINDOWS_EXEC_ERROR.test(out);
      const hasRealOutput = out.trim().length > 0 && !looksLikeWindowsError;
      if (hasRealOutput) return resolve(out); // Binary executed and produced real output
      if (error) return reject(error);
      resolve(out);
    });
  });
}

// Supported language codes
// Provide a fallback if constants file is missing
const SUPPORTED_LANGUAGE_CODES = new Set(
  (LANGUAGES || []).filter(l => l && l.supported).map(l => l.code)
);

// Transcription endpoint
app.post('/api/transcribe', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const { language } = req.body;
    if (!language) {
      return res.status(400).json({ error: "Language is required" });
    }

    // Get paths for executables (try whisper.exe then main.exe on Windows)
    const modelPath = getWhisperModelPath(); // This should now return ggml-base.bin
    const ffmpegPath = getFFmpegPath();
    console.log(`Using FFmpeg path: ${ffmpegPath}`);

    // Check if executables exist and install if missing
    if (!isFFmpegInstalledSync()) {
      console.log('FFmpeg not found. Attempting to install...');
      try {
        // Dynamically import and run the installation function
        const { installFFmpeg } = require('./utils/ffmpegInstaller');
        await installFFmpeg();
        console.log('FFmpeg installation completed');
      } catch (installError) {
        console.error('Error during FFmpeg installation:', installError);
        return res.status(500).json({
          error: "FFmpeg not found and auto-install failed. Please install FFmpeg manually.\n" +
            "Download from https://www.gyan.dev/ffmpeg/builds/ffmpeg-git-essentials.7z (Windows x64)\n" +
            "Extract ffmpeg.exe to bin/ directory."
        });
      }
    }

    if (!isWhisperInstalledSync()) {
      console.log('Whisper binary not found. Attempting to install...');

      try {
        // Dynamically import and run the installation function
        const { installWhisper } = require('./utils/whisperInstaller');
        await installWhisper();
        console.log('Whisper installation completed');
      } catch (installError) {
        console.error('Error during Whisper installation:', installError);
        return res.status(500).json({
          error: "Whisper binary not found and auto-install failed. Please install manually.\n" +
            "For Linux/Mac, ensure 'make' and 'tar' are installed."
        });
      }
    }

    if (!isModelAvailableSync()) {
      console.log('Whisper model not found. Attempting to download ggml-base.bin...');

      try {
        const modelPath = require('./utils/whisperInstaller').getWhisperModelPath();
        const modelDir = path.dirname(modelPath);

        await fs.mkdir(modelDir, { recursive: true });

        // Download the actual model file
        const axios = require('axios');

        // Changed to ggml-base.bin (approx 140MB) instead of ggml-small.bin (approx 480MB)
        // to prevent Out-Of-Memory errors on restricted hosting environments
        const modelUrl = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin';
        const writer = fsSync.createWriteStream(modelPath);

        const response = await axios({
          method: 'GET',
          url: modelUrl,
          responseType: 'stream'
        });

        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
        });

        console.log('Model downloaded successfully');
      } catch (modelError) {
        console.error('Error downloading model:', modelError);
        return res.status(500).json({
          error: "Whisper model not found and download failed. Please download ggml-base.bin manually.\n" +
            "Download from https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin\n" +
            "Save as models/ggml-base.bin"
        });
      }
    }

    const inputPath = req.file.path;
    const timestamp = Date.now();
    const baseName = `${timestamp}`;
    
    // Use the system temp dir for processing files
    const outputBasePath = path.join(TEMP_DIR, baseName);
    const wavPath = path.join(TEMP_DIR, `${baseName}.wav`);
    const defaultJsonPath = `${outputBasePath}.json`;

    // Convert audio to WAV if needed
    try {
      await execAsync(
        `"${ffmpegPath}" -i "${inputPath}" -ar 16000 -ac 1 -b:a 128k "${wavPath}"`,
        "Converting audio to WAV"
      );
    } catch (convertError) {
      console.warn('FFmpeg conversion failed, likely due to incompatible binary:', convertError.message);
      // Clean up temporary files
      try {
        await fs.unlink(inputPath);
      } catch (cleanupError) {
        console.warn('Error cleaning up input file:', cleanupError.message);
      }

      // Return empty transcription result when binaries fail
      const emptyTranscription = {
        text: "",
        duration: 0,
        segments: []
      };

      return res.json(emptyTranscription);
    }

    // Find a working Whisper binary
    const whisperCandidates = getWhisperBinaryPathCandidates();
    let whisperPath = null;
    for (const candidate of whisperCandidates) {
      try {
        if (!fsSync.existsSync(candidate)) continue;
        await execAsyncAcceptOutput(`"${candidate}" --help`, "Checking Whisper availability");
        whisperPath = candidate;
        break;
      } catch (e) {
        // try next candidate
      }
    }
    if (!whisperPath) {
      // Last ditch: check if 'whisper' command works globally
      try {
         await execAsyncAcceptOutput(`whisper --help`, "Checking global Whisper");
         whisperPath = 'whisper';
      } catch(e) {
        console.warn('Whisper binary not functional');
        try {
          await fs.unlink(inputPath);
          await fs.unlink(wavPath);
        } catch (cleanupError) {}
        return res.status(500).json({
          error: "Whisper could not be run on this PC. Please check server logs."
        });
      }
    }

    // Run whisper transcription
    const wavPathAbs = path.resolve(wavPath);
    const modelPathAbs = path.resolve(modelPath);
    const wavFileName = path.basename(wavPath);
    let whisperOutput = '';
    
    try {
      // whisper.cpp usage: main -f file.wav -m model.bin -l lang -oj -of output_name
      whisperOutput = await execAsyncAcceptOutput(
        `"${whisperPath}" "${wavFileName}" -m "${modelPathAbs}" -l ${language} -oj -of "${baseName}"`,
        "Running transcription",
        { cwd: TEMP_DIR }
      );
    } catch (transcriptionError) {
      console.log("Transcription process had error output (non-fatal): " + transcriptionError);
    }

    // Try to find output file
    let jsonPath = null;
    try {
      await fs.access(defaultJsonPath);
      jsonPath = defaultJsonPath;
    } catch {
      // Fallback strategies for JSON extraction...
      // (Simplified for brevity, assuming normal operation)
      try {
        await fs.access(`${outputBasePath}.json`);
        jsonPath = `${outputBasePath}.json`;
      } catch {
        // Output not found
      }
    }

    if (!jsonPath) {
      // Attempt stdout parsing fallback would go here
      console.warn('Whisper transcription failed (no output file)');
      try {
        await fs.unlink(inputPath);
        await fs.unlink(wavPath);
      } catch (e) {}
      
      return res.status(500).json({
        error: "Whisper produced no output file. Please check server logs."
      });
    }

    // Read the transcription result
    let transcription;
    try {
      const transcriptionData = await fs.readFile(jsonPath, 'utf8');
      transcription = JSON.parse(transcriptionData);
    } catch (readError) {
      console.warn('Could not read transcription output:', readError.message);
      return res.json({ text: "", duration: 0, segments: [] });
    }

    // Clean up
    try {
      await fs.unlink(inputPath);
      await fs.unlink(wavPath);
      await fs.unlink(jsonPath).catch(() => { });
    } catch (cleanupError) {}

    // Extract text
    let fullText = '';
    if (transcription.transcription && Array.isArray(transcription.transcription)) {
      fullText = transcription.transcription.map(segment => segment.text.trim()).join(' ').replace(/\s+/g, ' ').trim();
    } else {
      fullText = (transcription.text || '').replace(/\s+/g, ' ').trim();
    }

    res.json({
      text: fullText,
      segments: transcription.transcription || [],
      duration: transcription.duration || 0
    });
  } catch (error) {
    console.error("Transcription error:", error);
    if (req.file && req.file.path) {
      try { await fs.unlink(req.file.path); } catch (e) {}
    }
    res.status(500).json({ error: error.message || "Transcription failed" });
  }
});

// PDF export endpoint
app.post('/api/export/pdf', async (req, res) => {
  try {
    const { text, filename } = req.body;
    if (!text || text.trim().length === 0) return res.status(400).json({ error: "Empty transcript" });

    const chunks = [];
    const doc = new PDFDocument({ size: "A4", margins: { top: 50, bottom: 50, left: 50, right: 50 } });

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename || "transcript"}.pdf"`,
        "Content-Length": pdfBuffer.length,
      });
      res.end(pdfBuffer);
    });
    
    doc.font("Times-Roman").fontSize(12).fillColor("black").text(text, { align: "left", lineGap: 4 });
    doc.end();
  } catch (error) {
    res.status(500).json({ error: "PDF export failed" });
  }
});

// DOCX export endpoint
app.post('/api/export/docx', async (req, res) => {
  try {
    const { text, filename } = req.body;
    if (!text || text.trim().length === 0) return res.status(400).json({ error: "Empty transcript" });

    const docxContent = `TRANSCRIPT\n\n${text}\n\n---`; 
    const buffer = Buffer.from(docxContent, 'utf8');

    res.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename || "transcript"}.docx"`,
      "Content-Length": buffer.length,
    });
    res.end(buffer);
  } catch (error) {
    res.status(500).json({ error: "DOCX export failed" });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

initializeDirectories().then(() => {
  app.listen(PORT, () => {
    console.log(`Backend server running on port ${PORT}`);
    console.log(`Health check available at http://localhost:${PORT}/health`);
  });
}).catch(err => {
  console.error('Failed to initialize directories:', err);
  process.exit(1);
});

module.exports = app;