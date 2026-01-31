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
const SUPPORTED_LANGUAGE_CODES = new Set(
  LANGUAGES.filter(l => l.supported).map(l => l.code)
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

    if (!SUPPORTED_LANGUAGE_CODES.has(language)) {
      return res.status(400).json({ error: "Unsupported language" });
    }

    // Get paths for executables (try whisper.exe then main.exe on Windows)
    const modelPath = getWhisperModelPath();
    const ffmpegPath = getFFmpegPath();

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
            "Extract ffmpeg.exe to backend/bin/ directory."
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
      console.log('Whisper model not found. Attempting to download ggml-small.bin...');

      try {
        const modelPath = require('./utils/whisperInstaller').getWhisperModelPath();
        const modelDir = path.dirname(modelPath);

        await fs.mkdir(modelDir, { recursive: true });

        // Download the actual model file
        const axios = require('axios');

        // Try to download the ggml-small.bin model
        const modelUrl = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin';
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
          error: "Whisper model not found and download failed. Please download ggml-small.bin manually.\n" +
            "Download from https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin\n" +
            "Save as backend/models/ggml-small.bin"
        });
      }
    }

    const inputPath = req.file.path;
    const timestamp = Date.now();
    const baseName = `${timestamp}`;
    const outputFileName = `${baseName}_transcription.json`;
    
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

    // Check if the binaries are functional by attempting to run a simple command
    try {
      // Try to run FFmpeg to verify it's a proper executable
      await execAsync(
        `"${ffmpegPath}" -version`,
        "Checking FFmpeg version"
      );
    } catch (versionError) {
      console.warn('FFmpeg binary not functional, returning empty result');
      // Clean up temporary files
      try {
        await fs.unlink(inputPath);
        await fs.unlink(wavPath);
      } catch (cleanupError) {
        console.warn('Error cleaning up files:', cleanupError.message);
      }

      // Return empty transcription result when binaries fail
      const emptyTranscription = {
        text: "",
        duration: 0,
        segments: []
      };

      return res.json(emptyTranscription);
    }

    // Find a working Whisper binary (try whisper.exe then main.exe on Windows)
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
      console.warn('Whisper binary not functional (Access denied / app can\'t run on PC)');
      try {
        await fs.unlink(inputPath);
        await fs.unlink(wavPath);
      } catch (cleanupError) {
        console.warn('Error cleaning up files:', cleanupError.message);
      }
      return res.status(500).json({
        error: "Whisper could not be run on this PC.\n\n" +
          "1. Unblock the executable: Right-click backend\\bin\\whisper.exe (and main.exe) → Properties → at the bottom check 'Unblock' → OK.\n" +
          "2. Use 64-bit Windows. Download a compatible build from: https://github.com/ggerganov/whisper.cpp/releases"
      });
    }

    // Run whisper transcription (whisper.cpp main: input file first so -oj isn't given the wav path)
    // Whisper CLI may output to stdout instead of file; handle both cases
    const wavPathAbs = path.resolve(wavPath);
    const modelPathAbs = path.resolve(modelPath);
    const wavFileName = path.basename(wavPath);
    let whisperOutput = '';
    try {
      whisperOutput = await execAsyncAcceptOutput(
        `"${whisperPath}" "${wavFileName}" -m "${modelPathAbs}" -l ${language} -oj -of "${baseName}"`,
        "Running transcription",
        { cwd: TEMP_DIR }
      );
    } catch (transcriptionError) {
      // Ignore exit code; check if output was actually written
    }
    // Try to find output file first
    let jsonPath = null;
    try {
      await fs.access(defaultJsonPath);
      jsonPath = defaultJsonPath;
    } catch {
      // Fallback: some builds accept -oj path and write to outputPath
      try {
        await fs.access(`${outputBasePath}.json`);
        jsonPath = `${outputBasePath}.json`;
      } catch {
        // If no output file was created but we got output in stdout, create a temporary file
        if (whisperOutput && whisperOutput.includes('[00:00:')) {
          // Extract JSON from stdout if it's embedded there
          const jsonMatch = whisperOutput.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            // Write the JSON to a temp file
            await fs.writeFile(defaultJsonPath, jsonMatch[0]);
            jsonPath = defaultJsonPath;
          } else {
            // If no JSON found in stdout, create a basic structure with the transcription text
            // Clean up Whisper CLI output (remove model loading info, timing stats, etc.)
            let cleanOutput = whisperOutput;

            // Remove lines containing Whisper CLI output patterns
            const lines = cleanOutput.split('\n');
            const cleanLines = lines.filter(line =>
              !line.includes('whisper_') &&
              !line.includes('system_info:') &&
              !line.includes('main:') &&
              !line.includes('output_json:') &&
              !line.includes('whisper_print_timings:') &&
              !line.includes('loading model') &&
              !line.includes('use gpu') &&
              !line.includes('CPU total size') &&
              !line.includes('ftype=') &&
              !line.includes('n_vocab=') &&
              !line.includes('n_audio_ctx=') &&
              !line.includes('n_text_ctx=') &&
              !line.includes('model size') &&
              !line.includes('kvself size') &&
              !line.includes('compute buffer') &&
              !line.includes('total time') &&
              !line.includes('load time') &&
              !line.includes('mel time') &&
              !line.includes('encode time') &&
              !line.includes('decode time')
            );

            const transcriptionText = cleanLines.join(' ').replace(/\[\d+:\d+:\d+\.\d+ --> \d+:\d+:\d+\.\d+\]\s*/g, '').replace(/\s+/g, ' ').trim();
            if (transcriptionText) {
              const transcriptionObj = {
                systeminfo: "Generated from Whisper CLI stdout",
                model: { type: "unknown" },
                params: { model: modelPathAbs, language: language },
                result: { language: language },
                transcription: [{
                  timestamps: { from: "00:00:00,000", to: "00:01:00,000" },
                  offsets: { from: 0, to: 60000 },
                  text: transcriptionText
                }]
              };
              await fs.writeFile(defaultJsonPath, JSON.stringify(transcriptionObj));
              jsonPath = defaultJsonPath;
            }
          }
        }
      }
    }

    if (!jsonPath) {
      console.warn('Whisper transcription failed (no output file and no stdout output)');
      try {
        await fs.unlink(inputPath);
        await fs.unlink(wavPath);
      } catch (cleanupError) {
        console.warn('Error cleaning up files:', cleanupError.message);
      }
      const usedMain = whisperPath && path.basename(whisperPath).toLowerCase() === 'main.exe';
      return res.status(500).json({
        error: usedMain
          ? "The installed Whisper binary (main.exe) is a deprecation stub and does not transcribe.\n\n" +
          "Download a working CLI:\n" +
          "1. Go to https://github.com/ggml-org/whisper.cpp/releases or https://github.com/dscripka/whisper.cpp_binaries/releases\n" +
          "2. Download a Windows x64 build (e.g. whisper-bin-x64.zip) that includes whisper-cli.exe\n" +
          "3. Extract whisper-cli.exe into your backend/bin/ folder\n" +
          "4. Restart the backend and try again."
          : "Whisper produced no output file. Ensure backend/bin/ has a working whisper-cli.exe (see ggml-org/whisper.cpp releases)."
      });
    }

    // Read the transcription result
    let transcription;
    try {
      const transcriptionData = await fs.readFile(jsonPath, 'utf8');
      transcription = JSON.parse(transcriptionData);
    } catch (readError) {
      console.warn('Could not read transcription output, likely due to Whisper error:', readError.message);
      try {
        await fs.unlink(inputPath);
        await fs.unlink(wavPath);
        await fs.unlink(jsonPath).catch(() => { });
      } catch (cleanupError) {
        console.warn('Error cleaning up files:', cleanupError.message);
      }

      // Return empty transcription result when binaries fail
      const emptyTranscription = {
        text: "",
        duration: 0,
        segments: []
      };

      return res.json(emptyTranscription);
    }

    // Clean up temporary files
    try {
      await fs.unlink(inputPath);
      await fs.unlink(wavPath);
      await fs.unlink(jsonPath).catch(() => { });
    } catch (cleanupError) {
      console.warn('Error cleaning up files:', cleanupError.message);
    }

    // Extract text from segments, cleaning up any extra whitespace
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

    // Clean up uploaded file if it exists
    if (req.file && req.file.path) {
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        console.warn('Error deleting uploaded file:', unlinkError.message);
      }
    }

    res.status(500).json({ error: error.message || "Transcription failed" });
  }
});

