import React, { useEffect, useRef, useState } from 'react';

const WaveformVisualizer = ({ audioContext, analyser, isRecording }) => {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const [energy, setEnergy] = useState(0);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight || 120;
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
    };
  }, []);

  useEffect(() => {
    if (!analyser || !canvasRef.current || !isRecording) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      setEnergy(0);
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const timeDataArray = new Uint8Array(analyser.fftSize);

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);

      analyser.getByteFrequencyData(dataArray);
      analyser.getByteTimeDomainData(timeDataArray);

      const avgEnergy = dataArray.reduce((a, b) => a + b, 0) / bufferLength / 255;
      setEnergy(avgEnergy);

      const { width, height } = canvas;
      ctx.fillStyle = 'rgba(255, 250, 245, 0.2)';
      ctx.fillRect(0, 0, width, height);

      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, 'rgba(139, 69, 19, 0.8)');
      gradient.addColorStop(0.5, 'rgba(160, 82, 45, 0.9)');
      gradient.addColorStop(1, 'rgba(139, 69, 19, 0.8)');

      ctx.lineWidth = 2;
      ctx.strokeStyle = gradient;
      ctx.beginPath();

      const sliceWidth = width / timeDataArray.length;
      let x = 0;

      for (let i = 0; i < timeDataArray.length; i++) {
        const v = timeDataArray[i] / 128.0;
        const y = (v * height) / 2;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }

        x += sliceWidth;
      }

      ctx.stroke();

      const barCount = 32;
      const barWidth = width / barCount - 2;
      
      for (let i = 0; i < barCount; i++) {
        const dataIndex = Math.floor(i * bufferLength / barCount);
        const barHeight = (dataArray[dataIndex] / 255) * height * 0.8;
        
        const barGradient = ctx.createLinearGradient(0, height, 0, height - barHeight);
        barGradient.addColorStop(0, 'rgba(139, 69, 19, 0.3)');
        barGradient.addColorStop(1, 'rgba(160, 82, 45, 0.6)');
        
        ctx.fillStyle = barGradient;
        ctx.fillRect(
          i * (barWidth + 2),
          height - barHeight,
          barWidth,
          barHeight
        );
      }
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [analyser, isRecording]);

  return (
    <div className="w-full bg-gradient-to-r from-orange-50 to-amber-50 rounded-lg shadow-inner p-4">
      <div className="relative w-full h-32">
        <canvas
          ref={canvasRef}
          className="w-full h-full rounded-md"
        />
        {isRecording && (
          <div className="absolute top-2 right-2 flex items-center gap-2">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <span className="text-xs font-medium text-gray-700">录音中</span>
          </div>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-full bg-gray-200 rounded-full h-1.5 max-w-xs">
            <div
              className="bg-gradient-to-r from-orange-400 to-amber-500 h-1.5 rounded-full transition-all duration-150"
              style={{ width: `${energy * 100}%` }}
            />
          </div>
        </div>
        <span className="text-xs text-gray-500 font-mono">
          {(energy * 100).toFixed(1)}%
        </span>
      </div>
    </div>
  );
};

export default WaveformVisualizer;