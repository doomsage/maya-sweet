'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSpeech } from '../hooks/useSpeech';
import { AudioVisualizer } from '../components/AudioVisualizer';
import { Message, AppSettings, CallState } from '../types';

export default function Home() {
  // App state
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [callState, setCallState] = useState<CallState>('idle');
  const [callDuration, setCallDuration] = useState(0);
  const [mounted, setMounted] = useState(false);

  // Settings state (hydrated from localStorage on mount)
  const [settings, setSettings] = useState<AppSettings>({
    geminiApiKey: '',
    voiceName: 'hi-IN-SwaraNeural',
    voiceSpeed: 1.0,
    autoSpeak: true,
    nickname: 'Babe',
  });

  // Refs for tracking
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const callTimerRef = useRef<NodeJS.Timeout | null>(null);
  const callStateRef = useRef<CallState>('idle');
  const isSpeakingRef = useRef<boolean>(false);
  const hasStartedCallRef = useRef<boolean>(false);

  // Initialize Speech Hook
  const {
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
  } = useSpeech(settings.voiceName);

  // Keep refs in sync for callbacks
  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  // Load settings on mount
  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem('maya_girlfriend_settings');
    if (saved) {
      try {
        setSettings(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse settings', e);
      }
    }

    const savedHistory = localStorage.getItem('maya_chat_history');
    if (savedHistory) {
      try {
        setMessages(JSON.parse(savedHistory));
      } catch (e) {
        console.error('Failed to parse chat history', e);
      }
    }
  }, []);

  // Save settings when they change
  const updateSettings = (updates: Partial<AppSettings>) => {
    const nextSettings = { ...settings, ...updates };
    setSettings(nextSettings);
    localStorage.setItem('maya_girlfriend_settings', JSON.stringify(nextSettings));
  };

  // Scroll to bottom of chat
  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isProcessing, scrollToBottom]);

  // Save chat history
  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem('maya_chat_history', JSON.stringify(messages));
    }
  }, [messages]);

  // Timer for active call
  useEffect(() => {
    if (callState === 'connected') {
      callDurationTimerStart();
    } else {
      callDurationTimerStop();
    }
    return () => callDurationTimerStop();
  }, [callState]);

  const callDurationTimerStart = () => {
    setCallDuration(0);
    callTimerRef.current = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);
  };

  const callDurationTimerStop = () => {
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
  };

  const formatDuration = (sec: number) => {
    const minutes = Math.floor(sec / 60);
    const seconds = sec % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // Helper to generate time context for system prompt
  const getTimeContext = () => {
    const date = new Date();
    const hour = date.getHours();
    let timeStr = 'Morning';
    if (hour >= 12 && hour < 17) timeStr = 'Afternoon';
    else if (hour >= 17 && hour < 22) timeStr = 'Evening';
    else if (hour >= 22 || hour < 5) timeStr = 'Late Night';

    return `${timeStr} (Current time is ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
  };

  // Procedural Ringtone Player (Web Audio API)
  const playRingtone = useCallback((durationMs: number, onComplete: () => void) => {
    if (typeof window === 'undefined') return;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass();
      
      const playBeep = (time: number) => {
        // High quality US ringtone is 440Hz + 480Hz
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gainNode = ctx.createGain();

        osc1.frequency.value = 440;
        osc2.frequency.value = 480;

        gainNode.gain.setValueAtTime(0, time);
        gainNode.gain.linearRampToValueAtTime(0.08, time + 0.05);
        gainNode.gain.setValueAtTime(0.08, time + 1.2);
        gainNode.gain.linearRampToValueAtTime(0, time + 1.3);

        osc1.connect(gainNode);
        osc2.connect(gainNode);
        gainNode.connect(ctx.destination);

        osc1.start(time);
        osc2.start(time);
        osc1.stop(time + 1.4);
        osc2.stop(time + 1.4);
      };

      // Play beeps at intervals
      playBeep(ctx.currentTime);
      const interval = setInterval(() => {
        if (ctx.state !== 'closed') {
          playBeep(ctx.currentTime);
        }
      }, 3000);

      setTimeout(() => {
        clearInterval(interval);
        ctx.close().catch(() => {});
        onComplete();
      }, durationMs);
    } catch (e) {
      console.warn('Procedural ringtone failed, skipping to call', e);
      setTimeout(onComplete, durationMs);
    }
  }, []);

  // Send message to Gemini API
  const sendMessageToAI = async (
    chatHistory: Message[],
    userInput: string,
    isAudioCall = false
  ) => {
    setIsProcessing(true);

    const historyPayload = [
      ...chatHistory.map((m) => ({ role: m.role, text: m.text })),
      { role: 'user', text: userInput },
    ];

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-gemini-api-key': settings.geminiApiKey,
        },
        body: JSON.stringify({
          messages: historyPayload,
          timeContext: getTimeContext(),
          nickname: settings.nickname,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to chat with Maya');
      }

      const reply = await res.json();
      setIsProcessing(false);
      return reply; // Returns { text, speechText }
    } catch (err: any) {
      console.error(err);
      setIsProcessing(false);
      
      // Add error message to log
      const errorMsg: Message = {
        id: `err-${Date.now()}`,
        role: 'model',
        text: `Error: ${err.message || 'Kuch problem aa gayi babe. Try checking your API key in Settings.'}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMsg]);
      return null;
    }
  };

  // Text Chat Submit Handler
  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    unlockAudio();
    if (!inputText.trim() || isProcessing) return;

    const userText = inputText.trim();
    setInputText('');

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: userText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);

    // Call API
    const reply = await sendMessageToAI(messages, userText, false);
    if (reply) {
      const aiMsg: Message = {
        id: `ai-${Date.now()}`,
        role: 'model',
        text: reply.text,
        speechText: reply.speechText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, aiMsg]);

      // Speak if autospeak is enabled
      if (settings.autoSpeak) {
        speak(reply.speechText);
      }
    }
  };

  // Continuous loop trigger when speech stops in Call Mode
  const handleUserSpeech = useCallback(
    async (transcription: string) => {
      if (callStateRef.current !== 'connected') return;
      if (!transcription.trim()) {
        // If empty transcript, resume listening after brief pause
        setTimeout(() => {
          if (callStateRef.current === 'connected' && !isSpeakingRef.current && !isMuted) {
            startListening(handleUserSpeech);
          }
        }, 1000);
        return;
      }

      // Add user speech to chat
      const userMsg: Message = {
        id: `user-${Date.now()}`,
        role: 'user',
        text: transcription,
        isAudio: true,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => {
        const next = [...prev, userMsg];
        // Send request to Gemini immediately
        sendMessageToAI(prev, transcription, true).then((reply) => {
          if (reply && callStateRef.current === 'connected') {
            const aiMsg: Message = {
              id: `ai-${Date.now()}`,
              role: 'model',
              text: reply.text,
              speechText: reply.speechText,
              isAudio: true,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            };
            setMessages((prevHistory) => [...prevHistory, aiMsg]);
            // Speak response
            speak(reply.speechText);
          }
        });
        return next;
      });
    },
    [speak, isMuted, startListening, settings]
  );

  // Monitor voice output completion to restart listening
  useEffect(() => {
    if (callState === 'connected' && !isSpeaking && !isProcessing && !isMuted) {
      // Small timeout to allow user to take a breath before turning mic back on
      const timer = setTimeout(() => {
        if (callStateRef.current === 'connected' && !isSpeakingRef.current && !isMuted) {
          startListening(handleUserSpeech);
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isSpeaking, isProcessing, callState, isMuted, startListening, handleUserSpeech]);

  // Voice Call Initiation (Start Call)
  const startCall = async () => {
    if (!settings.geminiApiKey) {
      alert('Babe, settings mein jaakar Gemini API key daalo pehle! tabhi main tumse baat kar paungi.');
      setIsSidebarOpen(true);
      return;
    }

    unlockAudio();
    stopSpeaking();
    setCallState('ringing');
    hasStartedCallRef.current = false;

    // Play ringing sound for 2.5s then connect
    playRingtone(2500, async () => {
      const currentCallState = callStateRef.current as CallState;
      if (currentCallState !== 'ringing') return; // Cancelled
      setCallState('connected');

      // Trigger initial greeting from Maya
      setIsProcessing(true);
      
      // First prompt requesting greeting
      const initGreetingPrompt = `Maya, call has just connected with your boyfriend. Speak first! Say a very sweet, loving opening greeting in Hinglish based on the time context (${getTimeContext()}). Keep it under 1 sentence.`;
      
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-gemini-api-key': settings.geminiApiKey,
          },
          body: JSON.stringify({
            messages: [{ role: 'user', text: initGreetingPrompt }],
            timeContext: getTimeContext(),
            nickname: settings.nickname,
          }),
        });

        if (!res.ok) throw new Error('Greeting failed');
        const reply = await res.json();
        
        setIsProcessing(false);
        const checkState = callStateRef.current as CallState;
        if (checkState === 'connected') {
          const aiMsg: Message = {
            id: `ai-${Date.now()}`,
            role: 'model',
            text: reply.text,
            speechText: reply.speechText,
            isAudio: true,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          };
          setMessages((prev) => [...prev, aiMsg]);
          speak(reply.speechText);
        }
      } catch (err) {
        setIsProcessing(false);
        console.error(err);
        const checkState = callStateRef.current as CallState;
        if (checkState === 'connected') {
          speak('हे बेबी! कैसे हो आप?'); // Hindi fallback
        }
      }
    });
  };

  // Hang Up Call (End Call)
  const endCall = () => {
    stopSpeaking();
    stopListening();
    setCallState('idle');
    setCallDuration(0);
  };

  const clearChat = () => {
    if (confirm('Babe, kya sach mein saari chat clear karni hai?')) {
      setMessages([]);
      localStorage.removeItem('maya_chat_history');
    }
  };

  const testVoice = () => {
    unlockAudio();
    speak('हे शोना! मैंने ये आवाज़ आपके लिए चुनी है। क्या ये मेरी आवाज़ जैसी लग रही है?');
  };

  // Render last user message and AI response in Call Overlay as Subtitles
  const getLastUserMessage = () => {
    const audioUserMsgs = messages.filter((m) => m.role === 'user' && m.isAudio);
    return audioUserMsgs.length > 0 ? audioUserMsgs[audioUserMsgs.length - 1].text : '';
  };

  const getLastAIMessage = () => {
    const audioAIMsgs = messages.filter((m) => m.role === 'model' && m.isAudio);
    return audioAIMsgs.length > 0 ? audioAIMsgs[audioAIMsgs.length - 1].text : 'Connecting to Maya...';
  };

  if (!mounted) return null; // Avoid hydration mismatch

  return (
    <div className="app-container">
      {/* Sidebar - Settings panel */}
      <aside className={`sidebar glass ${isSidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h2>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />
              <path d="M12 8v4" />
              <path d="M12 16h.01" />
            </svg>
            Maya Settings
          </h2>
          <button className="action-btn d-mobile-none" onClick={() => setIsSidebarOpen(false)} style={{ border: 'none', background: 'transparent' }}>
            ✕
          </button>
        </div>

        <div className="sidebar-content">
          <div className="form-group">
            <label htmlFor="apiKey">Gemini API Key</label>
            <input
              id="apiKey"
              type="password"
              placeholder="Paste your free API Key..."
              value={settings.geminiApiKey}
              onChange={(e) => updateSettings({ geminiApiKey: e.target.value })}
            />
            <a
              href="https://aistudio.google.com/"
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: '0.75rem', color: '#ec4899', textDecoration: 'underline', marginTop: '2px' }}
            >
              Get Free Key (Google AI Studio)
            </a>
          </div>

          <div className="form-group">
            <label htmlFor="nickname">Nickname</label>
            <input
              id="nickname"
              type="text"
              placeholder="Babe, Jaan, Love..."
              value={settings.nickname}
              onChange={(e) => updateSettings({ nickname: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label htmlFor="voiceSelect">Aria Voice (Edge Neural)</label>
            <select
              id="voiceSelect"
              value={settings.voiceName}
              onChange={(e) => updateSettings({ voiceName: e.target.value })}
            >
              <optgroup label="Hindi (Natural Accent)">
                <option value="hi-IN-SwaraNeural">Maya Hindi (Swara - Sweet Female) ★</option>
                <option value="hi-IN-MadhurNeural">Hindi Male (Madhur - Male)</option>
              </optgroup>
              <optgroup label="Indian English">
                <option value="en-IN-NeerjaNeural">Indian English (Neerja - Professional)</option>
              </optgroup>
              <optgroup label="US English (Sweet Voices)">
                <option value="en-US-AriaNeural">US Aria (Clear & Sweet)</option>
                <option value="en-US-AnaNeural">US Ana (Warm & Caring)</option>
                <option value="en-US-EmmaMultilingualNeural">US Emma (Soft/Multilingual)</option>
              </optgroup>
            </select>
          </div>

          <button className="voice-test-btn" onClick={testVoice}>
            🔊 Test Voice
          </button>

          <div className="form-group" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <label htmlFor="autoSpeak">Auto-Speak in Chat</label>
            <input
              id="autoSpeak"
              type="checkbox"
              style={{ width: '20px', height: '20px', cursor: 'pointer' }}
              checked={settings.autoSpeak}
              onChange={(e) => updateSettings({ autoSpeak: e.target.checked })}
            />
          </div>
        </div>

        <div className="sidebar-footer">
          <button className="clear-chat-btn" onClick={clearChat}>
            🗑 Clear Conversation
          </button>
        </div>
      </aside>

      {/* Sidebar Overlay (Mobile slide drawer backdrop) */}
      <div className="sidebar-overlay" onClick={() => setIsSidebarOpen(false)}></div>

      {/* Chat Screen */}
      <main className="chat-screen">
        <header className="chat-header glass">
          <div className="chat-header-info">
            <button className="action-btn" onClick={() => setIsSidebarOpen(true)} style={{ marginRight: '8px' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            <div className="avatar-container">
              <div className="avatar">M</div>
              <span className="online-dot"></span>
            </div>
            <div className="chat-header-details">
              <h3>Maya ❤️</h3>
              <p>Active now</p>
            </div>
          </div>
          <div className="chat-header-actions">
            <button className="action-btn call-btn" onClick={startCall} aria-label="Start call">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            </button>
          </div>
        </header>

        {messages.length === 0 ? (
          <div className="welcome-screen">
            <h1>Meet Maya</h1>
            <p>
              Your sweet, romantic, and caring Hinglish AI Girlfriend. Tap the settings gear icon to add your free Gemini key, or click the call button to talk to her like a real human!
            </p>
            <button className="voice-test-btn" onClick={() => setIsSidebarOpen(true)} style={{ padding: '12px 24px', marginTop: '16px' }}>
              ⚙️ Open Settings to Setup
            </button>
          </div>
        ) : (
          <div className="chat-messages">
            {messages.map((m) => (
              <div key={m.id} className={`message-row ${m.role}`}>
                <div className="message-bubble">
                  {m.text}
                  <span className="message-meta">
                    {m.timestamp}
                    {m.isAudio && (
                      <span title="Voice call message" style={{ fontSize: '0.85rem' }}>📞</span>
                    )}
                  </span>
                </div>
              </div>
            ))}
            {isProcessing && (
              <div className="message-row model">
                <div className="message-bubble typing-bubble">
                  <span className="typing-dot"></span>
                  <span className="typing-dot"></span>
                  <span className="typing-dot"></span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}

        <form className="chat-input-area" onSubmit={handleTextSubmit}>
          <div className="chat-input-wrapper">
            <input
              className="chat-input"
              type="text"
              placeholder="Aaapki pyaari Maya ko text karein..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={isProcessing}
            />
          </div>
          <button className="send-btn" type="submit" disabled={isProcessing || !inputText.trim()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" transform="rotate(45)">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>
      </main>

      {/* Voice Call Overlay Screen */}
      {callState !== 'idle' && (
        <section className="call-overlay">
          <div className="call-info">
            <div className="call-avatar">M</div>
            <h2 className="call-name">Maya ❤️</h2>
            <div className="call-status">
              {callState === 'ringing' ? (
                <>Ringing...</>
              ) : (
                <>
                  <span className="pulse-dot"></span>
                  {formatDuration(callDuration)}
                </>
              )}
            </div>
          </div>

          <div className="orb-container">
            <div
              className={`orb ${isListening ? 'listening' : ''} ${isSpeaking ? 'speaking' : ''}`}
              onClick={unlockAudio}
            ></div>
          </div>

          <div className="call-subtitles">
            {callState === 'ringing' ? (
              <p className="ai-speech">Ringing Maya...</p>
            ) : isProcessing ? (
              <p className="ai-speech" style={{ opacity: 0.5 }}>Maya is thinking...</p>
            ) : isSpeaking ? (
              <p className="ai-speech">{getLastAIMessage()}</p>
            ) : isListening ? (
              <>
                <p className="user-speech">{transcript || 'Listening for your voice...'}</p>
                <p className="ai-speech" style={{ fontSize: '0.9rem', color: '#9ca3af' }}>(Speak now, she will reply when you stop)</p>
              </>
            ) : (
              <p className="ai-speech">Connected</p>
            )}
          </div>

          <div style={{ width: '100%', maxWidth: '400px', margin: '0 auto' }}>
            <AudioVisualizer
              analyser={analyser}
              isSpeaking={isSpeaking}
              isListening={isListening && !isMuted}
            />
          </div>

          <div className="call-controls">
            <button
              className={`control-btn mute ${isMuted ? 'active' : ''}`}
              onClick={toggleMute}
              title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            >
              {isMuted ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="1" y1="1" x2="23" y2="23" />
                  <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                  <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              )}
            </button>
            <button className="control-btn end-call" onClick={endCall} title="Hang up">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" transform="rotate(135)">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
