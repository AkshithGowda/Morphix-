const fsp = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const crypto = require("crypto");
const http = require("http");
const https = require("https");

const rootDir = path.join(__dirname, "..");
const generatedRoot = path.join(rootDir, "generated");
const publicRenderRoot = path.join(rootDir, "public", "renders");

const bridgeStages = [
  ["prompt", "Preparing prompt"],
  ["dispatch", "Dispatching to Hermes in WSL"],
  ["agent", "Hermes generating code and video"],
  ["fetch", "Fetching render from WSL"],
  ["renderer", "Publishing video to the website"],
];

function formatLogTime(date = new Date()) {
  return date.toISOString();
}

function appendJobLog(job, message, source = "bridge") {
  if (!job.logs) {
    job.logs = [];
  }

  job.logs.push({
    id: `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    at: formatLogTime(),
    source,
    message: String(message || "").trim(),
  });

  if (job.logs.length > 400) {
    job.logs = job.logs.slice(-400);
  }
}

function getJobSnapshot(job) {
  return JSON.parse(JSON.stringify(job, (key, value) => {
    if (key.startsWith("_")) {
      return undefined;
    }
    return value;
  }));
}

function ensureNotCancelled(job) {
  if (job.cancelRequested || job.status === "cancelled") {
    const error = new Error("Generation stopped by the user.");
    error.code = "JOB_CANCELLED";
    throw error;
  }
}

function resetStages(job) {
  job.stages = bridgeStages.map(([id, label]) => ({
    id,
    label,
    status: "pending",
    details: "",
  }));
  job.logs = [];
}

function markStage(job, stageId, status, details) {
  const stage = job.stages.find((entry) => entry.id === stageId);
  if (!stage) {
    return;
  }
  stage.status = status;
  if (details) {
    stage.details = details;
  }

  appendJobLog(
    job,
    `${stage.label}: ${status.toUpperCase()}${details ? ` — ${details}` : ""}`,
    "stage"
  );
}

function shellEscapeBash(value) {
  return `'${String(value || "").replace(/'/g, `'\\''`)}'`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommandDetailed(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf-8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf-8");
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
        return;
      }
      reject(new Error([stdout, stderr].filter(Boolean).join("\n").trim() || `Command exited with code ${code}.`));
    });
  });
}

function buildBridgeConfig() {
  return {
    distro: process.env.HERMES_WSL_DISTRO || "Ubuntu",
    workdir: process.env.HERMES_WSL_WORKDIR || "",
    outputRoot: process.env.HERMES_WSL_OUTPUT_DIR || "",
    commandTemplate: process.env.HERMES_WSL_COMMAND_TEMPLATE || "",
    forwardUrl: process.env.HERMES_FORWARD_URL || "",
    forwardMethod: (process.env.HERMES_FORWARD_METHOD || "POST").toUpperCase(),
    forwardSecret: process.env.HERMES_FORWARD_SECRET || "",
    forwardTimeoutMs: Number(process.env.HERMES_FORWARD_TIMEOUT_MS || 15000),
    pollTimeoutMs: Number(process.env.HERMES_FETCH_TIMEOUT_MS || 900000),
    pollIntervalMs: Number(process.env.HERMES_FETCH_INTERVAL_MS || 2000),
    gatewayLogPath: process.env.HERMES_WSL_GATEWAY_LOG || "",
  };
}

function isTtsEnabled(job) {
  return job?.options?.ttsEnabled !== false;
}

function isPaperEnabled(job) {
  return job?.options?.paperEnabled !== false;
}

