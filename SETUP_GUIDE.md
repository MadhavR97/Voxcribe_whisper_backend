# Complete Setup Guide

## Prerequisites
- Node.js 22.22.0 or later
- Git
- Supabase account (for frontend)

## Backend Setup (Local Development)

1. **Clone the repository**:
```bash
git clone https://github.com/MadhavR97/Voxcribe_whisper_backend.git
cd Voxcribe_whisper_backend
```

2. **Install dependencies**:
```bash
npm install
```

3. **Create required directories**:
```bash
mkdir uploads temp models bin
```

4. **Download Whisper model**:
   - Download `ggml-small.bin` from [HuggingFace](https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin)
   - Place it in the `models/` directory

5. **Download binaries** (Windows):
   - Download `whisper-cli.exe` from [whisper.cpp releases](https://github.com/ggml-org/whisper.cpp/releases)
   - Download `ffmpeg.exe` from [FFmpeg builds](https://www.gyan.dev/ffmpeg/builds/)
   - Place both in the `bin/` directory

6. **Start the backend**:
```bash
npm start
```
Backend will run on `http://localhost:5000`

## Frontend Setup (Local Development)

1. **Clone the repository**:
```bash
git clone https://github.com/MadhavR97/Voxcribe_whisper_frontend.git
cd Voxcribe_whisper_frontend
```

2. **Install dependencies**:
```bash
npm install
```

3. **Create environment file** (`.env.local`):
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
NEXT_PUBLIC_BACKEND_URL=http://localhost:5000
```

4. **Start the frontend**:
```bash
npm run dev
```
Frontend will run on `http://localhost:3000`

## Production Deployment

### Backend (Render)
1. Push to GitHub
2. Create Web Service on Render
3. Configuration:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Environment Variables:
     ```
     NODE_ENV=production
     FRONTEND_URL=https://voxcribe-two.vercel.app
     ```

### Frontend (Vercel)
1. Push to GitHub
2. Deploy via Vercel CLI:
   ```bash
   vercel --prod
   ```
3. Environment Variables:
   ```
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_key
   NEXT_PUBLIC_BACKEND_URL=https://voxcribe-whisper-backend.onrender.com
   ```

## Current Production URLs
- **Frontend**: https://voxcribe-two.vercel.app
- **Backend**: https://voxcribe-whisper-backend.onrender.com

## Testing
1. Visit the frontend URL
2. Upload an audio file
3. Verify transcription works
4. Test PDF export functionality