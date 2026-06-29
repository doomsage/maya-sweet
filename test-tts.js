const { EdgeTTS } = require('edge-tts-universal');
const fs = require('fs');

async function test() {
  try {
    console.log("Synthesizing with Swara...");
    const tts = new EdgeTTS("नमस्ते, मैं आपकी माया हूँ।", "hi-IN-SwaraNeural");
    const result = await tts.synthesize();
    console.log("Success! Audio Blob size:", result.audio.size);
  } catch (err) {
    console.error("Error:", err);
  }
}

test();
