import React, { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  analyser: AnalyserNode | null;
  isSpeaking: boolean;
  isListening: boolean;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  analyser,
  isSpeaking,
  isListening,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number>(0);
  const phaseRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high DPI screens
    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const bufferLength = analyser ? analyser.frequencyBinCount : 0;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      
      const width = canvas.width / window.devicePixelRatio;
      const height = canvas.height / window.devicePixelRatio;
      
      ctx.clearRect(0, 0, width, height);

      // Variables to adjust wave shapes
      let amplitude = 15;
      let frequency = 0.015;
      
      if (isSpeaking && analyser) {
        analyser.getByteFrequencyData(dataArray);
        // Calculate average volume
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        
        // Dynamically scale wave based on voice volume
        amplitude = 10 + (average / 255) * 60;
        frequency = 0.01 + (average / 255) * 0.02;
      } else if (isListening) {
        amplitude = 25;
        frequency = 0.02;
      } else {
        // Idle breathing wave
        amplitude = 8;
        frequency = 0.01;
      }

      phaseRef.current += isSpeaking ? 0.15 : 0.06;

      // Draw 3 layers of glowing overlapping sine waves
      const drawWave = (
        color: string,
        opacity: number,
        offset: number,
        freqMultiplier: number,
        ampMultiplier: number,
        lineWidth: number
      ) => {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.globalAlpha = opacity;
        ctx.lineWidth = lineWidth;
        
        // Create shadow glow
        ctx.shadowBlur = 15;
        ctx.shadowColor = color;

        for (let x = 0; x < width; x++) {
          // Add sine wave equation with shifting phase
          const y =
            height / 2 +
            Math.sin(x * frequency * freqMultiplier + phaseRef.current + offset) *
              amplitude *
              ampMultiplier *
              Math.sin((x / width) * Math.PI); // Pin the ends to 0 (tapered edges)
          
          if (x === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      };

      // Layer 1: Deep Violet/Blue (Background)
      drawWave('#8b5cf6', 0.25, 0, 0.8, 0.7, 2);

      // Layer 2: Glowing Pink/Magenta (Accent)
      drawWave('#ec4899', 0.4, Math.PI / 3, 1.2, 1.1, 2.5);

      // Layer 3: Neon Cyan/Blue (Foreground)
      drawWave('#3b82f6', 0.6, (2 * Math.PI) / 3, 1.0, 0.8, 3);
      
      // Reset shadows
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1.0;
    };

    draw();

    return () => {
      cancelAnimationFrame(animationRef.current);
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [analyser, isSpeaking, isListening]);

  return (
    <div style={{ width: '100%', height: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          maxHeight: '120px',
        }}
      />
    </div>
  );
};