function buildForwardedPrompt(rawPrompt, options = {}) {
  const ttsEnabled = options.ttsEnabled !== false;
  const paperEnabled = options.paperEnabled !== false;
  const audioConstraints = ttsEnabled
    ? [
        "1. The final video must include synchronized TTS narration explaining the visualization clearly.",
        "2. The TTS narration must be embedded into the final.mp4 output and synchronized with the visuals.",
        "3. Preserve clear audio quality; the narration should be concise, natural, and mathematically precise.",
      ]
    : [
        "1. Do not generate TTS narration or any voiceover audio for this video.",
        "2. Do not create, synthesize, stitch, or embed narration audio into the final.mp4 output.",
        "3. The visualization should communicate clearly through visuals, labels, and concise on-screen text only.",
      ];
  const paperConstraints = paperEnabled
    ? [
        "12. Create a short research-paper-styled companion document about the same topic as the generated Manim video.",
        "13. The paper must be authored directly by the LLM during this job; do not invoke any extra research, paper-writing, document-generation, or specialized skill for it.",
        "14. Use TinyTeX only as the LaTeX formatter/compiler that turns the LLM-written paper into a PDF.",
        "15. The paper must be at most 3 pages long and must never exceed 3 pages.",
        "16. The paper should explain the topic, core intuition, relevant equations or technical details, and how the visualization represents the concept.",
        "17. The paper does not need citation-grade academic sourcing, but it should be coherent, educational, technically meaningful, and aligned with the video topic.",
        "18. Save the LaTeX source as paper.tex and the final compiled PDF as paper.pdf in the requested output directory.",
        "19. Do not generate report.txt, report.md, or any separate report text file; the only companion document should be paper.pdf plus the optional paper.tex source.",
      ]
    : [
        "12. Do not create a research paper, PDF, LaTeX source, report, or any companion document for this job.",
        "13. Do not run TinyTeX, pdflatex, latexmk, or any PDF compilation command for this job.",
        "14. The only required output artifact is the final website-ready video final.mp4.",
        "15. Do not generate report.txt, report.md, paper.tex, paper.pdf, or any separate report text file.",
      ];

  return [
    String(rawPrompt || "").trim(),
    "",
    "Morphix delivery constraints:",
    ...audioConstraints,
    "4. The final video should target 30 seconds exactly and must never exceed 30 seconds.",
    "5. The video must stay mathematically accurate, precise, and easy to follow within the 30-second cap.",
    "6. Preserve strong visual quality; do not sacrifice correctness or readability to fit the shorter duration.",
    "7. Prioritize the core explanation and avoid filler, redundant narration, or decorative scenes.",
    "8. Render only one final production output at exactly 854x480 and 30 fps.",
    "9. Do not create draft, preview, alternate-fps, or alternate-resolution renders such as 480p15, 480p60, 720p, or any second version.",
    ttsEnabled
      ? "10. Save the final website-ready video with embedded audio as final.mp4 in the requested output directory."
      : "10. Save the final website-ready silent video as final.mp4 in the requested output directory.",
    "11. Save the main Manim code file as scene.py in the requested output directory if it is available without extra cleanup work.",
    ...paperConstraints,
    paperEnabled
      ? "20. Do not open, preview, play, or launch the rendered video or PDF in any local GUI or default viewer."
      : "20. Do not open, preview, play, or launch the rendered video in any local GUI or default viewer.",
    "21. Do not run xdg-open, open, start, VLC, mpv, ffplay, evince, okular, or any equivalent viewer command.",
    "22. Do not delete media folders, partial_movie_files folders, paper source files, PDFs, or run cleanup commands after rendering.",
    paperEnabled
      ? "23. Do not run rm, mv, ls verification loops, or any post-render housekeeping once final.mp4 and paper.pdf are ready."
      : "23. Do not run rm, mv, ls verification loops, or any post-render housekeeping once final.mp4 is ready.",
    paperEnabled
      ? "24. Treat the job as complete only after final.mp4 and paper.pdf are both written successfully into the requested output directory."
      : "24. Treat the job as complete immediately after final.mp4 is written successfully into the requested output directory.",
    "25. After the job is complete, stop all work for that prompt and return control to the Hermes gateway so it is ready for the next prompt.",
    "26. Stream the real live terminal output for this job into a plain text file at {outputDir}/job.log while the job runs.",
    "27. Append terminal output continuously to job.log so the website can tail it in real time.",
    ttsEnabled
      ? `28. Keep job.log as the exact runtime feed for this job, including generation, TTS, ${paperEnabled ? "paper PDF creation, " : ""}render, and stitching progress messages.`
      : `28. Keep job.log as the exact runtime feed for this job, including generation, ${paperEnabled ? "paper PDF creation, " : ""}render, and stitching progress messages.`,
  ].join("\n");
}

