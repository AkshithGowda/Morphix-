import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ReactFlow, MarkerType, Handle, Position } from '@xyflow/react';
import { Terminal, Box, Send, Video, FileCode2, ArrowDown, ChevronRight, Activity, TerminalSquare, Cpu, PlayCircle } from 'lucide-react';
import CinematicBackground from '../components/CinematicBackground';
import '@xyflow/react/dist/style.css';

const CustomNode = ({ data }) => {
  const isPast = data.status === 'past';
  const isActive = data.status === 'active';
  const isFuture = data.status === 'future';

  let nodeClass = 'glass-panel ';
  if (isActive) nodeClass += 'node-active';
  else if (isPast) nodeClass += 'node-past';
  else nodeClass += 'node-future';

  // Micro Visuals
  const renderMicroVisual = () => {
    if (data.id === '1') return <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>{[1, 2, 3, 4].map(i => <div key={i} style={{ width: '2px', height: '8px', background: 'var(--accent)', animation: isActive ? 'micro-wave 1s infinite' : 'none', animationDelay: `${i * 0.1}s` }} />)}</div>;
    if (data.id === '2') return <ChevronRight size={14} color="var(--accent)" style={{ animation: isActive ? 'micro-pulse 1s infinite' : 'none' }} />;
    if (data.id === '3') return <div style={{ color: 'var(--accent)', fontWeight: 800, fontSize: '10px', animation: isActive ? 'micro-pulse 1.5s infinite' : 'none' }}>{'{ }'}</div>;
    if (data.id === '4') return <div style={{ width: '10px', height: '10px', borderRadius: '50%', border: '2px solid transparent', borderTopColor: 'var(--accent)', animation: isActive ? 'micro-pulse 1s infinite' : 'none' }} />;
    if (data.id === '5') return <PlayCircle size={14} color="var(--accent)" style={{ animation: isActive ? 'micro-pulse 2s infinite' : 'none' }} />;
    return null;
  };

  return (
    <div style={{ position: 'relative' }}>
      {data.id === '5' && (
        <div style={{ position: 'absolute', top: '-60px', left: '50%', transform: 'translateX(-50%)', width: '100px', height: '50px', background: 'rgba(0,0,0,0.8)', border: '1px solid var(--accent)', borderRadius: '6px', opacity: isActive ? 1 : 0.2, transition: 'all 0.3s ease', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          <PlayCircle size={20} color="var(--accent)" />
          <div style={{ position: 'absolute', bottom: 0, width: '100%', height: '2px', background: 'var(--accent)', opacity: isActive ? 1 : 0 }} />
        </div>
      )}
      <div
        className={nodeClass}
        style={{
          padding: '20px',
          width: data.isFirst ? '280px' : data.isLast ? '300px' : '260px',
          height: data.isLast ? '160px' : '140px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          cursor: 'pointer',
          position: 'relative',
          overflow: 'hidden',
          transition: 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
      >
        <Handle type="target" position={Position.Left} style={{ background: isActive ? 'var(--accent)' : 'transparent', border: 'none' }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ padding: '8px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', color: data.color }}>
              <div className="">{data.icon}</div>
            </div>
            {renderMicroVisual()}
          </div>
          {isActive && <span style={{ fontSize: '10px', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600 }}>Active</span>}
        </div>

        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: data.isLast ? '1.4rem' : '1.2rem', color: 'var(--text-primary)', fontWeight: 600 }}>{data.label}</h3>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{data.sub}</p>
        </div>

        <Handle type="source" position={Position.Right} style={{ background: isActive ? 'var(--accent)' : 'transparent', border: 'none' }} />
      </div>
    </div>
  );
};


// ==========================================
// NEW EXECUTION COMPONENTS
// ==========================================

const LiveTerminal = () => {
  const [logs, setLogs] = useState([]);
  const fullLogs = [
    "[System] Initializing Morphix Pipeline v2.4...",
    "[System] Securing connection to Node.js backend...",
    "> node server.js started on http://127.0.0.1:3000",
    "[API] POST /api/jobs received prompt: 'Generate system logic'",
    "[Orchestrator] Assigned internal Job ID: mx_948f21",
    "[Agentic Layer] Validating payload and extracting parameters...",
    "[Agentic Layer] Parameters mapped. Passing to Python runtime.",
    "[Render Engine] Triggering buildVisualizationJob()...",
    "[Render Engine] Rendering frames... (0/120)",
    "[Render Engine] Rendering frames... (60/120)",
    "[Render Engine] Rendering complete. Exporting render_out.mp4",
    "[System] Pipeline execution successful. Payload delivered."
  ];

  const indexRef = React.useRef(0);

  useEffect(() => {
    indexRef.current = 0;
    setLogs([]);
    const interval = setInterval(() => {
      if (indexRef.current < fullLogs.length) {
        const line = fullLogs[indexRef.current];
        if (line !== undefined) {
          setLogs(prev => [...prev, line]);
        }
        indexRef.current++;
      } else {
        clearInterval(interval);
      }
    }, 800);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ padding: '24px', background: '#050505', borderRadius: '12px', border: '1px solid rgba(212, 175, 55, 0.2)', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', height: '240px', overflow: 'hidden', position: 'relative' }}>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f56' }} />
        <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ffbd2e' }} />
        <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#27c93f' }} />
      </div>
      <div className="code-font" style={{ color: '#22c55e', fontSize: '0.85rem', lineHeight: 1.8 }}>
        {logs.map((log, i) => (
          <div key={i} style={{ color: log.includes('Error') ? '#ff5f56' : log.includes('System') ? 'var(--text-secondary)' : '#22c55e' }}>
            {log}
          </div>
        ))}
        {logs.length < fullLogs.length && (
          <div><span className="blink-cursor" /></div>
        )}
      </div>
    </div>
  );
};

