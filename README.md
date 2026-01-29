# Voxcribe Whisper Backend

Audio transcription backend API using Whisper.cpp

## Features
- Audio file upload and processing
- Speech-to-text transcription using Whisper
- PDF/DOCX export functionality
- Automatic file cleanup after processing

## Tech Stack
- Node.js + Express
- Whisper.cpp for transcription
- FFmpeg for audio conversion
- PDFKit for PDF generation

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create required directories:
```bash
mkdir uploads temp models bin
```

3. Download Whisper model:
```bash
# Download ggml-small.bin from HuggingFace
# Place in models/ directory
```

4. Install binaries:
```bash
# Download whisper-cli and ffmpeg for your platform
# Place in bin/ directory
```

5. Start server:
```bash
npm start
```

## API Endpoints
- `POST /api/transcribe` - Transcribe audio file
- `POST /api/export/pdf` - Export transcription to PDF
- `POST /api/export/docx` - Export transcription to DOCX
- `GET /health` - Health check

## Deployment
See `DEPLOYMENT_GUIDE.md` for Render deployment instructions.

## Environment Variables
```env
NODE_ENV=production
PORT=5000
```