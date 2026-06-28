export interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  speechText?: string; // Transcription in Devanagari/Hindi for natural Indian accent reading
  timestamp: string;
  isAudio?: boolean; // Indicates if this message was sent via voice call
}

export interface AppSettings {
  geminiApiKey: string;
  voiceName: string; // The Microsoft Edge Neural TTS voice ID
  voiceSpeed: number; // Playback speed (0.5 to 2)
  autoSpeak: boolean; // Speak automatically in text chat mode
  nickname: string; // What Aria calls the user (e.g. "Babe", "Love", "Dear")
}

export type CallState = 'idle' | 'ringing' | 'connected' | 'ended';

export interface ChatSessionResponse {
  text: string;
  speechText: string;
}

export interface VoiceCharacter {
  name: string;
  description: string;
  voiceId: string;
  personality: string;
  systemPrompt: string;
}