const SystemVisualizer = () => {
  return (
    <div style={{ height: '240px', background: '#0a0a0f', borderRadius: '12px', border: '1px solid rgba(212, 175, 55, 0.2)', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 20px 40px rgba(0,0,0,0.5)' }}>
      {/* Grid */}
      <div style={{ position: 'absolute', width: '100%', height: '100%', backgroundImage: 'linear-gradient(rgba(212, 175, 55, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(212, 175, 55, 0.1) 1px, transparent 1px)', backgroundSize: '20px 20px', backgroundPosition: 'center center' }} />
      {/* Axes */}
      <div style={{ position: 'absolute', width: '100%', height: '1px', background: 'rgba(212, 175, 55, 0.4)', top: '50%' }} />
      <div style={{ position: 'absolute', width: '1px', height: '100%', background: 'rgba(212, 175, 55, 0.4)', left: '50%' }} />

      {/* Animated Sine Wave SVG */}
      <svg width="100%" height="100%" viewBox="0 0 800 240" preserveAspectRatio="none" style={{ position: 'relative', zIndex: 10 }}>
        <path
          d="M 0 120 Q 100 20, 200 120 T 400 120 T 600 120 T 800 120"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="3"
          className="sine-path"
        />
        <path
          d="M 0 120 Q 100 220, 200 120 T 400 120 T 600 120 T 800 120"
          fill="none"
          stroke="rgba(245, 158, 11, 0.3)"
          strokeWidth="2"
        />
      </svg>
    </div>
  );
};

export default function Home() {
  const navigate = useNavigate();
  const nodeTypes = useMemo(() => ({ custom: CustomNode }), []);
  const [activeNode, setActiveNode] = useState(null);
  const [currentStage, setCurrentStage] = useState(0);

  useEffect(() => {
    const handleMouseMove = (e) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 2;
      const y = (e.clientY / window.innerHeight - 0.5) * 2;
      document.documentElement.style.setProperty('--mouse-x', x);
      document.documentElement.style.setProperty('--mouse-y', y);
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Live Pipeline Simulation
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentStage(prev => (prev + 1) % 5);
    }, 2000); // 2 seconds per stage
    return () => clearInterval(timer);
  }, []);

  const baseNodes = [
    { id: '1', label: 'Prompt Input', sub: 'Browser Web UI', icon: <Terminal size={28} />, color: 'var(--accent)', desc: 'Captures and sanitizes the natural language prompt from the user UI dashboard. Parameters are encoded.', json: '{\n  "prompt": "Generate system logic",\n  "timestamp": 1712493021\n}' },
    { id: '2', label: 'Dispatch', sub: 'Routing payload', icon: <Send size={28} />, color: 'var(--warning)', desc: 'Morphix routes the payload through server.js, generating a unique internal Job ID and passing constraints.', json: '{\n  "job_id": "job_948f219a",\n  "status": "dispatched"\n}' },
    { id: '3', label: 'Agentic layer', sub: 'Validation Layer', icon: <Box size={28} />, color: 'var(--accent)', desc: 'The agentic layer is a multistage layer which reads the prompt, validates it, and translates it into executable Python code.', json: '{\n  "agent": "Morphix",\n  "cpu": "89%",\n  "task": "rendering"\n}' },
    { id: '4', label: 'Fetch Artifacts', sub: 'Collecting outputs', icon: <FileCode2 size={28} />, color: 'var(--success)', desc: 'Upon render completion, Morphix captures the output artifacts, which include the MP4 video and trace codes.', json: '{\n  "status": "awaiting",\n  "bytes": 0\n}' },
    { id: '5', label: 'Publish Video', sub: 'DOM rendering', icon: <Video size={28} />, color: 'var(--accent)', desc: 'The fetched React-ready artifacts are securely transmitted via proxy and published onto your dashboard.', json: '{\n  "status": "pending",\n  "url": null\n}' }
  ];

  // Sync drawer card with the automatic stage progression
  useEffect(() => {
    setActiveNode(baseNodes[currentStage]);
  }, [currentStage]);

  const initNodes = baseNodes.map((node, index) => {
    let status = 'future';
    if (index === currentStage) status = 'active';
    else if (index < currentStage) status = 'past';

    return {
      id: node.id,
      type: 'custom',
      position: { x: index * 320, y: 50 },
      data: {
        ...node,
        status,
        isFirst: index === 0,
        isLast: index === baseNodes.length - 1
      }
    };
  });

  const initEdges = [
    { id: 'e1-2', source: '1', target: '2', type: 'smoothstep', animated: currentStage >= 0, className: currentStage >= 0 ? 'flow-energy-line' : '', style: { stroke: currentStage > 0 ? 'var(--accent)' : 'rgba(255,255,255,0.1)', strokeWidth: 2 } },
    { id: 'e2-3', source: '2', target: '3', type: 'smoothstep', animated: currentStage >= 1, className: currentStage >= 1 ? 'flow-energy-line' : '', style: { stroke: currentStage > 1 ? 'var(--accent)' : 'rgba(255,255,255,0.1)', strokeWidth: 2 } },
    { id: 'e3-4', source: '3', target: '4', type: 'smoothstep', animated: currentStage >= 2, className: currentStage >= 2 ? 'flow-energy-line' : '', style: { stroke: currentStage > 2 ? 'var(--accent)' : 'rgba(255,255,255,0.1)', strokeWidth: 2 } },
    { id: 'e4-5', source: '4', target: '5', type: 'smoothstep', animated: currentStage >= 3, className: currentStage >= 3 ? 'flow-energy-line' : '', style: { stroke: currentStage > 3 ? 'var(--accent)' : 'rgba(255,255,255,0.1)', strokeWidth: 2 } },
  ];

  const onNodeClick = (_, node) => {
    setActiveNode(node.data);
    setCurrentStage(parseInt(node.id) - 1);
  };

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
      <CinematicBackground />

      {/* 100VH CINEMATIC HERO SECTION */}
      <section style={{ height: '100vh', width: '100%', position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', perspective: '2000px' }}>

        {/* 3D Parallax Environment */}
        <div style={{
          position: 'absolute', top: '-10%', left: '-10%', width: '120%', height: '120%', zIndex: 1, pointerEvents: 'none',
          transform: 'rotateX(calc(var(--mouse-y, 0) * 15deg)) rotateY(calc(var(--mouse-x, 0) * -15deg))',
          transformStyle: 'preserve-3d', transition: 'transform 0.1s ease-out'
        }}>

          {/* Floating System Primitives */}
          <div style={{ position: 'absolute', top: '20%', left: '15%', fontSize: '120px', color: 'rgba(245, 158, 11, 0.4)', animation: 'antigravity-float 12s infinite ease-in-out', transform: 'translateZ(-100px)' }}>∑</div>
          <div style={{ position: 'absolute', top: '60%', right: '20%', fontSize: '180px', color: 'rgba(245, 158, 11, 0.2)', animation: 'antigravity-float-reverse 15s infinite ease-in-out', transform: 'translateZ(-200px)' }}>∫</div>
          <div style={{ position: 'absolute', top: '10%', right: '30%', fontSize: '90px', color: 'rgba(245, 158, 11, 0.6)', animation: 'antigravity-float 18s infinite ease-in-out', transform: 'translateZ(50px)', textShadow: '0 0 20px rgba(245, 158, 11, 0.5)' }}>π</div>
          <div style={{ position: 'absolute', bottom: '15%', left: '25%', fontSize: '140px', color: 'rgba(245, 158, 11, 0.3)', animation: 'antigravity-float-reverse 10s infinite ease-in-out', transform: 'translateZ(-50px)' }}>∞</div>

          {/* Golden Coordinate Grid (Floor) */}
          <div style={{
            position: 'absolute', bottom: '-20%', left: '0', width: '100%', height: '80%',
            backgroundImage: 'linear-gradient(rgba(245, 158, 11, 0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(245, 158, 11, 0.15) 1px, transparent 1px)',
            backgroundSize: '80px 80px', transform: 'rotateX(75deg) translateZ(-200px)', WebkitMaskImage: 'radial-gradient(ellipse at top, black 20%, transparent 70%)'
          }} />

          {/* 3D Wireframe Cube */}
          <div style={{ position: 'absolute', top: '30%', right: '10%', width: '150px', height: '150px', transformStyle: 'preserve-3d', animation: 'rotate-3d-x 20s linear infinite' }}>
            <div style={{ position: 'absolute', width: '100%', height: '100%', border: '2px solid rgba(245, 158, 11, 0.4)', transform: 'translateZ(75px)' }} />
            <div style={{ position: 'absolute', width: '100%', height: '100%', border: '2px solid rgba(245, 158, 11, 0.4)', transform: 'translateZ(-75px)' }} />
            <div style={{ position: 'absolute', width: '100%', height: '100%', border: '2px solid rgba(245, 158, 11, 0.4)', transform: 'rotateY(90deg) translateZ(75px)' }} />
            <div style={{ position: 'absolute', width: '100%', height: '100%', border: '2px solid rgba(245, 158, 11, 0.4)', transform: 'rotateY(90deg) translateZ(-75px)' }} />
            <div style={{ position: 'absolute', width: '100%', height: '100%', border: '2px solid rgba(245, 158, 11, 0.4)', transform: 'rotateX(90deg) translateZ(75px)' }} />
            <div style={{ position: 'absolute', width: '100%', height: '100%', border: '2px solid rgba(245, 158, 11, 0.4)', transform: 'rotateX(90deg) translateZ(-75px)' }} />
          </div>

          {/* Golden Particle Dust */}
          {[...Array(20)].map((_, i) => (
            <div key={`dust-${i}`} style={{
              position: 'absolute', width: '3px', height: '3px', background: '#f59e0b', borderRadius: '50%',
              top: `${Math.random() * 100}%`, left: `${Math.random() * 100}%`,
              boxShadow: '0 0 8px 2px rgba(245, 158, 11, 0.8)',
              animation: `particle-drift ${10 + Math.random() * 10}s infinite linear`,
              animationDelay: `${-Math.random() * 10}s`
            }} />
          ))}

        </div>

        <div className="glass-panel" style={{ zIndex: 2, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4rem', transform: 'translateZ(50px)', maxWidth: '900px' }}>
          <h1 className="metallic-text" style={{ fontSize: '100px', fontWeight: 800, margin: 0, letterSpacing: '-3px', lineHeight: 1 }}>Morphix</h1>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', margin: '20px 0 32px 0' }}>
            <div style={{ height: '1px', width: '60px', background: 'var(--accent)', opacity: 0.5 }} />
            <span style={{ fontSize: '13px', color: 'var(--accent)', fontWeight: 700, letterSpacing: '5px', textTransform: 'uppercase' }}>Visualization Engine</span>
            <div style={{ height: '1px', width: '60px', background: 'var(--accent)', opacity: 0.5 }} />
          </div>

          <p style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', maxWidth: '650px', margin: '0 0 48px 0', lineHeight: 1.6 }}>
            A high-performance command delivery shell bridging your browser with a localized agentic layer. Morphix autonomously translates natural language prompts into executable dynamic visualizations, orchestrating the rendering pipeline with cinematic precision.
          </p>

          <div style={{ display: 'flex', gap: '16px' }}>
            <button className="cinematic-button primary metallic-glow" onClick={() => window.scrollTo({ top: window.innerHeight, behavior: 'smooth' })}>Explore Flow</button>
            <button className="cinematic-button ghost" onClick={() => navigate('/model')}>Start Visualizing</button>
          </div>
        </div>

        <div style={{ position: 'absolute', bottom: '30px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', zIndex: 10 }}>
          <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '2px', color: 'var(--accent)' }}>Orbit Down</span>
          <ArrowDown size={14} color="var(--accent)" style={{ animation: 'bounce 2s infinite' }} />
        </div>
      </section>

      {/* GLOBAL UNIFIED PIPELINE WRAPPER */}
      <div
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          e.currentTarget.style.setProperty('--global-x', `${e.clientX - rect.left}px`);
          e.currentTarget.style.setProperty('--global-y', `${e.clientY - rect.top}px`);
        }}
        style={{ position: 'relative', width: '100%', zIndex: 1 }}
      >


        {/* PIPELINE SECTION */}
        <section style={{ width: '100%', minHeight: '600px', padding: '100px 40px', background: 'rgba(10, 10, 15, 0.6)', backdropFilter: 'blur(4px)', borderTop: '1px solid rgba(255,255,255,0.05)', position: 'relative', zIndex: 10, overflow: 'hidden' }}>

          {/* Deep Parallax Grid & Particles */}
          <div style={{ position: 'absolute', width: '120%', height: '120%', top: '-10%', left: '-10%', transform: 'translate(calc(var(--mouse-x, 0) * -15px), calc(var(--mouse-y, 0) * -15px))', pointerEvents: 'none', zIndex: 0 }}>
            <div style={{ position: 'absolute', width: '100%', height: '100%', opacity: 0.05, backgroundImage: 'linear-gradient(rgba(245, 158, 11, 0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(245, 158, 11, 0.4) 1px, transparent 1px)', backgroundSize: '40px 40px', backgroundPosition: 'center center' }} />
          </div>

          <div style={{ maxWidth: '1600px', margin: '0 auto', position: 'relative', zIndex: 1 }}>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '40px' }}>
              <div style={{ width: 6, height: 24, background: 'var(--accent)', borderRadius: '2px' }} />
              <h2 style={{ fontSize: '1.8rem', fontWeight: 600, margin: 0, letterSpacing: '-0.02em' }}>Morphix Architecture Flow</h2>
            </div>

            <div style={{ height: '400px', width: '100%', marginBottom: activeNode ? '24px' : '0', transition: 'all 0.3s ease' }}>
              <ReactFlow
                nodes={initNodes}
                edges={initEdges}
                nodeTypes={nodeTypes}
                onNodeClick={onNodeClick}

                fitView
                fitViewOptions={{ padding: 0.1, minZoom: 0.8, maxZoom: 1.1 }}
                minZoom={0.8}
                maxZoom={1.1}
                panOnScroll={false}
                zoomOnScroll={false}
                panOnDrag={false}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={true}
                zoomOnPinch={false}
                zoomOnDoubleClick={false}
                attributionPosition="bottom-right"
              />
            </div>

            {/* Global Expandable Drawer */}
            <div style={{
              height: activeNode ? '180px' : '0px',
              opacity: activeNode ? 1 : 0,
              overflow: 'hidden',
              transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
              background: 'var(--panel-bg)',
              border: activeNode ? '1px solid rgba(255,255,255,0.08)' : 'none',
              borderRadius: '16px',
              display: 'flex'
            }}>
              {activeNode && (
                <div style={{ display: 'flex', width: '100%', padding: '24px', gap: '40px' }}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <h4 style={{ color: activeNode.color, margin: 0, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {activeNode.icon} {activeNode.label} Analysis
                    </h4>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.6, margin: 0 }}>
                      {activeNode.desc}
                    </p>
                  </div>

                  <div style={{ flex: 1, background: '#0a0a0f', borderRadius: '8px', padding: '16px', border: '1px solid rgba(255,255,255,0.03)' }}>
                    <span style={{ fontSize: '10px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px', display: 'block' }}>Payload Structure</span>
                    <pre className="code-font" style={{ color: 'var(--success)', fontSize: '13px', margin: 0, whiteSpace: 'pre-wrap' }}>
                      {activeNode.json}
                    </pre>
                  </div>

                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <span style={{ fontSize: '10px', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '2px', fontWeight: 700 }}>System Metrics</span>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Throughput</span>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontFamily: 'monospace' }}>
                        {activeNode.id === '1' ? '2.4 req/s' : activeNode.id === '2' ? '1.8 req/s' : activeNode.id === '3' ? '0.9 req/s' : activeNode.id === '4' ? '1.2 req/s' : '3.1 req/s'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Latency</span>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontFamily: 'monospace' }}>
                        {activeNode.id === '1' ? '42ms' : activeNode.id === '2' ? '78ms' : activeNode.id === '3' ? '320ms' : activeNode.id === '4' ? '190ms' : '55ms'}
                      </span>
                    </div>
                    <div style={{ width: '100%', height: '3px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ width: activeNode.id === '3' ? '72%' : activeNode.id === '4' ? '48%' : '20%', height: '100%', background: 'var(--accent)', borderRadius: '2px', transition: 'width 0.6s ease' }} />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Status</span>
                      <span style={{ color: '#27c93f', fontWeight: 600 }}>● Healthy</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

          </div>
        </section>


        {/* UNIFIED EXECUTION ENVIRONMENT */}
        <section style={{ width: '100%', padding: '120px 10%', background: 'rgba(5, 5, 8, 0.6)', backdropFilter: 'blur(12px)', position: 'relative', zIndex: 10, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          {/* Subtle Grid Background */}
          <div style={{ position: 'absolute', width: '100%', height: '100%', top: 0, left: 0, opacity: 0.03, backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.5) 1px, transparent 1px)', backgroundSize: '40px 40px', zIndex: 0 }} />

          <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', gap: '80px', position: 'relative', zIndex: 1 }}>

            {/* LEFT COLUMN: NARRATIVE */}
            <div style={{ flex: '1', display: 'flex', flexDirection: 'column', gap: '60px' }}>
              <div>
                <h2 style={{ fontSize: '2.5rem', fontWeight: 600, letterSpacing: '-0.02em', margin: '0 0 24px', color: 'white' }}>Engine Execution</h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', lineHeight: 1.7 }}>
                  Watch Morphix seamlessly orchestrate complex computational generation. From parsing the initial web payload via Node.js to delegating computation to the local Python engine.
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>
                <div>
                  <span style={{ fontSize: '10px', color: 'var(--accent)', letterSpacing: '2px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '12px', display: 'block' }}>EXECUTION</span>
                  <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.95rem', lineHeight: 1.6 }}>The Node.js Orchestrator intercepts payloads, assigns asynchronous Job IDs, and triggers the Python subprocess.</p>
                </div>
                <div>
                  <span style={{ fontSize: '10px', color: 'var(--accent)', letterSpacing: '2px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '12px', display: 'block' }}>VISUALIZATION</span>
                  <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.95rem', lineHeight: 1.6 }}>Visualization libraries receive the DSL and execute vector-based computations, rendering precise frame-by-frame animations.</p>
                </div>
                <div>
                  <span style={{ fontSize: '10px', color: 'var(--accent)', letterSpacing: '2px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '12px', display: 'block' }}>OUTPUT</span>
                  <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.95rem', lineHeight: 1.6 }}>Completed render artifacts are immediately captured and streamed back to the browser shell via proxy.</p>
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: LIVE SYSTEM PANEL */}
            <div style={{ flex: '1.2', position: 'relative', display: 'flex', flexDirection: 'column', gap: '40px' }}>

              {/* Vertical Glowing Connector Line */}
              <div className="vertical-connector">
                <div className="vertical-pulse" />
              </div>

              {/* Step 1: Terminal */}
              <div style={{ paddingLeft: '60px', position: 'relative' }}>
                <div style={{ position: 'absolute', left: '33px', top: '50%', width: '27px', height: '2px', background: 'rgba(255,255,255,0.05)' }} />
                <div style={{ position: 'absolute', left: '33px', top: '50%', transform: 'translate(-50%, -50%)', width: '12px', height: '12px', borderRadius: '50%', border: '2px solid var(--accent)', background: '#050505', zIndex: 2 }} />
                <LiveTerminal />
              </div>

              {/* Step 2: System Visualizer */}
              <div style={{ paddingLeft: '60px', position: 'relative' }}>
                <div style={{ position: 'absolute', left: '33px', top: '50%', width: '27px', height: '2px', background: 'rgba(255,255,255,0.05)' }} />
                <div style={{ position: 'absolute', left: '33px', top: '50%', transform: 'translate(-50%, -50%)', width: '12px', height: '12px', borderRadius: '50%', border: '2px solid var(--accent)', background: '#050505', zIndex: 2 }} />
                <SystemVisualizer />
              </div>

              {/* Step 3: Output Showcase */}
              <div style={{ paddingLeft: '60px', position: 'relative' }}>
                <div style={{ position: 'absolute', left: '33px', top: '50%', width: '27px', height: '2px', background: 'rgba(255,255,255,0.05)' }} />
                <div style={{ position: 'absolute', left: '33px', top: '50%', transform: 'translate(-50%, -50%)', width: '12px', height: '12px', borderRadius: '50%', border: '2px solid var(--accent)', background: '#050505', zIndex: 2 }} />

                <div className="glass-panel" style={{ padding: '24px', borderRadius: '12px', border: '1px solid rgba(212, 175, 55, 0.3)', display: 'flex', flexDirection: 'column', gap: '16px', position: 'relative', overflow: 'hidden', transition: 'all 0.3s ease', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <Video color="var(--accent)" size={20} />
                      <span style={{ fontWeight: 600, color: 'white' }}>render_out.mp4</span>
                    </div>
                    <span style={{ fontSize: '0.8rem', color: 'var(--success)', background: 'rgba(34, 197, 94, 0.1)', padding: '4px 12px', borderRadius: '12px' }}>Rendered in 1.4s</span>
                  </div>

                  <div style={{ height: '140px', background: '#050505', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                    <div style={{ position: 'absolute', width: '100%', height: '100%', backgroundImage: 'radial-gradient(circle, rgba(245, 158, 11, 0.2) 0%, transparent 70%)', opacity: 0.5 }} />
                    <PlayCircle size={48} color="rgba(255,255,255,0.8)" style={{ zIndex: 2 }} />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: 'rgba(0,0,0,0.5)', borderRadius: '8px' }}>
                    <FileCode2 size={16} color="var(--text-secondary)" />
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>source.py • 4.1 KB</span>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </section>

      </div>{/* Close Global Wrapper */}

      {/* FOOTER */}
      <footer style={{ width: '100%', padding: '40px', textAlign: 'center', background: '#050505', borderTop: '1px solid rgba(255,255,255,0.05)', color: 'var(--text-secondary)', fontSize: '0.85rem', letterSpacing: '1px', position: 'relative', zIndex: 20 }}>
        MorphixBridge © 2025 | WSL Pipeline Engine
      </footer>

    </div>
  );
}
