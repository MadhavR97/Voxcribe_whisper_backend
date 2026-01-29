# Deployment Guide for Voxcribe Whisper

## Backend Deployment (Render)

### 1. Prepare for Render Deployment

#### Update CORS Configuration
In `backend/server.js`, update the CORS origin with your actual Vercel frontend URL:
```javascript
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://your-actual-vercel-app.vercel.app'] // ← Replace with your Vercel URL
    : ['http://localhost:3000'],
  credentials: true
};
```

#### Create Render Configuration Files

Create `render.yaml` in the backend directory:
```yaml
services:
  - type: web
    name: voxcribe-backend
    env: node
    buildCommand: npm install
    startCommand: npm start
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 10000
```

### 2. Address Linux Compatibility Issues

**Critical Issue**: Your current backend uses Windows-specific binaries:
- `ffmpeg.exe` → Needs Linux `ffmpeg`
- `whisper-cli.exe` → Needs Linux `whisper-cli`

#### Solution Options:

**Option A: Use System Package Manager (Recommended)**
Add to your Render service environment:
```
BUILD_COMMAND=npm install && apt-get update && apt-get install -y ffmpeg
```

**Option B: Manual Binary Installation**
1. Download Linux binaries for ffmpeg and whisper-cli
2. Modify installer scripts to detect Linux environment
3. Update paths accordingly

### 3. Deploy to Render

1. Push your code to GitHub
2. Go to [Render Dashboard](https://dashboard.render.com/)
3. Click "New+" → "Web Service"
4. Connect your GitHub repository
5. Select the backend directory
6. Configure:
   - Name: `voxcribe-backend`
   - Environment: Node
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Environment Variables:
     ```
     NODE_ENV=production
     ```

## Frontend Deployment (Vercel)

### 1. Update API Endpoints

In your frontend code, update all API calls to use the Render backend URL:

Find and replace:
- `http://localhost:5000` → `https://your-render-backend.onrender.com`

### 2. Update Environment Variables

Create `.env.production` in frontend directory:
```
NEXT_PUBLIC_BACKEND_URL=https://your-render-backend.onrender.com
```

### 3. Deploy to Vercel

1. Push your code to GitHub
2. Go to [Vercel Dashboard](https://vercel.com/dashboard)
3. Click "Add New..." → "Project"
4. Import your GitHub repository
5. Configure:
   - Framework Preset: Next.js
   - Root Directory: `frontend`
   - Environment Variables:
     ```
     NEXT_PUBLIC_BACKEND_URL=https://your-render-backend.onrender.com
     ```

## Post-Deployment Checklist

### Backend (Render)
- [ ] CORS configured with Vercel domain
- [ ] Linux-compatible binaries installed
- [ ] Health check endpoint working: `GET /health`
- [ ] File upload endpoint working
- [ ] Transcription endpoint working

### Frontend (Vercel)  
- [ ] API URLs pointing to Render backend
- [ ] Environment variables configured
- [ ] Audio upload working
- [ ] Transcription display working
- [ ] PDF export working

## Troubleshooting

### Common Issues:

1. **CORS Errors**: Make sure your Vercel domain is in the CORS whitelist
2. **Binary Not Found**: Render uses Linux - Windows .exe files won't work
3. **File Upload Failures**: Check file size limits and multipart form handling
4. **Timeout Errors**: Long audio files may timeout - consider async processing

### Testing:
1. Test health endpoint: `curl https://your-render-backend.onrender.com/health`
2. Test file upload with small audio file
3. Verify transcription works end-to-end

## Important Notes

- Render free tier has limitations on request duration and storage
- Consider using cloud storage (AWS S3, Cloudinary) for file persistence
- For production, implement proper error handling and logging
- Monitor usage to stay within free tier limits