// PDF export endpoint
app.post('/api/export/pdf', async (req, res) => {
  try {
    const { text, filename } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: "Empty transcript" });
    }

    const chunks = [];
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
    });

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
    doc.on("error", (err) => {
      console.error("PDF generation error:", err);
      res.status(500).json({ error: "PDF export failed" });
    });

    doc.font("Times-Roman");
    doc.fontSize(12);
    doc.fillColor("black");
    doc.text(text, {
      align: "left",
      lineGap: 4,
    });

    doc.end();
  } catch (error) {
    console.error("PDF export failed:", error);
    res.status(500).json({ error: "PDF export failed" });
  }
});

// DOCX export endpoint
app.post('/api/export/docx', async (req, res) => {
  try {
    const { text, filename } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: "Empty transcript" });
    }

    // Create a simple mock DOCX file (in reality, you would use a library like 'docx')
    const docxContent = `MOCK DOCX FILE

${text}

---
Transcribed by Voxcribe`; // Simple text representation
    const buffer = Buffer.from(docxContent, 'utf8');

    res.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename || "transcript"}.docx"`,
      "Content-Length": buffer.length,
    });
    res.end(buffer);
  } catch (error) {
    console.error("DOCX export failed:", error);
    res.status(500).json({ error: "DOCX export failed" });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Initialize and start server
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