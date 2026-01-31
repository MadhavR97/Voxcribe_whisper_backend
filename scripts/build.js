const { installFFmpeg } = require('../utils/ffmpegInstaller');
const { installWhisper } = require('../utils/whisperInstaller');
const fs = require('fs');
const path = require('path');

(async () => {
  console.log('🚀 Starting Build Process...');
  console.log('📂 Current Working Directory:', process.cwd());

  try {
    // Ensure bin directory exists in root
    const binDir = path.join(process.cwd(), 'bin');
    if (!fs.existsSync(binDir)) {
      console.log(`📁 Creating bin directory at: ${binDir}`);
      fs.mkdirSync(binDir, { recursive: true });
    }

    // Install FFmpeg
    console.log('\n--- Checking FFmpeg ---');
    await installFFmpeg();

    // Install Whisper
    console.log('\n--- Checking Whisper ---');
    await installWhisper();

    console.log('\n✅ Build & Installation Completed Successfully.');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Build Failed:', error);
    process.exit(1);
  }
})();