function ensureBridgeConfig(config) {
  const missing = [];
  if (!config.outputRoot) missing.push("HERMES_WSL_OUTPUT_DIR");
  if (!config.forwardUrl && !config.commandTemplate) {
    missing.push("HERMES_FORWARD_URL or HERMES_WSL_COMMAND_TEMPLATE");
  }
  if (missing.length > 0) {
    throw new Error(`Hermes bridge is not configured. Missing: ${missing.join(", ")}.`);
  }
}

function interpolateTemplate(template, context) {
  return String(template)
    .replaceAll("__JOB_ID__", shellEscapeBash(context.jobId))
    .replaceAll("__PROMPT__", shellEscapeBash(context.prompt))
    .replaceAll("__PROMPT_B64__", shellEscapeBash(context.promptBase64))
    .replaceAll("__OUTPUT_DIR__", shellEscapeBash(context.outputDir))
    .replaceAll("__WORKDIR__", shellEscapeBash(context.workdir));
}

async function runHermesInWsl(config, job, jobDir) {
  const outputDir = `${config.outputRoot.replace(/\/$/, "")}/${job.id}`;
  const promptBase64 = Buffer.from(job.prompt, "utf-8").toString("base64");
  const promptFilePath = path.join(jobDir, "prompt.txt");
  await fsp.writeFile(promptFilePath, job.prompt, "utf-8");

  const commandBody = interpolateTemplate(config.commandTemplate, {
    jobId: job.id,
    prompt: job.prompt,
    promptBase64,
    outputDir,
    workdir: config.workdir,
  });

  const command = [
    "set -e",
    `mkdir -p ${shellEscapeBash(outputDir)}`,
    config.workdir ? `cd ${shellEscapeBash(config.workdir)}` : "",
    commandBody,
  ].filter(Boolean).join("; ");

  return runCommandDetailed("wsl.exe", ["-d", config.distro, "--", "bash", "-lc", command], rootDir);
}

function requestJson(urlString, options = {}, body = null) {
  const url = new URL(urlString);
  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const request = transport.request(
      url,
      {
        method: options.method || "POST",
        headers: options.headers || {},
        timeout: options.timeout || 15000,
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf-8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve({
              statusCode: response.statusCode,
              body: raw,
            });
            return;
          }
          reject(new Error(`Forward request failed with status ${response.statusCode}. ${raw}`.trim()));
        });
      }
    );

    request.on("error", reject);
    request.on("timeout", () => {
      request.destroy(new Error("Forward request timed out."));
    });

    if (body) {
      request.write(body);
    }
    request.end();
  });
}

