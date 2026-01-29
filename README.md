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

### Render Deployment Steps:

1. **Push latest changes to GitHub**:
```bash
git add .
git commit -m "Add Render deployment config"
git push origin main
```

2. **Deploy to Render**:
   - Go to [Render Dashboard](https://dashboard.render.com/)
   - Click "New+" → "Web Service"
   - Connect your GitHub repository
   - Configure:
     - Name: `voxcribe-backend`
     - Environment: Node
     - Build Command: `npm install`
     - Start Command: `npm start`
     - Environment Variables:
       ```
       NODE_ENV=production
       FRONTEND_URL=https://voxcribe-two.vercel.app
       ```

3. **Important Notes**:
   - The build command installs Linux ffmpeg (required for audio processing)
   - Update `FRONTEND_URL` with your actual Vercel frontend URL after deploying frontend
   - Render will automatically detect and use `render.yaml` if present

## Environment Variables
```env
NODE_ENV=production
PORT=5000
```