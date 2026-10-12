import React, { useState, useEffect, useRef } from 'react';
import { Play, Terminal, Code2, AlertCircle, CheckCircle2, Clock, ChevronRight, FileText, ExternalLink } from 'lucide-react';

const defaultStages = [
  { id: "prompt", label: "Understanding prompt", status: "pending", details: "Awaiting a Prompt analyzer Agent." },
  { id: "dispatch", label: "Refining prompt intent", status: "pending", details: "Agent has not been invoked yet." },
  { id: "agent", label: "Generating system scene", status: "pending", details: "The WSL agent has not started rendering yet." },
  { id: "fetch", label: "Validating scene against prompt", status: "pending", details: "No WSL render artifacts have been collected yet." },
  { id: "renderer", label: "Rendering preview artifact", status: "pending", details: "No rendered website video has been published yet." },
];

function getArtifactProgress(activityLogs, result, paperEnabled, isSubmitting, jobState) {
  const messages = Array.isArray(activityLogs)
    ? activityLogs.map((entry) => String(entry?.message || "").toLowerCase())
    : [];
  const hasLog = (...needles) => messages.some((message) => (
    needles.some((needle) => message.includes(needle))
  ));
  const hasWrittenFile = (filename) => messages.some((message) => (
    message.startsWith("write ") && message.includes(filename)
  ));

  const videoPublished = Boolean(result?.renderManifest?.videoAsset)
    || hasLog("copied final render", "published to the website", "render published");
  const paperRequired = paperEnabled || Boolean(result?.renderManifest?.paperAsset);
  const paperPublished = Boolean(result?.renderManifest?.paperAsset)
    || hasLog("copied companion paper");
  const allRequiredPublished = videoPublished && (!paperRequired || paperPublished);

  if (allRequiredPublished) {
    return {
      value: 100,
      label: "Artifacts published",
    };
  }

  if (hasWrittenFile("final.mp4") || hasLog("candidate final video", "final render is stable")) {
    return {
      value: 70,
      label: paperRequired ? "Publishing topic paper and video" : "Rendering final video",
    };
  }

  if (hasLog("scene.py")) {
    return {
      value: 50,
      label: "Writing Manim scene",
    };
  }

  if (hasLog("plan.md")) {
    return {
      value: 30,
      label: "Planning animation",
    };
  }

  if (
    isSubmitting
    || jobState === "queued"
    || jobState === "running"
    || hasLog("gateway accepted", "monitoring the wsl output", "prepared gateway payload")
  ) {
    return {
      value: 10,
      label: "Initializing generation",
    };
  }

  return {
    value: 0,
    label: "Awaiting prompt",
  };
}