async function forwardPromptToHermes(config, job, jobDir) {
  const outputDir = `${config.outputRoot.replace(/\/$/, "")}/${job.id}`;
  const ttsEnabled = isTtsEnabled(job);
  const paperEnabled = isPaperEnabled(job);
  const forwardedPrompt = buildForwardedPrompt(job.prompt, { ttsEnabled, paperEnabled });
  const promptBase64 = Buffer.from(forwardedPrompt, "utf-8").toString("base64");
  const payload = {
    jobId: job.id,
    prompt: forwardedPrompt,
    originalPrompt: job.prompt,
    promptBase64,
    outputDir,
    workdir: config.workdir,
    source: "morphix",
    requestedAt: new Date().toISOString(),
    maxDurationSeconds: 30,
    targetDurationSeconds: 30,
    requireMathAccuracy: true,
    requireTts: ttsEnabled,
    requireEmbeddedAudio: ttsEnabled,
    disallowReportFile: true,
    requireResearchPaper: paperEnabled,
    jobCompletion: {
      completesWhenFilesExist: paperEnabled ? ["final.mp4", "paper.pdf"] : ["final.mp4"],
      autoOpenVideoPlayer: false,
      cleanupAfterCompletion: false,
      stopAfterCompletion: true,
      readyForNextPrompt: true,
    },
    renderSpec: {
      resolution: "854x480",
      fps: 30,
      allowAlternateRenders: false,
      allowDraftRenders: false,
      finalVideoName: "final.mp4",
    },
    paperSpec: {
      enabled: paperEnabled,
      finalPdfName: "paper.pdf",
      texSourceName: "paper.tex",
      format: "pdf",
      formatter: "TinyTeX",
      maxPages: 3,
      generatedBy: "llm-only",
      useExtraSkill: false,
      saveInOutputDir: true,
    },
    audioSpec: {
      tts: ttsEnabled,
      narrationRequired: ttsEnabled,
      embedInFinalVideo: ttsEnabled,
      maintainAudioQuality: ttsEnabled,
      synchronizeWithVisuals: ttsEnabled,
    },
    logSpec: {
      liveTerminalLog: `${outputDir}/job.log`,
      appendOnly: true,
      streamRuntimeOutput: true,
    },
  };

  await fsp.writeFile(path.join(jobDir, "prompt.txt"), job.prompt, "utf-8");
  await fsp.writeFile(path.join(jobDir, "forwarded-prompt.txt"), forwardedPrompt, "utf-8");
  await fsp.writeFile(path.join(jobDir, "forward-payload.json"), JSON.stringify(payload, null, 2), "utf-8");
  appendJobLog(job, `Prepared gateway payload for ${outputDir}.`, "gateway");

  const body = JSON.stringify(payload);
  const headers = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  };
  if (config.forwardSecret) {
    headers["X-Webhook-Signature"] = crypto
      .createHmac("sha256", config.forwardSecret)
      .update(body)
      .digest("hex");
  }

  const response = await requestJson(
    config.forwardUrl,
    {
      method: config.forwardMethod,
      headers,
      timeout: config.forwardTimeoutMs,
    },
    body
  );

  await fsp.writeFile(path.join(jobDir, "forward-response.txt"), response.body || "", "utf-8");
  appendJobLog(job, "Gateway accepted the job payload.", "gateway");
  return {
    outputDir,
    responseBody: response.body,
  };
}

async function wslPathToWindows(config, wslPath) {
  const result = await runCommandDetailed("wsl.exe", ["-d", config.distro, "--", "wslpath", "-w", wslPath], rootDir);
  return result.stdout.trim();
}

async function findLatestFileRecursive(rootPath, extension) {
  const matches = [];

  async function walk(current) {
    const entries = await fsp.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && fullPath.toLowerCase().endsWith(extension.toLowerCase())) {
        const stats = await fsp.stat(fullPath).catch(() => null);
        if (stats) {
          matches.push({ fullPath, mtimeMs: stats.mtimeMs });
        }
      }
    }
  }

  await walk(rootPath);
  matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return matches[0]?.fullPath || null;
}

