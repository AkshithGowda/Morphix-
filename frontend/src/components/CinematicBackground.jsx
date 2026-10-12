import React from 'react';

export default function CinematicBackground() {
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      zIndex: 0,
      overflow: 'hidden',
      pointerEvents: 'none',
      background: '#050508'
    }}>
      {/* Layer 0: The Void - Ambient Light Sweep */}
      <div className="ambient-light-sweep" />

      {/* Layer 1: The Grid Warp */}
      <div
        className="grid-warp"
        style={{
          transform: 'perspective(1000px) rotateX(60deg) translateY(calc(var(--mouse-y, 0) * -10px)) translateX(calc(var(--mouse-x, 0) * -10px))'
        }}
      />

      {/* Layer 2: Ghost Graphs & Energy */}
      <div style={{
        position: 'absolute',
        top: '20%',
        left: '-10%',
        width: '120%',
        height: '60%',
        opacity: 0.05,
        transform: 'translate(calc(var(--mouse-x, 0) * -20px), calc(var(--mouse-y, 0) * -20px))'
      }}>
        <svg width="100%" height="100%" viewBox="0 0 1000 300" preserveAspectRatio="none">
          <path
            d="M 0 150 Q 250 50, 500 150 T 1000 150"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="4"
            className="sine-path"
          />
        </svg>
      </div>

      {/* Layer 3: Equation Field */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        transform: 'translate(calc(var(--mouse-x, 0) * -40px), calc(var(--mouse-y, 0) * -40px))'
      }}>
        {['∑', 'π', '∫', '∞', 'e=mc²'].map((sym, i) => (
          <div
            key={i}
            className="sys-symbol"
            style={{
              top: `${20 + i * 15}%`,
              left: `${10 + (i % 2 === 0 ? i * 20 : 80 - i * 15)}%`,
              fontSize: `${2 + i * 0.5}rem`,
              animationDelay: `${i * 2}s`,
              filter: `blur(${i % 2 === 0 ? 2 : 1}px)`
            }}
          >
            {sym}
          </div>
        ))}
      </div>

      {/* Layer 4: Gold Particle Drift */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        transform: 'translate(calc(var(--mouse-x, 0) * -60px), calc(var(--mouse-y, 0) * -60px))'
      }}>
        {[...Array(10)].map((_, i) => (
          <div
            key={`particle-${i}`}
            className="gold-particle"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 5}s`,
              animationDuration: `${8 + Math.random() * 5}s`
            }}
          />
        ))}
      </div>
    </div>
  );
}
