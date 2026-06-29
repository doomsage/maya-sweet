import { useEffect, useRef, useState, useCallback } from 'react';

// Declare global types for webkitSpeechRecognition
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: {
    [index: number]: {
      [index: number]: {
        transcript: string;
      };
      isFinal: boolean;
    };
    length: number;
  };
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

export function useSpeech(voiceName: string) {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [recognitionSupported, setRecognitionSupported] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  // Initialize Speech Recognition & Persistent Audio Element
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Create persistent audio element
      const audio = new Audio();
      audio.crossOrigin = 'anonymous';
      audioRef.current = audio;

      const SpeechRecognitionClass =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      
      if (SpeechRecognitionClass) {
        setRecognitionSupported(true);
        const rec = new SpeechRecognitionClass();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = 'hi-IN'; // Set to Hindi/Hinglish transcription by default
        recognitionRef.current = rec;
      }
    }
  }, []);

  // Initialize Audio Context for Audio Visualizer
  const initAudio = useCallback(() => {
    if (typeof window !== 'undefined' && !audioContextRef.current) {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const audioCtx = new AudioContextClass();
        const analyserNode = audioCtx.createAnalyser();
        analyserNode.fftSize = 256;
        
        audioContextRef.current = audioCtx;
        analyserRef.current = analyserNode;
        setAnalyser(analyserNode);
      } catch (err) {
        console.error('Failed to initialize Web Audio API Context:', err);
      }
    }
    
    // Resume audio context if suspended (common browser security policy)
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume().catch(() => {});
    }
  }, []);

  // Unlock Audio function: MUST run directly in a user click event to unlock mobile browser playback
  const unlockAudio = useCallback(() => {
    if (typeof window === 'undefined') return;
    
    // 1. Play a 0.1-second silent WAV to unlock the persistent audio element
    const audio = audioRef.current;
    if (audio) {
      audio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAAAAAA==';
      audio.play().then(() => {
        audio.pause();
        console.log('Audio element successfully unlocked.');
      }).catch((err) => {
        console.warn('Audio element unlock warning:', err);
      });
    }

    // 2. Initialize and resume AudioContext
    initAudio();
  }, [initAudio]);

  // Speak function: calls Edge TTS API and plays the audio
  const speak = useCallback(async (text: string) => {
    if (!text) return;
    
    try {
      const audio = audioRef.current;
      if (!audio) {
        throw new Error('Audio element not initialized');
      }

      // Stop current playback if active
      audio.pause();
      audio.currentTime = 0;

      // Connect to Web Audio API for visualizer (re-use source if already connected)
      if (audioContextRef.current && analyserRef.current && !sourceRef.current) {
        try {
          const source = audioContextRef.current.createMediaElementSource(audio);
          source.connect(analyserRef.current);
          analyserRef.current.connect(audioContextRef.current.destination);
          sourceRef.current = source;
        } catch (audioConnectErr) {
          console.warn('Could not connect audio to AnalyserNode:', audioConnectErr);
        }
      }

      setIsSpeaking(true);

      // Call serverless Edge TTS route
      const res = await fetch('/api/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: voiceName }),
      });

      if (!res.ok) {
        throw new Error('TTS API failed');
      }

      const blob = await res.blob();
      const audioUrl = URL.createObjectURL(blob);
      
      // Swap src on our ALREADY UNLOCKED audio element
      audio.src = audioUrl;

      // Handle audio events
      audio.onended = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
      };

      audio.onerror = (e) => {
        console.error('Audio playback error:', e);
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
      };

      await audio.play();
    } catch (err) {
      console.error('Speech synthesis failed:', err);
      setIsSpeaking(false);
    }
  }, [voiceName]);

  // Stop speaking
  const stopSpeaking = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsSpeaking(false);
    }
  }, []);

  // Listen functions
  const startListening = useCallback((onFinalResult?: (result: string) => void) => {
    if (!recognitionRef.current || isListening || isMuted) return;

    initAudio();
    setIsListening(true);
    setTranscript('');
    
    // Reset handlers
    recognitionRef.current.onresult = (event: SpeechRecognitionEvent) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      const currentTranscript = finalTranscript || interimTranscript;
      setTranscript(currentTranscript);

      // Trigger final result callback if speech is completed
      if (finalTranscript && onFinalResult) {
        setIsListening(false);
        recognitionRef.current.stop();
        onFinalResult(finalTranscript.trim());
      }
    };

    recognitionRef.current.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('Speech Recognition Error:', event.error, event.message);
      if (event.error !== 'aborted') {
        setIsListening(false);
      }
    };

    recognitionRef.current.onend = () => {
      setIsListening(false);
    };

    try {
      recognitionRef.current.start();
    } catch (err) {
      console.error('Failed to start speech recognition:', err);
      setIsListening(false);
    }
  }, [isListening, isMuted, initAudio]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsListening(false);
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const nextMute = !prev;
      if (nextMute) {
        stopListening();
      }
      return nextMute;
    });
  }, [stopListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      if (audioRef.current) {
        audioRef.current.pause();
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  return {
    isListening,
    isSpeaking,
    transcript,
    recognitionSupported,
    analyser,
    isMuted,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    toggleMute,
    initAudio,
    unlockAudio,
  };
}