async function collectHermesArtifacts(config, job) {
  const wslOutputDir = `${config.outputRoot.replace(/\/$/, "")}/${job.id}`;
  const windowsOutputDir = await wslPathToWindows(config, wslOutputDir);
  const manifestPath = path.join(windowsOutputDir, "morphix-result.json");
  let manifest = null;

  try {
    manifest = JSON.parse(await fsp.readFile(manifestPath, "utf-8"));
  } catch (error) {
    manifest = null;
  }

  let exactVideo = null;
  let exactCode = null;
  let exactJson = null;
  let exactPaper = null;

  if (manifest?.video) {
    const candidate = path.isAbsolute(manifest.video)
      ? manifest.video
      : path.join(windowsOutputDir, manifest.video);
    exactVideo = candidate;
  }

  if (manifest?.code) {
    const candidate = path.isAbsolute(manifest.code)
      ? manifest.code
      : path.join(windowsOutputDir, manifest.code);
    exactCode = candidate;
  }

  if (manifest?.reportJson) {
    const candidate = path.isAbsolute(manifest.reportJson)
      ? manifest.reportJson
      : path.join(windowsOutputDir, manifest.reportJson);
    exactJson = candidate;
  }

  if (manifest?.paperPdf) {
    const candidate = path.isAbsolute(manifest.paperPdf)
      ? manifest.paperPdf
      : path.join(windowsOutputDir, manifest.paperPdf);
    exactPaper = candidate;
  }

  const knownVideoCandidates = [
    exactVideo,
    path.join(windowsOutputDir, "final.mp4"),
    path.join(windowsOutputDir, "scene.mp4"),
  ].filter(Boolean);
  const knownCodeCandidates = [
    exactCode,
    path.join(windowsOutputDir, "scene.py"),
    path.join(windowsOutputDir, "final.py"),
  ].filter(Boolean);
  const knownJsonCandidates = [
    exactJson,
    manifestPath,
    path.join(windowsOutputDir, "report.json"),
  ].filter(Boolean);
  const knownPaperCandidates = [
    exactPaper,
    path.join(windowsOutputDir, "paper.pdf"),
    path.join(windowsOutputDir, "research-paper.pdf"),
  ].filter(Boolean);
  const knownLogCandidates = [
    path.join(windowsOutputDir, "job.log"),
    path.join(windowsOutputDir, "terminal.log"),
    path.join(windowsOutputDir, "stdout.log"),
    path.join(windowsOutputDir, "gateway.log"),
  ].filter(Boolean);

  async function firstExisting(candidates) {
    for (const candidate of candidates) {
      try {
        const stats = await fsp.stat(candidate);
        if (stats.isFile()) {
          return candidate;
        }
      } catch (error) {
        continue;
      }
    }
    return null;
  }

  const latestVideo = await firstExisting(knownVideoCandidates);
  const latestCode = await firstExisting(knownCodeCandidates) || await findLatestFileRecursive(windowsOutputDir, ".py");
  const latestJson = await firstExisting(knownJsonCandidates) || await findLatestFileRecursive(windowsOutputDir, ".json");
  const latestPaper = await firstExisting(knownPaperCandidates);
  const latestLog = await firstExisting(knownLogCandidates) || await findLatestFileRecursive(windowsOutputDir, ".log");

  return {
    windowsOutputDir,
    latestVideo,
    latestCode,
    latestJson,
    latestPaper,
    latestLog,
    manifest,
  };
}

function ensureLogState(job) {
  if (!job._logState) {
    job._logState = {
      path: null,
      offset: 0,
      remainder: "",
    };
  }
  return job._logState;
}

async function streamTerminalLogUpdates(job, artifacts) {
  let logPath = artifacts.latestLog || null;
  let source = "terminal";

  if (!logPath && job._gatewayLogWindowsPath) {
    logPath = job._gatewayLogWindowsPath;
    source = "gateway";
  }

  if (!logPath) {
    return;
  }

  const state = ensureLogState(job);
  if (state.path !== logPath) {
    state.path = logPath;
    state.offset = 0;
    state.remainder = "";
    appendJobLog(job, `Tailing live gateway log: ${path.basename(logPath)}`, source);
  }

  const stats = await fsp.stat(logPath).catch(() => null);
  if (!stats || !stats.isFile()) {
    return;
  }

  if (stats.size < state.offset) {
    state.offset = 0;
    state.remainder = "";
  }

  if (stats.size === state.offset) {
    return;
  }

  const handle = await fsp.open(logPath, "r");
  try {
    const length = stats.size - state.offset;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, state.offset);
    state.offset += bytesRead;

    const chunk = state.remainder + buffer.toString("utf-8", 0, bytesRead);
    const lines = chunk.split(/\r?\n/);
    state.remainder = lines.pop() || "";

    for (const rawLine of lines) {
      const line = String(rawLine || "").trim();
      if (!line) {
        continue;
      }
      appendJobLog(job, line, source);
    }
  } finally {
    await handle.close();
  }
}

