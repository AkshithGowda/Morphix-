const http = require("http");
const fsp = require("fs/promises");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const { buildVisualizationJob, getJobSnapshot } = require("./src/runtime");

loadDotEnv();

const host = "127.0.0.1";
const port = Number(process.env.PORT || 3000);
const rootDir = __dirname;
const publicDir = path.join(rootDir, "public");
const jobs = new Map();

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

function loadDotEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const contents = fs.readFileSync(envPath, "utf-8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    value = value.replace(/^['"]|['"]$/g, "");

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload, null, 2));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

async function serveFile(res, pathname) {
  const resolvedPath = path.normalize(path.join(publicDir, pathname));
  if (!resolvedPath.startsWith(publicDir)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  const ext = path.extname(resolvedPath);
  const contentType = contentTypes[ext] || "application/octet-stream";

  try {
    const buffer = await fsp.readFile(resolvedPath);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    });
    res.end(buffer);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendJson(res, 404, { error: "File not found" });
      return;
    }

    sendJson(res, 500, { error: "Unable to read file" });
  }
}

function createJobId() {
  return `mx_${crypto.randomBytes(6).toString("hex")}`;
}

function listPastRenders() {
  return [...jobs.values()]
    .filter((job) => job.status === "completed" && job.result?.renderManifest?.videoAsset)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((job) => ({
      id: job.id,
      prompt: job.prompt,
      createdAt: job.createdAt,
      videoAsset: job.result.renderManifest.videoAsset,
      paperAsset: job.result.renderManifest.paperAsset || null,
    }));
}

async function handleCreateJob(req, res) {
  try {
    const body = await readBody(req);
    const prompt = String(body.prompt || "").trim();
    const ttsEnabled = body.ttsEnabled !== false;
    const paperEnabled = body.paperEnabled !== false;

    if (!prompt) {
      sendJson(res, 400, { error: "A math visualization prompt is required." });
      return;
    }

    const jobId = createJobId();
    const jobState = {
      id: jobId,
      createdAt: new Date().toISOString(),
      status: "queued",
      prompt,
      options: {
        ttsEnabled,
        paperEnabled,
      },
      stages: [],
      result: null,
      error: null,
      cancelRequested: false,
    };

    jobs.set(jobId, jobState);

    buildVisualizationJob(jobState)
      .then((snapshot) => {
        const current = jobs.get(jobId);
        if (current?.status === "cancelled") {
          return;
        }
        jobs.set(jobId, snapshot);
      })
      .catch((error) => {
        if (jobState.status === "cancelled") {
          return;
        }
        jobState.status = "failed";
        jobState.error = error.message || "Unknown pipeline error";
        const runningStage = jobState.stages.find((stage) => stage.status === "running");
        if (runningStage) {
          runningStage.status = "failed";
          runningStage.details = jobState.error;
        }
      });

    sendJson(res, 202, { jobId, status: "queued" });
  } catch (error) {
    sendJson(res, 400, { error: "Invalid JSON payload." });
  }
}

function handleGetJob(res, jobId) {
  const job = jobs.get(jobId);
  if (!job) {
    sendJson(res, 404, { error: "Job not found." });
    return;
  }

  sendJson(res, 200, getJobSnapshot(job));
}

function handleCancelJob(res, jobId) {
  const job = jobs.get(jobId);
  if (!job) {
    sendJson(res, 404, { error: "Job not found." });
    return;
  }

  if (job.status !== "queued" && job.status !== "running") {
    sendJson(res, 409, { error: "Only queued or running jobs can be stopped." });
    return;
  }

  job.cancelRequested = true;
  job.status = "cancelled";
  job.error = "Generation stopped by the user.";
  const runningStage = job.stages.find((stage) => stage.status === "running");
  if (runningStage) {
    runningStage.status = "failed";
    runningStage.details = "Stopped by the user.";
  }

  sendJson(res, 200, getJobSnapshot(job));
}

async function ensurePublicDirectories() {
  await fsp.mkdir(path.join(rootDir, "generated"), { recursive: true });
  await fsp.mkdir(path.join(publicDir, "renders"), { recursive: true });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
  const pathname = requestUrl.pathname;

  if (req.method === "POST" && pathname === "/api/jobs") {
    await handleCreateJob(req, res);
    return;
  }

  if (req.method === "GET" && pathname === "/api/renders") {
    sendJson(res, 200, { renders: listPastRenders() });
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/api/jobs/")) {
    const jobId = pathname.split("/").pop();
    handleGetJob(res, jobId);
    return;
  }

  if (req.method === "POST" && pathname.startsWith("/api/jobs/") && pathname.endsWith("/cancel")) {
    const parts = pathname.split("/");
    const jobId = parts[3];
    handleCancelJob(res, jobId);
    return;
  }

  if (req.method === "GET") {
    const filePath = pathname === "/" ? "index.html" : pathname.slice(1);
    await serveFile(res, filePath);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

ensurePublicDirectories()
  .then(() => {
    server.listen(port, host, () => {
      console.log(`Morphix running at http://${host}:${port}`);
    });
  })
  .catch((error) => {
    console.error("Unable to start Morphix:", error);
    process.exitCode = 1;
  });
