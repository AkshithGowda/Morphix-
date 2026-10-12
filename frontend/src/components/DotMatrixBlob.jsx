import React, { useRef, useEffect, useCallback } from 'react';

const COLS = 60;
const ROWS = 40;
const DOT_SPACING = 14;
const BASE_DOT_SIZE = 2;
const MAX_DOT_SIZE = 7;
const INFLUENCE_RADIUS = 150;
const DEPTH_SCALE = 40;

export default function DotMatrixBlob({ style }) {
  const canvasRef = useRef(null);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const rafRef = useRef(null);
  const timeRef = useRef(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const cw = rect.width;
    const ch = rect.height;

    ctx.clearRect(0, 0, cw, ch);

    const offsetX = (cw - (COLS - 1) * DOT_SPACING) / 2;
    const offsetY = (ch - (ROWS - 1) * DOT_SPACING) / 2;

    const mx = mouseRef.current.x;
    const my = mouseRef.current.y;
    const time = timeRef.current;

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const baseX = offsetX + col * DOT_SPACING;
        const baseY = offsetY + row * DOT_SPACING;

        // Organic wave displacement (creates the "living" 3D surface)
        const wave1 = Math.sin(col * 0.15 + time * 0.8) * Math.cos(row * 0.12 + time * 0.6) * DEPTH_SCALE * 0.4;
        const wave2 = Math.sin((col + row) * 0.08 + time * 1.2) * DEPTH_SCALE * 0.25;
        const wave3 = Math.cos(col * 0.2 - time * 0.5) * Math.sin(row * 0.18 + time * 0.9) * DEPTH_SCALE * 0.3;

        let px = baseX + wave1 * 0.3;
        let py = baseY + wave2 * 0.3;
        const depth = (wave1 + wave2 + wave3);

        // Mouse interaction — repel dots outward from cursor
        const dx = px - mx;
        const dy = py - my;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < INFLUENCE_RADIUS && dist > 0) {
          const force = (1 - dist / INFLUENCE_RADIUS);
          const pushStrength = force * force * 30;
          px += (dx / dist) * pushStrength;
          py += (dy / dist) * pushStrength;
        }

        // Map depth to dot size and brightness (3D illusion)
        const depthNorm = (depth + DEPTH_SCALE) / (DEPTH_SCALE * 2);
        const dotSize = BASE_DOT_SIZE + depthNorm * (MAX_DOT_SIZE - BASE_DOT_SIZE);

        // Mouse proximity glow
        let brightness = 0.15 + depthNorm * 0.45;
        let green = 0;

        if (dist < INFLUENCE_RADIUS) {
          const glow = (1 - dist / INFLUENCE_RADIUS);
          brightness = Math.min(1, brightness + glow * 0.6);
          green = glow;
        }

        // Color: white dots with neon green near cursor
        const r = Math.floor(brightness * 255);
        const g = Math.floor((brightness + green * 0.8) * 255);
        const b = Math.floor(brightness * (1 - green * 0.6) * 255);

        ctx.fillStyle = `rgb(${Math.min(255, r)},${Math.min(255, g)},${Math.min(255, b)})`;
        ctx.fillRect(
          Math.round(px - dotSize / 2),
          Math.round(py - dotSize / 2),
          Math.round(dotSize),
          Math.round(dotSize)
        );
      }
    }

    timeRef.current += 0.016;
    rafRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    };

    const handleMouseLeave = () => {
      mouseRef.current = { x: -9999, y: -9999 };
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        cursor: 'crosshair',
        ...style,
      }}
    />
  );
}
