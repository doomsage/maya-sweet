import { NextResponse } from 'next/server';
import { EdgeTTS } from 'edge-tts-universal';

export async function POST(req: Request) {
  try {
    const { text, voice } = await req.json();

    if (!text) {
      return NextResponse.json({ error: 'Text parameter is required' }, { status: 400 });
    }

    const ttsVoice = voice || 'hi-IN-SwararaNeural'; // Default to Swarara (Indian female voice)

    // Microsoft Edge TTS Read Aloud service call
    const tts = new EdgeTTS(text, ttsVoice);
    const result = await tts.synthesize();
    const audioBuffer = Buffer.from(await result.audio.arrayBuffer());

    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error: any) {
    console.error('API Voice Route Error:', error);
    return NextResponse.json({ error: error.message || 'Text-to-Speech synthesis failed' }, { status: 500 });
  }
}