async function snapshotOutputTree(rootPath, maxDepth = 4) {
  const items = [];

  async function walk(currentPath, depth, basePath) {
    if (depth > maxDepth) {
      return;
    }

    const entries = await fsp.readdir(currentPath, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      const relativePath = path.relative(basePath, fullPath).replace(/\\/g, "/");
      if (!relativePath) {
        continue;
      }

      if (entry.isDirectory()) {
        items.push(`dir:${relativePath}`);
        await walk(fullPath, depth + 1, basePath);
      } else if (entry.isFile()) {
        items.push(`file:${relativePath}`);
      }
    }
  }

  const rootStat = await fsp.stat(rootPath).catch(() => null);
  if (!rootStat || !rootStat.isDirectory()) {
    return items;
  }

  await walk(rootPath, 0, rootPath);
  items.sort();
  return items;
}

function describeDiscoveredEntry(entry) {
  const [kind, relativePath] = String(entry).split(":");
  if (kind === "dir") {
    return `mkdir ${relativePath}`;
  }
  return `write ${relativePath}`;
}

async function getStableFileState(filePath) {
  try {
    const stats = await fsp.stat(filePath);
    if (!stats.isFile()) {
      return null;
    }
    return {
      size: stats.size,
      mtimeMs: stats.mtimeMs,
    };
  } catch (error) {
    return null;
  }
}

async function isFileArtifactReady(filePath, config) {
  if (!filePath) {
    return false;
  }

  const first = await getStableFileState(filePath);
  if (!first || first.size <= 0) {
    return false;
  }

  const quietWindowMs = Math.max(3000, Math.min(config.pollIntervalMs * 2, 8000));
  await sleep(quietWindowMs);

  const second = await getStableFileState(filePath);
  if (!second || second.size <= 0) {
    return false;
  }

  const stableSize = first.size === second.size;
  const stableMtime = first.mtimeMs === second.mtimeMs;
  if (!stableSize || !stableMtime) {
    return false;
  }

  const ageMs = Date.now() - second.mtimeMs;
  return ageMs >= quietWindowMs;
}

async function isVideoArtifactReady(artifacts, config) {
  if (!artifacts.latestVideo) {
    return false;
  }

  const first = await getStableFileState(artifacts.latestVideo);
  if (!first || first.size <= 0) {
    return false;
  }

  const quietWindowMs = Math.max(3000, Math.min(config.pollIntervalMs * 2, 8000));
  await sleep(quietWindowMs);

  const second = await getStableFileState(artifacts.latestVideo);
  if (!second || second.size <= 0) {
    return false;
  }

  const stableSize = first.size === second.size;
  const stableMtime = first.mtimeMs === second.mtimeMs;
  if (!stableSize || !stableMtime) {
    return false;
  }

  const ageMs = Date.now() - second.mtimeMs;
  if (ageMs < quietWindowMs) {
    return false;
  }

  if (artifacts.manifest && typeof artifacts.manifest.valid === "boolean") {
    return artifacts.manifest.valid;
  }

  return true;
}

async function areRequiredHermesArtifactsReady(artifacts, config, paperEnabled) {
  if (!(await isVideoArtifactReady(artifacts, config))) {
    return false;
  }

  if (!paperEnabled) {
    return true;
  }

  return isFileArtifactReady(artifacts.latestPaper, config);
}