export default function Model() {
  const [prompt, setPrompt] = useState("");
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [paperEnabled, setPaperEnabled] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [lastPrompt, setLastPrompt] = useState("");
  const [textareaFocused, setTextareaFocused] = useState(false);
  const [activeTab, setActiveTab] = useState('video');

  const [jobId, setJobId] = useState(null);
  const [jobState, setJobState] = useState(null);
  const [stages, setStages] = useState(defaultStages);
  const [result, setResult] = useState(null);
  const [activityLogs, setActivityLogs] = useState([]);
  const [pastRenders, setPastRenders] = useState([]);

  const sampleChips = [
    'Animate a sine wave with phase shift',
    '3D cube rotation with lighting',
    'Vector field visualization',
    'Binary tree traversal',
  ];

  const systemStatus = isSubmitting
    ? (jobState === 'running' ? '● Processing' : jobState === 'queued' ? '● Queued' : '● Starting')
    : result
    ? '● Complete'
    : '● System Ready';
  const statusColor = isSubmitting ? '#ffbd2e' : result ? '#27c93f' : 'rgba(212,175,55,0.7)';

  const pollTimerRef = useRef(null);
  const terminalRef = useRef(null);
  const startTimeRef = useRef(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [completionGlow, setCompletionGlow] = useState(false);
  const [btnBurst, setBtnBurst] = useState(false);

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => stopPolling();
  }, []);

  // Elapsed time counter while submitting
  useEffect(() => {
    let timer;
    if (isSubmitting) {
      startTimeRef.current = Date.now();
      timer = setInterval(() => {
        setElapsedTime(((Date.now() - startTimeRef.current) / 1000).toFixed(1));
      }, 100);
    } else {
      setElapsedTime(0);
    }
    return () => clearInterval(timer);
  }, [isSubmitting]);

  // Completion glow — fire when all stages complete
  useEffect(() => {
    const allDone = stages.length > 0 && stages.every(s => s.status === 'completed');
    if (allDone && !isSubmitting) {
      setCompletionGlow(true);
      setTimeout(() => setCompletionGlow(false), 2000);
    }
  }, [stages, isSubmitting]);

  useEffect(() => {
    if (!terminalRef.current) {
      return;
    }
    terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [activityLogs]);

  const fetchJob = async (id) => {
    const res = await fetch(`/api/jobs/${id}`);
    if (!res.ok) throw new Error("Unable to retrieve job status.");
    return res.json();
  };

  const fetchPastRenders = async () => {
    try {
      const res = await fetch('/api/renders');
      if (!res.ok) return;
      const payload = await res.json();
      setPastRenders(Array.isArray(payload.renders) ? payload.renders : []);
    } catch (err) {
      // Past renders are helpful but non-critical, so keep generation flow quiet.
    }
  };

  useEffect(() => {
    fetchPastRenders();
  }, []);

  const pollJob = async (id) => {
    try {
      const job = await fetchJob(id);
      setJobState(job.status);
      setStages(job.stages && job.stages.length > 0 ? job.stages : defaultStages);
      setActivityLogs(Array.isArray(job.logs) ? job.logs : []);

      if (job.result) setResult(job.result);

      if (job.status === "queued" || job.status === "running") {
        pollTimerRef.current = setTimeout(() => pollJob(id), 900);
      } else {
        setIsSubmitting(false);
        fetchPastRenders();
      }
    } catch (err) {
      setError(err.message);
      setIsSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!jobId) return;
    try {
      setIsSubmitting(true);
      const res = await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST" });
      const job = await res.json();
      stopPolling();
      setStages(job.stages || defaultStages);
      setJobState(job.status);
      setActivityLogs(Array.isArray(job.logs) ? job.logs : []);
      setIsSubmitting(false);
    } catch (err) {
      setError(err.message);
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!prompt.trim()) return;
    
    setLastPrompt(prompt.trim());

    setError(null);
    setJobId(null);
    setResult(null);
    setJobState(null);
    setStages(defaultStages);
    setActivityLogs([]);
    setIsSubmitting(true);
    setCompletionGlow(false);
    setBtnBurst(true);
    setTimeout(() => setBtnBurst(false), 600);
    stopPolling();

    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), ttsEnabled, paperEnabled })
      });

      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Unable to create Morphix job.");

      setJobId(payload.jobId);
      pollJob(payload.jobId);
    } catch (err) {
      setError(err.message);
      setIsSubmitting(false);
    }
  };

  const getCompletedCount = () => stages.filter(s => s.status === 'completed').length;
  const activeStageId = stages.find((stage) => stage.status === 'running')?.id || stages.find((stage) => stage.status === 'failed')?.id;
  const artifactProgress = getArtifactProgress(activityLogs, result, paperEnabled, isSubmitting, jobState);
  const generationProgress = artifactProgress.value;
  const progressLabel = artifactProgress.label;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-color)', paddingBottom: '3rem', position: 'relative', overflow: 'hidden', perspective: '1200px' }}>
      
      {/* Processing Core — Reactive Brain */}
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '100vw', height: '100vh', zIndex: 0, pointerEvents: 'none', overflow: 'hidden', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        {/* Outer rings — speed up when running */}
        <div style={{ width: '800px', height: '800px', border: '1px solid rgba(212, 175, 55, 0.12)', borderRadius: '50%', position: 'absolute', animation: `rotate-3d-x ${isSubmitting ? '8s' : '20s'} linear infinite`, transition: 'animation-duration 1s ease' }} />
        <div style={{ width: '600px', height: '600px', border: '2px dashed rgba(212, 175, 55, 0.18)', borderRadius: '50%', position: 'absolute', animation: `rotate-3d-y ${isSubmitting ? '10s' : '25s'} linear infinite`, transition: 'animation-duration 1s ease' }} />
        <div style={{ width: '1000px', height: '1000px', border: '1px solid rgba(212, 175, 55, 0.06)', borderRadius: '50%', position: 'absolute', animation: `rotate-3d-z ${isSubmitting ? '12s' : '30s'} linear infinite` }} />
        <div style={{ width: '400px', height: '400px', border: '1px solid rgba(212, 175, 55, 0.25)', borderRadius: '50%', position: 'absolute', animation: `rotate-3d-x ${isSubmitting ? '6s' : '15s'} linear infinite reverse` }} />
        {/* Inner detail ring */}
        <div style={{ width: '200px', height: '200px', border: '1px solid rgba(212, 175, 55, 0.4)', borderRadius: '50%', position: 'absolute', animation: `rotate-3d-y ${isSubmitting ? '3s' : '8s'} linear infinite` }} />
        {/* Inner circular grid — depth layer */}
        <div style={{ width: '160px', height: '160px', position: 'absolute', borderRadius: '50%', overflow: 'hidden', opacity: 0.15 }}>
          <div style={{ width: '100%', height: '100%', backgroundImage: 'linear-gradient(rgba(212,175,55,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(212,175,55,0.5) 1px, transparent 1px)', backgroundSize: '20px 20px', animation: `orbit-dot ${isSubmitting ? '4s' : '12s'} linear infinite reverse` }} />
        </div>
        {/* Orbiting dots */}
        {[0,1,2,3].map(i => (
          <div key={i} style={{ position: 'absolute', width: '300px', height: '300px', animation: `orbit-dot ${isSubmitting ? (3 + i) : (6 + i * 2)}s linear infinite`, animationDelay: `${i * 1.5}s` }}>
            <div style={{ width: isSubmitting ? '8px' : '6px', height: isSubmitting ? '8px' : '6px', background: 'var(--accent)', borderRadius: '50%', boxShadow: `0 0 ${isSubmitting ? '20px' : '12px'} var(--accent)`, position: 'absolute', top: '0', left: '50%', transform: 'translateX(-50%)', transition: 'all 0.5s ease' }} />
          </div>
        ))}
        {/* Center pulse — reacts to job state */}
        <div style={{ width: '20px', height: '20px', background: 'var(--accent)', borderRadius: '50%', position: 'absolute', boxShadow: `0 0 ${isSubmitting ? '60px' : '20px'} var(--accent)`, animation: `core-pulse ${isSubmitting ? '0.6s' : '3s'} ease-in-out infinite`, transform: isSubmitting ? 'scale(1.3)' : 'scale(1)', transition: 'all 0.5s ease' }} />
        {/* Ripple waves on job start */}
        {isSubmitting && [1,2,3].map(i => (
          <div key={i} style={{ position: 'absolute', width: `${i * 120}px`, height: `${i * 120}px`, borderRadius: '50%', border: '1px solid rgba(212,175,55,0.3)', animation: `ripple-out 2s ${i * 0.4}s ease-out infinite`, opacity: 0 }} />
        ))}
        {/* Radial glow */}
        <div style={{ width: '500px', height: '500px', background: `radial-gradient(circle, rgba(212, 175, 55, ${completionGlow ? '0.25' : isSubmitting ? '0.14' : '0.06'}) 0%, transparent 70%)`, position: 'absolute', transition: 'all 0.8s ease' }} />

        {/* Data Flow Arc: input → pipeline */}
        <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', opacity: isSubmitting ? 0.35 : 0, transition: 'opacity 0.8s ease' }} viewBox="0 0 1400 800" preserveAspectRatio="none">
          <defs>
            <linearGradient id="flowGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(212,175,55,0)" />
              <stop offset="50%" stopColor="rgba(212,175,55,0.8)" />
              <stop offset="100%" stopColor="rgba(212,175,55,0)" />
            </linearGradient>
          </defs>
          <path d="M 380 480 C 500 480, 700 400, 900 350" fill="none" stroke="url(#flowGrad)" strokeWidth="1.5" strokeDasharray="8 6" />
          {isSubmitting && (
            <circle r="4" fill="var(--accent)">
              <animateMotion dur="2s" repeatCount="indefinite" path="M 380 480 C 500 480, 700 400, 900 350" />
            </circle>
          )}
        </svg>
      </div>

      {/* Hero Header */}
      <div style={{ padding: '6rem 2rem 3rem 2rem', maxWidth: '1400px', margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 10 }}>

        {/* System Status Badge */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'rgba(9,9,18,0.7)', border: '1px solid rgba(212,175,55,0.2)', borderRadius: '999px', padding: '6px 14px', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '2px', color: statusColor, backdropFilter: 'blur(8px)', transition: 'color 0.4s ease' }}>
            {systemStatus}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px', marginBottom: '24px' }}>
          <div style={{ height: '1px', width: '40px', background: 'var(--accent)', opacity: 0.5 }} />
          <span style={{ fontSize: '13px', color: 'var(--accent)', fontWeight: 700, letterSpacing: '5px', textTransform: 'uppercase' }}>Start Visualizing</span>
          <div style={{ height: '1px', width: '40px', background: 'var(--accent)', opacity: 0.5 }} />
        </div>
        <h1 className="metallic-text" style={{ fontSize: '90px', fontWeight: 800, margin: '0 0 32px 0', letterSpacing: '-3px', lineHeight: 1 }}>
          Prompt in. Scene out.
        </h1>
        <p style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', maxWidth: '580px', margin: '0 auto', lineHeight: 1.8 }}>
          Describe a concept, workflow, or logic. Morphix translates the prompt through agentic logic, validates the result natively, and serves the rendered video artifacts.
        </p>

        {/* Workflow Diagram */}
        <div style={{ marginTop: '4rem', display: 'flex', justifyContent: 'center', gap: '2rem', alignItems: 'center', flexWrap: 'wrap', transform: 'perspective(1000px) rotateX(10deg)', transformStyle: 'preserve-3d' }}>
          <div className="metallic-border" style={{ padding: '1.5rem 2.5rem', flex: '0 1 auto', textAlign: 'center', background: 'rgba(15, 15, 26, 0.8)', borderRadius: '12px', backdropFilter: 'blur(8px)', boxShadow: '0 15px 35px rgba(0,0,0,0.4), inset 0 0 15px rgba(212, 175, 55, 0.1)', transform: 'translateZ(20px)' }}>
            <div style={{ fontSize: '0.65rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: '0.5rem' }}>INPUT</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'white' }}>User prompt</div>
          </div>

          <ChevronRight size={24} color="var(--text-secondary)" style={{ transform: 'translateZ(10px)' }} />

          <div className="metallic-border" style={{ padding: '1.5rem 2.5rem', flex: '0 1 auto', textAlign: 'center', background: 'rgba(15, 15, 26, 0.8)', borderRadius: '12px', backdropFilter: 'blur(8px)', boxShadow: '0 15px 35px rgba(0,0,0,0.4), inset 0 0 15px rgba(212, 175, 55, 0.1)', transform: 'translateZ(30px)' }}>
            <div style={{ fontSize: '0.65rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: '0.5rem' }}>PROCESS</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'white' }}>Generate logic</div>
          </div>

          <ChevronRight size={24} color="var(--text-secondary)" style={{ transform: 'translateZ(10px)' }} />

          <div className="metallic-border" style={{ padding: '1.5rem 2.5rem', flex: '0 1 auto', textAlign: 'center', background: 'rgba(15, 15, 26, 0.8)', borderRadius: '12px', backdropFilter: 'blur(8px)', boxShadow: '0 15px 35px rgba(0,0,0,0.4), inset 0 0 15px rgba(212, 175, 55, 0.1)', transform: 'translateZ(40px)' }}>
            <div style={{ fontSize: '0.65rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: '0.5rem' }}>OUTPUT</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'white' }}>Code & render</div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '3rem 2rem', position: 'relative', zIndex: 10 }}>

        {/* New Job & Pipeline - Two Column */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '3rem', marginBottom: '3rem' }}>

          {/* NEW JOB */}
          <div>
            <div style={{ fontSize: '0.75rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: '1.5rem', fontWeight: 600 }}>
              NEW JOB
            </div>
            <h2 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '2rem' }}>
              Describe the animation.
            </h2>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 700, letterSpacing: '3px', textTransform: 'uppercase' }}>Prompt</label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onFocus={() => setTextareaFocused(true)}
                  onBlur={() => setTextareaFocused(false)}
                  placeholder="Animate a sine wave with phase shift and camera zoom..."
                  style={{
                    width: '100%',
                    minHeight: '160px',
                    resize: 'vertical',
                    padding: '1rem',
                    background: 'rgba(9, 9, 18, 0.6)',
                    border: `1px solid ${textareaFocused ? 'rgba(212, 175, 55, 0.8)' : 'rgba(212, 175, 55, 0.3)'}`,
                    backdropFilter: 'blur(8px)',
                    borderRadius: '8px',
                    color: 'white',
                    fontFamily: 'inherit',
                    fontSize: '0.95rem',
                    lineHeight: '1.5',
                    boxShadow: textareaFocused
                      ? '0 0 24px rgba(212,175,55,0.2), inset 0 4px 20px rgba(0,0,0,0.4)'
                      : 'inset 0 4px 20px rgba(0,0,0,0.4)',
                    transform: textareaFocused ? 'scale(1.01)' : 'scale(1)',
                    transition: 'all 0.25s ease',
                    outline: 'none',
                  }}
                  disabled={isSubmitting}
                  required
                />
                {/* Sample Chips */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {sampleChips.map((chip, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setPrompt(chip)}
                      disabled={isSubmitting}
                      style={{
                        padding: '4px 12px',
                        background: 'rgba(212,175,55,0.08)',
                        border: '1px solid rgba(212,175,55,0.25)',
                        borderRadius: '999px',
                        color: 'rgba(212,175,55,0.85)',
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(212,175,55,0.18)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'rgba(212,175,55,0.08)'}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '1rem',
                padding: '1rem',
                background: 'rgba(9, 9, 18, 0.6)',
                border: `1px solid ${ttsEnabled ? 'rgba(212, 175, 55, 0.75)' : 'rgba(212, 175, 55, 0.25)'}`,
                borderRadius: '12px',
                backdropFilter: 'blur(8px)',
                boxShadow: ttsEnabled ? '0 0 24px rgba(212, 175, 55, 0.16)' : 'inset 0 4px 20px rgba(0,0,0,0.28)',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                opacity: isSubmitting ? 0.72 : 1,
                transition: 'all 0.25s ease'
              }}>
                <input
                  type="checkbox"
                  checked={ttsEnabled}
                  onChange={(e) => setTtsEnabled(e.target.checked)}
                  disabled={isSubmitting}
                  style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
                />
                <div>
                  <div style={{ color: 'white', fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.25rem' }}>
                    TTS narration
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', lineHeight: 1.45 }}>
                    {ttsEnabled ? 'Generate synchronized voiceover audio for this video.' : 'Generate a silent visualization with labels only.'}
                  </div>
                </div>
                <div style={{
                  width: '54px',
                  height: '30px',
                  borderRadius: '999px',
                  padding: '3px',
                  background: ttsEnabled ? 'linear-gradient(135deg, var(--accent), var(--accent-hover))' : 'rgba(255,255,255,0.12)',
                  border: `1px solid ${ttsEnabled ? 'rgba(255,255,255,0.24)' : 'rgba(255,255,255,0.12)'}`,
                  transition: 'all 0.25s ease',
                  flexShrink: 0
                }}>
                  <div style={{
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    background: '#fff',
                    transform: ttsEnabled ? 'translateX(24px)' : 'translateX(0)',
                    transition: 'transform 0.25s ease',
                    boxShadow: '0 6px 16px rgba(0,0,0,0.35)'
                  }} />
                </div>
              </label>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '1rem',
                padding: '1rem',
                background: 'rgba(9, 9, 18, 0.6)',
                border: `1px solid ${paperEnabled ? 'rgba(212, 175, 55, 0.75)' : 'rgba(212, 175, 55, 0.25)'}`,
                borderRadius: '12px',
                backdropFilter: 'blur(8px)',
                boxShadow: paperEnabled ? '0 0 24px rgba(212, 175, 55, 0.16)' : 'inset 0 4px 20px rgba(0,0,0,0.28)',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                opacity: isSubmitting ? 0.72 : 1,
                transition: 'all 0.25s ease'
              }}>
                <input
                  type="checkbox"
                  checked={paperEnabled}
                  onChange={(e) => setPaperEnabled(e.target.checked)}
                  disabled={isSubmitting}
                  style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
                />
                <div>
                  <div style={{ color: 'white', fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.25rem' }}>
                    Topic paper
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', lineHeight: 1.45 }}>
                    {paperEnabled ? 'Generate a compact companion PDF for this visualization.' : 'Generate only the video output for this prompt.'}
                  </div>
                </div>
                <div style={{
                  width: '54px',
                  height: '30px',
                  borderRadius: '999px',
                  padding: '3px',
                  background: paperEnabled ? 'linear-gradient(135deg, var(--accent), var(--accent-hover))' : 'rgba(255,255,255,0.12)',
                  border: `1px solid ${paperEnabled ? 'rgba(255,255,255,0.24)' : 'rgba(255,255,255,0.12)'}`,
                  transition: 'all 0.25s ease',
                  flexShrink: 0
                }}>
                  <div style={{
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    background: '#fff',
                    transform: paperEnabled ? 'translateX(24px)' : 'translateX(0)',
                    transition: 'transform 0.25s ease',
                    boxShadow: '0 6px 16px rgba(0,0,0,0.35)'
                  }} />
                </div>
              </label>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="cinematic-button primary"
                  style={{
                    width: '100%',
                    maxWidth: '220px',
                    justifyContent: 'center',
                    gap: '0.65rem',
                    position: 'relative',
                    overflow: 'hidden',
                    boxShadow: btnBurst
                      ? '0 0 60px rgba(212,175,55,0.8)'
                      : isSubmitting ? 'none' : '0 14px 30px rgba(212, 175, 55, 0.35)',
                    background: isSubmitting
                      ? 'rgba(212,175,55,0.6)'
                      : 'linear-gradient(135deg, #d4af37 0%, #f5c842 50%, #d4af37 100%)',
                    backgroundSize: '200% 100%',
                    animation: !isSubmitting ? 'btn-shimmer 3s ease infinite' : 'none',
                    color: '#050508',
                    fontWeight: 700,
                    transform: btnBurst ? 'scale(0.96)' : 'scale(1)',
                    transition: 'box-shadow 0.3s ease, transform 0.15s ease',
                  }}
                >
                  {isSubmitting ? <Clock size={18} className="spin" /> : <Play size={18} />}
                  {isSubmitting ? 'Generating…' : 'Generate Job'}
                </button>
                {isSubmitting && (
                  <button type="button" onClick={handleCancel} className="cinematic-button" style={{ width: '100%', maxWidth: '220px', background: 'transparent', border: '1px solid rgba(255, 95, 86, 0.5)', color: '#ff5f56' }}>
                    Stop Current Run
                  </button>
                )}
                {!isSubmitting && lastPrompt && (
                  <button type="button" onClick={() => handleSubmit()} className="cinematic-button" style={{ width: '100%', maxWidth: '220px', background: 'transparent', border: '1px solid rgba(255, 255, 255, 0.3)', color: '#fff' }}>
                    Generate Again
                  </button>
                )}
              </div>
              {error && <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</div>}
            </form>
          </div>

          {/* PIPELINE */}
          <div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{
                marginBottom: '1.25rem',
                padding: '1rem',
                borderRadius: '12px',
                border: '1px solid rgba(212, 175, 55, 0.22)',
                background: 'rgba(9, 9, 18, 0.62)',
                backdropFilter: 'blur(10px)',
                boxShadow: isSubmitting ? '0 0 28px rgba(212,175,55,0.12)' : 'inset 0 1px 0 rgba(255,255,255,0.04)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '0.7rem' }}>
                  <div>
                    <div style={{ color: 'white', fontWeight: 700, fontSize: '0.9rem' }}>Generation progress</div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.74rem', marginTop: '0.2rem' }}>{progressLabel}</div>
                  </div>
                  <div style={{
                    color: result ? '#27c93f' : isSubmitting ? '#ffbd2e' : 'rgba(212,175,55,0.72)',
                    fontWeight: 900,
                    fontSize: '0.9rem',
                    fontFamily: '"Fira Code", monospace',
                    letterSpacing: '0.04em'
                  }}>
                    {Math.round(generationProgress)}%
                  </div>
                </div>
                <div style={{
                  height: '8px',
                  borderRadius: '999px',
                  background: 'rgba(255,255,255,0.08)',
                  overflow: 'hidden',
                  position: 'relative',
                  border: '1px solid rgba(255,255,255,0.06)'
                }}>
                  <div style={{
                    width: `${generationProgress}%`,
                    height: '100%',
                    borderRadius: '999px',
                    position: 'relative',
                    overflow: 'hidden',
                    background: result
                      ? 'linear-gradient(90deg, #27c93f, #9ff7c1)'
                      : 'linear-gradient(90deg, #8a6d14, #ffbd2e, #f5c842)',
                    boxShadow: isSubmitting ? '0 0 22px rgba(255,189,46,0.42)' : 'none',
                    transition: 'width 0.7s cubic-bezier(0.16, 1, 0.3, 1)'
                  }}>
                    <div style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)',
                      animation: isSubmitting ? 'progress-glint 1.4s linear infinite' : 'none',
                      transform: 'translateX(-100%)'
                    }} />
                  </div>
                  {isSubmitting && (
                    <div style={{
                      position: 'absolute',
                      inset: 0,
                      backgroundImage: 'repeating-linear-gradient(115deg, transparent 0, transparent 9px, rgba(255,255,255,0.08) 9px, rgba(255,255,255,0.08) 15px)',
                      animation: 'progress-stripes 1s linear infinite',
                      opacity: 0.6
                    }} />
                  )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.6rem', color: 'rgba(255,255,255,0.34)', fontSize: '0.65rem', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  <span>{getCompletedCount()} / {stages.length} stages done</span>
                  <span>{isSubmitting ? 'Live estimate' : result ? 'Complete' : 'Idle'}</span>
                </div>
              </div>
              {stages.map((stage, idx) => {
                const isCompleted = stage.status === 'completed';
                const isRunning = stage.status === 'running';
                const isFailed = stage.status === 'failed';
                const showTerminal = activityLogs.length > 0 && stage.id === activeStageId;
                
                const statusColor = isCompleted ? '#27c93f' : isRunning ? '#ffbd2e' : isFailed ? '#ff5f56' : 'rgba(212, 175, 55, 0.35)';
                const statusBg = isCompleted
                  ? 'rgba(39, 201, 63, 0.05)'
                  : isRunning
                  ? 'rgba(255, 189, 46, 0.08)'
                  : isFailed
                  ? 'rgba(255, 95, 86, 0.1)'
                  : 'rgba(255,255,255,0.02)';
                const statusBorder = isCompleted ? 'rgba(39, 201, 63, 0.35)' : isRunning ? 'rgba(255, 189, 46, 0.7)' : isFailed ? '#ff5f56' : 'rgba(255,255,255,0.06)';
                const statusGlow = isCompleted ? 'rgba(39, 201, 63, 0.12)' : isRunning ? 'rgba(255, 189, 46, 0.25)' : isFailed ? 'rgba(255, 95, 86, 0.2)' : 'transparent';
                const statusLabel = isCompleted ? '✓ Done' : isRunning ? '● Running' : isFailed ? '✕ Failed' : '○ Pending';

                return (
                  <div key={stage.id} style={{ display: 'flex', gap: '20px', alignItems: 'stretch' }}>
                    
                    {/* Timeline Tracker */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '18px' }}>
                      <div style={{ 
                        width: '18px', height: '18px', borderRadius: '50%', background: statusColor, zIndex: 2,
                        marginTop: '22px',
                        boxShadow: `0 0 15px ${statusColor}`,
                        animation: isRunning ? 'pulse-node 1s infinite alternate' : 'none',
                        transition: 'all 0.4s ease'
                      }} />
                      {idx < stages.length - 1 && (
                        <div style={{ 
                          width: '2px', flex: 1, background: isCompleted ? '#27c93f' : 'rgba(212, 175, 55, 0.2)',
                          margin: '6px 0', transition: 'background 0.4s ease'
                        }} />
                      )}
                    </div>

                    {/* Pipeline Info Box */}
                    <div style={{
                      flex: 1,
                      padding: '0.9rem 1.1rem',
                      marginBottom: idx < stages.length - 1 ? '10px' : '0',
                      background: statusBg,
                      border: `1px solid ${completionGlow ? 'rgba(212,175,55,0.6)' : statusBorder}`,
                      borderRadius: '8px',
                      backdropFilter: 'blur(12px)',
                      boxShadow: completionGlow
                        ? `0 0 30px rgba(212,175,55,0.3)`
                        : `0 0 20px ${statusGlow}, inset 0 1px 0 rgba(255,255,255,0.04)`,
                      transition: 'all 0.4s ease',
                      position: 'relative',
                      overflow: 'hidden',
                      transform: isRunning ? 'scale(1.02)' : 'scale(1)',
                    }}>
                       {isRunning && <div style={{ position: 'absolute', top: 0, left: '-100%', width: '50%', height: '100%', background: 'linear-gradient(90deg, transparent, rgba(255, 189, 46, 0.15), transparent)', animation: 'shimmer 1.5s infinite' }} />}
                       
                       <div style={{ position: 'relative', zIndex: 1 }}>
                         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
                           <div style={{ fontWeight: 600, color: isRunning ? 'white' : isCompleted ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.4)', fontSize: '0.95rem', transition: 'color 0.4s ease' }}>{stage.label}</div>
                           <div style={{ fontSize: '0.7rem', letterSpacing: '0.08em', fontWeight: 800, color: statusColor, transition: 'color 0.4s ease' }}>
                             {statusLabel}
                           </div>
                         </div>
                         <div style={{ fontSize: '0.82rem', color: isRunning ? 'rgba(255,255,255,0.85)' : 'var(--text-secondary)', lineHeight: '1.5', transition: 'color 0.4s ease' }}>
                           {stage.details}
                         </div>
                         {isRunning && (
                           <div style={{ marginTop: '6px', fontSize: '0.72rem', color: 'rgba(255,189,46,0.7)', fontFamily: 'monospace', letterSpacing: '1px' }}>
                             ~{elapsedTime}s elapsed
                           </div>
                         )}
                         {showTerminal && (
                          <div style={{
                            marginTop: '0.95rem',
                            borderRadius: '10px',
                            border: '1px solid rgba(255,255,255,0.08)',
                            background: 'rgba(3, 4, 10, 0.92)',
                            overflow: 'hidden',
                            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.02)'
                          }}>
                            <div style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '12px',
                              padding: '0.55rem 0.75rem',
                              borderBottom: '1px solid rgba(255,255,255,0.06)',
                              background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))'
                            }}>
                              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ff5f56', display: 'inline-block' }} />
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ffbd2e', display: 'inline-block' }} />
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#27c93f', display: 'inline-block' }} />
                              </div>
                              <div style={{
                                fontSize: '0.63rem',
                                letterSpacing: '0.18em',
                                textTransform: 'uppercase',
                                color: 'rgba(255,255,255,0.55)',
                                fontWeight: 700
                              }}>
                                Live activity stream
                              </div>
                            </div>
                            <div
                              ref={terminalRef}
                              style={{
                                maxHeight: '180px',
                                overflowY: 'auto',
                                padding: '0.7rem 0.8rem 0.85rem',
                                fontFamily: '"Fira Code", monospace',
                                fontSize: '0.68rem',
                                lineHeight: 1.5,
                                color: '#9ff7c1',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word'
                              }}
                            >
                              {activityLogs.map((entry) => (
                                <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: '58px 1fr', gap: '10px', marginBottom: '0.22rem' }}>
                                  <span style={{ color: 'rgba(255,255,255,0.34)' }}>
                                    {new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                  </span>
                                  <span>
                                    <span style={{ color: '#d4af37', marginRight: '8px' }}>[{entry.source}]</span>
                                    {entry.message}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                         )}
                       </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <style>{`
              @keyframes pulse-node {
                0% { transform: scale(1); opacity: 0.8; }
                100% { transform: scale(1.3); opacity: 1; boxShadow: 0 0 20px #ffbd2e; }
              }
              @keyframes shimmer {
                0% { left: -100%; }
                100% { left: 200%; }
              }
              @keyframes progress-glint {
                0% { transform: translateX(-100%); }
                100% { transform: translateX(120%); }
              }
              @keyframes progress-stripes {
                0% { background-position: 0 0; }
                100% { background-position: 28px 0; }
              }
            `}</style>
          </div>

        </div>

        {/* RESULT Section */}
        <div>
          <div style={{ fontSize: '0.75rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: '2rem', fontWeight: 600 }}>
            RESULT
          </div>
          <h2 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '3rem' }}>
            Code, report, and render.
          </h2>

          {!result ? (
            <div style={{ background: 'rgba(9,9,18,0.7)', border: `1px solid ${isSubmitting ? 'rgba(212,175,55,0.3)' : 'rgba(212,175,55,0.12)'}`, borderRadius: '16px', backdropFilter: 'blur(12px)', overflow: 'hidden', transition: 'border-color 0.5s ease' }}>
              {/* Tabs */}
              <div style={{ display: 'flex', borderBottom: '1px solid rgba(212,175,55,0.15)' }}>
                {['Video', 'Paper', 'Code', 'Logs'].map(tab => (
                  <button key={tab} type="button"
                    onClick={() => setActiveTab(tab.toLowerCase())}
                    style={{
                      padding: '12px 24px', background: 'transparent', border: 'none',
                      borderBottom: activeTab === tab.toLowerCase() ? '2px solid var(--accent)' : '2px solid transparent',
                      color: activeTab === tab.toLowerCase() ? 'var(--accent)' : 'var(--text-secondary)',
                      fontWeight: 700, fontSize: '0.8rem', letterSpacing: '2px', textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.2s ease'
                    }}>{tab}</button>
                ))}
              </div>
              {/* Preview Placeholder — Reacts to processing state */}
              <div style={{ minHeight: '300px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px', padding: '3rem', position: 'relative', overflow: 'hidden' }}>
                {isSubmitting && (
                  <div style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 30px, rgba(212,175,55,0.03) 30px, rgba(212,175,55,0.03) 31px)', animation: 'scan-lines 4s linear infinite', opacity: 0.8 }} />
                )}
                <div style={{ width: '72px', height: '72px', borderRadius: '50%', border: `2px solid rgba(212,175,55,${isSubmitting ? '0.5' : '0.2'})`, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: `core-pulse ${isSubmitting ? '1s' : '3s'} ease-in-out infinite`, transition: 'all 0.5s ease', boxShadow: isSubmitting ? '0 0 30px rgba(212,175,55,0.2)' : 'none' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: `rgba(212,175,55,${isSubmitting ? '0.3' : '0.1'})`, border: `1px solid rgba(212,175,55,${isSubmitting ? '0.8' : '0.4'})`, transition: 'all 0.5s ease' }} />
                </div>
                <span style={{ fontSize: '0.85rem', letterSpacing: '3px', textTransform: 'uppercase', color: isSubmitting ? 'rgba(212,175,55,0.9)' : 'var(--text-secondary)', transition: 'color 0.5s ease' }}>
                  {isSubmitting ? 'Rendering frames…' : 'Awaiting output…'}
                </span>
                {isSubmitting && (
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {[0,1,2,3,4,5].map(i => (
                      <div key={i} style={{ width: '3px', height: `${8 + Math.sin(i) * 6}px`, background: 'var(--accent)', borderRadius: '2px', opacity: 0.6, animation: `micro-wave 1s ${i * 0.15}s ease-in-out infinite` }} />
                    ))}
                  </div>
                )}
                {!isSubmitting && <span style={{ fontSize: '0.75rem', opacity: 0.4 }}>Submit a prompt to generate and preview artifacts here.</span>}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

              {/* Video Preview */}
              {result.renderManifest?.videoAsset ? (
                <div style={{ width: '100%', borderRadius: '8px', overflow: 'hidden', background: '#000' }}>
                  <video src={result.renderManifest.videoAsset} controls autoPlay style={{ width: '100%', display: 'block' }} />
                </div>
              ) : (
                <div style={{ background: 'rgba(200, 50, 50, 0.1)', border: '1px solid var(--danger)', padding: '1.5rem', borderRadius: '8px', color: 'var(--danger)' }}>
                  <AlertCircle size={18} style={{ marginBottom: '0.5rem' }} />
                  <div>Render Unavailable: {result.renderManifest?.rendererNotes?.join(" ") || "No video was generated."}</div>
                </div>
              )}

              {/* Topic Paper Preview */}
              <div style={{
                background: 'rgba(9, 9, 18, 0.72)',
                border: '1px solid rgba(212, 175, 55, 0.28)',
                borderRadius: '14px',
                overflow: 'hidden',
                backdropFilter: 'blur(10px)',
                boxShadow: '0 24px 60px rgba(0,0,0,0.35)'
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  padding: '1rem 1.2rem',
                  borderBottom: '1px solid rgba(212, 175, 55, 0.14)',
                  background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{
                      width: '34px',
                      height: '34px',
                      borderRadius: '10px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'rgba(212, 175, 55, 0.12)',
                      color: 'var(--accent)'
                    }}>
                      <FileText size={18} />
                    </div>
                    <div>
                      <div style={{ color: 'white', fontWeight: 700, fontSize: '0.98rem' }}>Topic paper</div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', marginTop: '0.18rem' }}>
                        Companion PDF generated for this visualization.
                      </div>
                    </div>
                  </div>
                  {result.renderManifest?.paperAsset && (
                    <a
                      href={result.renderManifest.paperAsset}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.45rem',
                        padding: '0.65rem 0.9rem',
                        borderRadius: '999px',
                        border: '1px solid rgba(212, 175, 55, 0.42)',
                        color: 'var(--accent)',
                        textDecoration: 'none',
                        fontSize: '0.75rem',
                        fontWeight: 800,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        background: 'rgba(212, 175, 55, 0.08)'
                      }}
                    >
                      Open PDF <ExternalLink size={14} />
                    </a>
                  )}
                </div>

                {result.renderManifest?.paperAsset ? (
                  <div style={{ padding: '1rem', background: 'rgba(0,0,0,0.25)' }}>
                    <iframe
                      title="Morphix topic paper"
                      src={result.renderManifest.paperAsset}
                      style={{
                        width: '100%',
                        height: '520px',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '10px',
                        background: '#111'
                      }}
                    />
                    <div style={{ marginTop: '0.75rem', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
                      If the PDF preview does not load in your browser, use the Open PDF button above.
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '1.2rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    No companion paper was published for this render yet.
                  </div>
                )}
              </div>

              {/* Metadata Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
                <div style={{ background: 'rgba(9, 9, 18, 0.7)', backdropFilter: 'blur(8px)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(212, 175, 55, 0.3)' }}>
                  <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Title</div>
                  <div style={{ fontWeight: 600, color: 'white', fontSize: '0.95rem', wordBreak: 'break-word' }}>
                    {result.title || "Untitled"}
                  </div>
                </div>
                <div style={{ background: 'rgba(9, 9, 18, 0.7)', backdropFilter: 'blur(8px)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(212, 175, 55, 0.3)' }}>
                  <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Generator</div>
                  <div style={{ fontWeight: 600, color: 'white', fontSize: '0.95rem' }}>
                    {result.source === 'fallback' ? 'fallback-after-model-error' : result.source || 'Unknown'}
                  </div>
                </div>
                <div style={{ background: 'rgba(9, 9, 18, 0.7)', backdropFilter: 'blur(8px)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(212, 175, 55, 0.3)' }}>
                  <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Validation</div>
                  <div style={{ fontWeight: 600, color: result.validation?.valid ? '#27c93f' : '#ffbd2e' }}>
                    {result.validation?.valid ? "Passed" : "Failed"}
                  </div>
                </div>
                <div style={{ background: 'rgba(9, 9, 18, 0.7)', backdropFilter: 'blur(8px)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(212, 175, 55, 0.3)' }}>
                  <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Job State</div>
                  <div style={{ fontWeight: 600, color: 'white', fontSize: '0.95rem', textTransform: 'capitalize' }}>
                    {jobState || '-'}
                  </div>
                </div>
              </div>

              {/* Validator Report & Code */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                <div style={{ background: 'rgba(5, 5, 5, 0.8)', borderRadius: '12px', border: '1px solid rgba(212, 175, 55, 0.3)', padding: '24px', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', position: 'relative', overflow: 'hidden', backdropFilter: 'blur(8px)', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f56' }} />
                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ffbd2e' }} />
                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#27c93f' }} />
                  </div>
                  <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>Validator report</h3>
                  <pre className="code-font" style={{
                    flex: 1,
                    overflow: 'auto',
                    maxHeight: '300px',
                    color: '#22c55e',
                    fontSize: '0.85rem',
                    margin: 0,
                    lineHeight: 1.6
                  }}>
                    {result.validation?.report || 'null'}
                  </pre>
                </div>
                <div style={{ background: 'rgba(5, 5, 5, 0.8)', borderRadius: '12px', border: '1px solid rgba(212, 175, 55, 0.3)', padding: '24px', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', position: 'relative', overflow: 'hidden', backdropFilter: 'blur(8px)', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f56' }} />
                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ffbd2e' }} />
                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#27c93f' }} />
                  </div>
                  <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>Generated Source code</h3>
                  <pre className="code-font" style={{
                    flex: 1,
                    overflow: 'auto',
                    maxHeight: '300px',
                    color: 'var(--accent)',
                    fontSize: '0.85rem',
                    margin: 0,
                    lineHeight: 1.6
                  }}>
                    {result.code || '// No code available'}
                  </pre>
                </div>
              </div>

            </div>
          )}

          {/* Past Generations */}
          <div style={{
            marginTop: '2rem',
            background: 'rgba(9, 9, 18, 0.72)',
            border: '1px solid rgba(212, 175, 55, 0.22)',
            borderRadius: '16px',
            overflow: 'hidden',
            backdropFilter: 'blur(10px)',
            boxShadow: '0 24px 60px rgba(0,0,0,0.28)'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              padding: '1rem 1.2rem',
              borderBottom: '1px solid rgba(212, 175, 55, 0.14)',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))'
            }}>
              <div>
                <div style={{ color: 'white', fontWeight: 800, fontSize: '1rem' }}>Past video generations</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', marginTop: '0.2rem' }}>
                  Accessible links to completed renders from this Morphix session.
                </div>
              </div>
              <button
                type="button"
                onClick={fetchPastRenders}
                style={{
                  padding: '0.55rem 0.85rem',
                  borderRadius: '999px',
                  border: '1px solid rgba(212, 175, 55, 0.35)',
                  background: 'rgba(212, 175, 55, 0.08)',
                  color: 'var(--accent)',
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  cursor: 'pointer'
                }}
              >
                Refresh
              </button>
            </div>

            {pastRenders.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {pastRenders.map((render) => (
                  <div
                    key={render.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto',
                      gap: '1rem',
                      alignItems: 'center',
                      padding: '1rem 1.2rem',
                      borderBottom: '1px solid rgba(255,255,255,0.06)'
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        color: 'white',
                        fontWeight: 700,
                        fontSize: '0.92rem',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        {render.prompt || 'Untitled generation'}
                      </div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.74rem', marginTop: '0.28rem' }}>
                        {render.createdAt ? new Date(render.createdAt).toLocaleString() : render.id}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {render.videoAsset && (
                        <a
                          href={render.videoAsset}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                            padding: '0.55rem 0.8rem',
                            borderRadius: '999px',
                            border: '1px solid rgba(212, 175, 55, 0.38)',
                            color: 'var(--accent)',
                            textDecoration: 'none',
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            background: 'rgba(212, 175, 55, 0.08)'
                          }}
                        >
                          Video <ExternalLink size={13} />
                        </a>
                      )}
                      {render.paperAsset && (
                        <a
                          href={render.paperAsset}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                            padding: '0.55rem 0.8rem',
                            borderRadius: '999px',
                            border: '1px solid rgba(255,255,255,0.14)',
                            color: 'rgba(255,255,255,0.82)',
                            textDecoration: 'none',
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            background: 'rgba(255,255,255,0.05)'
                          }}
                        >
                          Topic paper <ExternalLink size={13} />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: '1.2rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                No completed video generations have been collected in this session yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

