@echo off
echo Setting up Voxcribe Whisper Backend...

REM Create required directories
echo Creating directories...
mkdir uploads 2>nul
mkdir temp 2>nul
mkdir models 2>nul
mkdir bin 2>nul

REM Install dependencies
echo Installing dependencies...
npm install

echo.
echo Setup complete!
echo.
echo Next steps:
echo 1. Download ggml-small.bin and place in models/ directory
echo 2. Download whisper-cli.exe and ffmpeg.exe and place in bin/ directory
echo 3. Run 'npm start' to start the server
echo.
pause