async function waitForHermesArtifacts(config, job) {
  const start = Date.now();
  let lastArtifacts = null;
  let previousTree = [];
  let waitingForStableFinal = false;
  let waitingForStablePaper = false;
  const paperEnabled = isPaperEnabled(job);

  while (Date.now() - start < config.pollTimeoutMs) {
    ensureNotCancelled(job);
    const artifacts = await collectHermesArtifacts(config, job);
    lastArtifacts = artifacts;
    await streamTerminalLogUpdates(job, artifacts);
    const tree = await snapshotOutputTree(artifacts.windowsOutputDir);

    if (tree.length > 0) {
      const previousSet = new Set(previousTree);
      const discovered = tree.filter((entry) => !previousSet.has(entry));
      for (const entry of discovered.slice(0, 50)) {
        appendJobLog(job, describeDiscoveredEntry(entry), "wsl");
      }
      if (discovered.length > 50) {
        appendJobLog(job, `... ${discovered.length - 50} more filesystem updates detected`, "wsl");
      }
      previousTree = tree;
    }

    if (artifacts.latestVideo && !waitingForStableFinal) {
      appendJobLog(job, `Detected candidate final video: ${path.basename(artifacts.latestVideo)}`, "wsl");
      appendJobLog(job, "Waiting for the final render to fully settle before publishing it.", "bridge");
      waitingForStableFinal = true;
    }

    if (paperEnabled && artifacts.latestPaper && !waitingForStablePaper) {
      appendJobLog(job, `Detected candidate companion paper: ${path.basename(artifacts.latestPaper)}`, "wsl");
      appendJobLog(job, "Waiting for the companion PDF to fully settle before publishing artifacts.", "bridge");
      waitingForStablePaper = true;
    }

    if (await areRequiredHermesArtifactsReady(artifacts, config, paperEnabled)) {
      appendJobLog(
        job,
        paperEnabled
          ? "Final render and companion paper are stable and ready to publish."
          : "Final render is stable and ready to publish.",
        "bridge"
      );
      return artifacts;
    }
    await sleep(config.pollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for Hermes artifacts under ${lastArtifacts?.windowsOutputDir || config.outputRoot}.`
  );
}

async function buildHermesJob(job) {
  resetStages(job);
  job.status = "running";
  appendJobLog(job, `Job created for prompt: ${job.prompt}`, "job");

  const config = buildBridgeConfig();
  const paperEnabled = isPaperEnabled(job);
  const jobDir = path.join(generatedRoot, job.id);
  const renderDir = path.join(publicRenderRoot, job.id);
  await fsp.mkdir(jobDir, { recursive: true });
  await fsp.mkdir(renderDir, { recursive: true });

  if (config.gatewayLogPath) {
    try {
      const gatewayLogWindowsPath = await wslPathToWindows(config, config.gatewayLogPath);
      job._gatewayLogWindowsPath = gatewayLogWindowsPath;
      const stats = await fsp.stat(gatewayLogWindowsPath).catch(() => null);
      job._logState = {
        path: gatewayLogWindowsPath,
        offset: stats?.isFile() ? stats.size : 0,
        remainder: "",
      };
      appendJobLog(job, `Watching shared gateway log: ${config.gatewayLogPath}`, "bridge");
    } catch (error) {
      appendJobLog(job, `Unable to attach shared gateway log: ${error.message}`, "bridge");
    }
  }

  markStage(job, "prompt", "running", "Packaging the prompt for the WSL Hermes agent.");
  await sleep(120);
  ensureNotCancelled(job);
  markStage(job, "prompt", "completed", "Prompt packaged for Hermes.");

  markStage(job, "dispatch", "running", "Checking Hermes bridge configuration.");
  ensureBridgeConfig(config);
  ensureNotCancelled(job);
  markStage(job, "dispatch", "completed", `Dispatch target: ${config.distro}${config.workdir ? ` in ${config.workdir}` : ""}.`);

  markStage(job, "agent", "running", config.forwardUrl
    ? "Forwarding the prompt to the running Hermes agent."
    : "Hermes is generating Manim code and rendering the video in WSL.");

  if (config.forwardUrl) {
    const forwardResult = await forwardPromptToHermes(config, job, jobDir);
    ensureNotCancelled(job);
    markStage(job, "agent", "completed", `Prompt forwarded to Hermes. Output directory: ${forwardResult.outputDir}`);
  } else {
    const commandResult = await runHermesInWsl(config, job, jobDir);
    ensureNotCancelled(job);
    await fsp.writeFile(path.join(jobDir, "hermes-stdout.log"), commandResult.stdout || "", "utf-8");
    await fsp.writeFile(path.join(jobDir, "hermes-stderr.log"), commandResult.stderr || "", "utf-8");
    markStage(job, "agent", "completed", "Hermes completed its WSL generation run.");
  }

  markStage(job, "fetch", "running", config.forwardUrl
    ? "Waiting for the running Hermes agent to finish and publish artifacts."
    : "Fetching the rendered artifacts back from WSL.");
  appendJobLog(job, "Monitoring the WSL output directory for new render artifacts.", "bridge");
  const artifacts = config.forwardUrl
    ? await waitForHermesArtifacts(config, job)
    : await collectHermesArtifacts(config, job);
  ensureNotCancelled(job);
  const renderManifest = {
    mode: "video",
    prompt: job.prompt,
    generatedAt: new Date().toISOString(),
    scenePath: null,
    videoAsset: null,
    paperAsset: null,
    paperPath: null,
    rendererNotes: [],
  };

  let code = "";
  let validation = {
    valid: true,
    summary: "Hermes agent completed without a local Morphix validation step.",
    issues: [],
    warnings: [],
    judge: "hermes-agent@wsl",
  };

  if (artifacts.latestCode) {
    const copiedCodePath = path.join(jobDir, "hermes_scene.py");
    await fsp.copyFile(artifacts.latestCode, copiedCodePath);
    code = await fsp.readFile(copiedCodePath, "utf-8");
    renderManifest.scenePath = copiedCodePath;
  }

  if (artifacts.latestJson) {
    try {
      const payload = JSON.parse(await fsp.readFile(artifacts.latestJson, "utf-8"));
      validation = {
        ...validation,
        ...payload,
      };
    } catch (error) {
      validation.warnings.push(`Unable to parse Hermes JSON metadata: ${error.message}`);
    }
  }

  if (!artifacts.latestVideo) {
    throw new Error(`Hermes finished but no rendered video was found in ${artifacts.windowsOutputDir}.`);
  }

  if (paperEnabled && !artifacts.latestPaper) {
    throw new Error(`Hermes finished but no companion paper.pdf was found in ${artifacts.windowsOutputDir}.`);
  }

  const finalVideoPath = path.join(renderDir, "scene.mp4");
  await fsp.copyFile(artifacts.latestVideo, finalVideoPath);
  appendJobLog(job, `Copied final render into website assets: ${finalVideoPath}`, "bridge");
  renderManifest.videoAsset = `/renders/${job.id}/scene.mp4`;

  if (paperEnabled && artifacts.latestPaper) {
    const finalPaperPath = path.join(renderDir, "paper.pdf");
    await fsp.copyFile(artifacts.latestPaper, finalPaperPath);
    appendJobLog(job, `Copied companion paper into website assets: ${finalPaperPath}`, "bridge");
    renderManifest.paperAsset = `/renders/${job.id}/paper.pdf`;
    renderManifest.paperPath = finalPaperPath;
  }
  renderManifest.rendererNotes = [
    paperEnabled
      ? "Video and companion paper fetched from the Hermes WSL output directory."
      : "Video fetched from the Hermes WSL output directory.",
    `Source directory: ${artifacts.windowsOutputDir}`,
  ];
  if (artifacts.manifest) {
    renderManifest.rendererNotes.push("Artifact selection used the Hermes manifest when available.");
  } else {
    renderManifest.rendererNotes.push("Artifact selection used exact expected filenames before falling back to recursive search.");
  }
  markStage(job, "fetch", "completed", "WSL artifacts fetched successfully.");

  markStage(job, "renderer", "running", "Publishing the fetched video to the website.");
  await sleep(80);
  ensureNotCancelled(job);
  markStage(job, "renderer", "completed", "Hermes render published to the website.");

  job.status = "completed";
  job.result = {
    source: "hermes-agent@wsl",
    code,
    validation,
    renderManifest,
    bridge: {
      distro: config.distro,
      windowsOutputDir: artifacts.windowsOutputDir,
    },
  };

  return getJobSnapshot(job);
}

module.exports = {
  buildHermesJob,
  getJobSnapshot,
};
