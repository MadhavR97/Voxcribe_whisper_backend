const { installFFmpeg } = require('../utils/ffmpegInstaller');
const { installWhisper } = require('../utils/whisperInstaller');

(async () => {
  console.log('🚀 Starting Build Process...');

  try {
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