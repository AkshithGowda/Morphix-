import React, { useRef, useEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const panels = [
  { id: 1, title: 'Parsing Engine', desc: 'Raw math syntax analysis and tokenization.', tag: 'PARSE' },
  { id: 2, title: 'AST Translator', desc: 'Converting abstract logic trees to executable Python.', tag: 'XLATE' },
  { id: 3, title: 'Manim GL', desc: 'Hardware-accelerated vector rendering pipeline.', tag: 'RENDER' },
  { id: 4, title: 'Pipeline Output', desc: 'Binary artifact extraction and delivery.', tag: 'EXPORT' },
];

export default function HorizontalScroll() {
  const containerRef = useRef(null);
  const scrollRef = useRef(null);
  const panelsRef = useRef([]);

  useEffect(() => {
    const container = containerRef.current;
    const scroll = scrollRef.current;
    if (!container || !scroll) return;

    let ctx = gsap.context(() => {
      const totalScroll = scroll.scrollWidth - container.offsetWidth;

      const scrollTween = gsap.to(scroll, {
        x: () => -totalScroll,
        ease: 'none',
        scrollTrigger: {
          trigger: container,
          pin: true,
          scrub: 0.8,
          start: 'top top',
          end: () => '+=' + totalScroll,
          invalidateOnRefresh: true,
        },
      });

      panelsRef.current.forEach((panel) => {
        if (!panel) return;

        gsap.fromTo(
          panel,
          { opacity: 0.3, scale: 0.92 },
          {
            opacity: 1,
            scale: 1,
            ease: 'none',
            scrollTrigger: {
              trigger: panel,
              containerAnimation: scrollTween,
              start: 'left 75%',
              end: 'left 50%',
              scrub: true,
            },
          }
        );

        gsap.fromTo(
          panel,
          { opacity: 1, scale: 1 },
          {
            opacity: 0.3,
            scale: 0.92,
            ease: 'none',
            scrollTrigger: {
              trigger: panel,
              containerAnimation: scrollTween,
              start: 'left 50%',
              end: 'left 25%',
              scrub: true,
            },
          }
        );
      });
    }, container);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={containerRef} style={{ width: '100%', height: '100vh', overflow: 'hidden', position: 'relative' }}>

      {/* Section label */}
      <div className="mono-text" style={{
        position: 'absolute', top: '40px', left: '5%', zIndex: 20,
        fontSize: '11px', color: 'var(--accent-neon)', display: 'flex', alignItems: 'center', gap: '12px'
      }}>
        <div style={{ width: 8, height: 8, background: 'var(--accent-neon)', boxShadow: '0 0 6px var(--accent-neon)' }} />
        PIPELINE ARCHITECTURE — SCROLL →
      </div>

      <div
        ref={scrollRef}
        style={{
          display: 'flex',
          height: '100%',
          alignItems: 'center',
          gap: '60px',
          paddingLeft: '15vw',
          paddingRight: '40vw',
          width: 'fit-content',
        }}
      >
        {panels.map((panel, i) => (
          <div
            key={panel.id}
            ref={(el) => (panelsRef.current[i] = el)}
            style={{
              width: '500px',
              minWidth: '500px',
              height: '340px',
              border: '1px solid var(--border-color)',
              background: 'rgba(0, 255, 65, 0.03)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              padding: '40px',
              position: 'relative',
              transition: 'border-color 0.3s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent-neon)';
              e.currentTarget.style.boxShadow = '0 0 30px rgba(0,255,65,0.15)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-color)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            {/* Phase number */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <span style={{ fontSize: '5rem', fontWeight: 900, color: 'rgba(0,255,65,0.08)', lineHeight: 1, letterSpacing: '-0.05em' }}>
                0{panel.id}
              </span>
              <span className="mono-text" style={{
                fontSize: '10px', color: 'var(--accent-neon)',
                border: '1px solid var(--border-color)', padding: '4px 10px'
              }}>
                {panel.tag}
              </span>
            </div>

            <div>
              <h3 style={{ fontSize: '1.8rem', fontWeight: 900, margin: '0 0 12px 0', textTransform: 'uppercase', letterSpacing: '-0.03em' }}>
                {panel.title}
              </h3>
              <p className="mono-text" style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
                {panel.desc}
              </p>
            </div>

            {/* Progress bar */}
            <div style={{ width: '100%', height: '2px', background: 'var(--border-color)', marginTop: '16px' }}>
              <div style={{
                width: `${25 * panel.id}%`,
                height: '100%',
                background: 'var(--accent-neon)',
                boxShadow: '0 0 8px var(--accent-neon)',
                transition: 'width 0.6s ease'
              }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
