const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs'); // Added for sync checks
const os = require('os');
const { exec } = require('child_process');
const PDFDocument = require('pdfkit');
const multer = require('multer');
const axios = require('axios');

const app = express();

// --- 1. CONFIGURATION ---
// Use environment variable for PORT (Render uses 10000, Local uses 5000)
const PORT = process.env.PORT || 5000;

// Update CORS to support both Local and your Vercel Production URL
const allowedOrigins = [
    'http://localhost:3000',
    'https://voxcribe-whisper-frontend.vercel.app' // REPLACE with your actual Vercel URL
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --- 2. HELPERS & PATHS ---
const { 
    isWhisperInstalledSync, 
    isModelAvailableSync, 
    getWhisperBinaryPathCandidates, 
    getWhisperModelPath 
} = require('./utils/whisperInstaller');

const { isFFmpegInstalledSync, getFFmpegPath } = require('./utils/ffmpegInstaller');
const { LANGUAGES } = require('./constants/languages');

// Storage Configuration
const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage });

/**
 * FIXED: Universal Path Helper for Render and Windows
 * This ensures binaries are executable on Linux
 */
function getExecutablePath(originalPath) {
    if (process.env.RENDER || os.platform() === 'linux') {
        // Remove .exe extension if present and point to project bin
        const linuxPath = originalPath.replace('.exe', '');
        if (fsSync.existsSync(linuxPath)) {
            try { fsSync.chmodSync(linuxPath, '755'); } catch (e) {}
        }
        return linuxPath;
    }
    return originalPath;
}

async function initializeDirectories() {
    try {
        await fs.mkdir('./uploads', { recursive: true });
        await fs.mkdir('./temp', { recursive: true });
        await fs.mkdir('./bin', { recursive: true });
        await fs.mkdir('./models', { recursive: true });
    } catch (error) {
        console.error('Error initializing directories:', error);
    }
}

function execAsync(cmd, label, options = {}) {
    return new Promise((resolve, reject) => {
        console.log(`▶️ ${label}`);
        const execOptions = { windowsHide: true, ...options };
        exec(cmd, execOptions, (error, stdout, stderr) => {
            if (error) {
                console.error(`❌ ${label} failed:`, stderr);
                return reject(error);
            }
            resolve(stdout || stderr);
        });
    });
}

const SUPPORTED_LANGUAGE_CODES = new Set(
    LANGUAGES.filter(l => l.supported).map(l => l.code)
);

// --- 3. ROUTES ---

app.post('/api/transcribe', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });

        const language = req.body.language || 'en';
        const modelPath = getWhisperModelPath();
        const ffmpegPath = getExecutablePath(getFFmpegPath());

        // Ensure Directories and Dependencies
        await initializeDirectories();

        // 1. Convert to WAV (16kHz mono is mandatory for whisper.cpp)
        const inputPath = req.file.path;
        const tempDir = path.resolve('./temp');
        const timestamp = Date.now();
        const baseName = `transcription_${timestamp}`;
        const wavPath = path.join(tempDir, `${baseName}.wav`);

        console.log('--- Starting Conversion ---');
        await execAsync(
            `"${ffmpegPath}" -i "${inputPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${wavPath}"`,
            "FFmpeg Audio Conversion"
        );

        // 2. Identify Whisper Binary
        const whisperCandidates = getWhisperBinaryPathCandidates();
        let whisperPath = null;

        for (const candidate of whisperCandidates) {
            const current = getExecutablePath(candidate);
            if (fsSync.existsSync(current)) {
                whisperPath = current;
                break;
            }
        }

        if (!whisperPath) {
            throw new Error("Whisper binary not found. Check /bin folder.");
        }

        // 3. Run Whisper
        console.log('--- Starting Transcription ---');
        // We use -otxt for compatibility, then we can parse or return the text
        const outputFormat = "-oj"; // JSON output
        await execAsync(
            `"${whisperPath}" -m "${modelPath}" -f "${wavPath}" -l ${language} ${outputFormat} -of "${path.join(tempDir, baseName)}"`,
            "Whisper.cpp Processing",
            { cwd: tempDir }
        );

        const jsonResultPath = path.join(tempDir, `${baseName}.json`);
        const transcriptionData = await fs.readFile(jsonResultPath, 'utf8');
        const transcription = JSON.parse(transcriptionData);

        // Cleanup
        await fs.unlink(inputPath);
        await fs.unlink(wavPath);
        await fs.unlink(jsonResultPath);

        res.json({
            text: transcription.transcription.map(s => s.text).join(' ').trim(),
            segments: transcription.transcription,
            duration: transcription.transcription[transcription.transcription.length - 1]?.offsets?.to / 1000 || 0
        });

    } catch (error) {
        console.error("Transcription error:", error);
        res.status(500).json({ error: error.message || "Transcription failed" });
    }
});

// PDF export endpoint
app.post('/api/export/pdf', async (req, res) => {
    try {
        const { text, filename } = req.body;
        if (!text) return res.status(400).json({ error: "Empty transcript" });

        const doc = new PDFDocument();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename || 'transcript'}.pdf"`);
        
        doc.pipe(res);
        doc.fontSize(12).text(text);
        doc.end();
    } catch (error) {
        res.status(500).json({ error: "PDF export failed" });
    }
});

// Health check endpoint
app.get('/health', async (req, res) => {
    const ffPath = getExecutablePath(getFFmpegPath());
    res.json({ 
        status: 'OK', 
        platform: os.platform(),
        ffmpegReady: fsSync.existsSync(ffPath),
        ffmpegPath: ffPath
    });
});

// Start server
initializeDirectories().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Backend running on port ${PORT}`);
    });
});