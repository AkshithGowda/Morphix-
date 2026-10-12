# Morphix

Morphix is now a website shell around a Hermes agent running inside WSL Ubuntu on the same machine.

1. A user submits a math animation prompt through the website.
2. The Node server dispatches that prompt into a Hermes run inside WSL.
3. Hermes generates Manim code and renders the video inside the WSL environment.
4. Morphix fetches the rendered artifacts back to Windows and serves the final video inside the site.

The older `src/pipeline.js` flow is still present in the repository as a demo/spoof implementation, but the live website runtime now routes through the Hermes bridge in `src/runtime.js` and `src/hermesBridge.js`.

## Run locally

```bash
npm run dev
```

Then open [http://127.0.0.1:3000](http://127.0.0.1:3000).

## Hermes WSL bridge configuration

These variables are required for the live website flow:

```bash
HERMES_WSL_DISTRO=Ubuntu
HERMES_WSL_WORKDIR=/home/your-user/hermes-agent
HERMES_WSL_OUTPUT_DIR=/home/your-user/morphix-renders
HERMES_WSL_COMMAND_TEMPLATE=python3 run_morphix_job.py --job-id __JOB_ID__ --prompt-b64 __PROMPT_B64__ --output-dir __OUTPUT_DIR__
```

If you want Morphix to only forward prompts to a Hermes agent that is already running, use forward mode instead of command mode:

```bash
HERMES_WSL_DISTRO=Ubuntu
HERMES_WSL_WORKDIR=/home/vrepo
HERMES_WSL_OUTPUT_DIR=/home/vrepo/render
HERMES_FORWARD_URL=http://127.0.0.1:8787/morphix
HERMES_FORWARD_METHOD=POST
HERMES_FORWARD_SECRET=your-hermes-webhook-secret
HERMES_FORWARD_TIMEOUT_MS=15000
HERMES_FETCH_TIMEOUT_MS=900000
HERMES_FETCH_INTERVAL_MS=2000
```

In forward mode, Morphix does not spawn `hermes chat` at all. It sends a JSON payload to `HERMES_FORWARD_URL` and waits for the running Hermes service to place artifacts into the exact job folder under `HERMES_WSL_OUTPUT_DIR/<job-id>/`.

If `HERMES_FORWARD_SECRET` is set, Morphix sends the Hermes-compatible generic webhook signature header:

- `X-Webhook-Signature: <hex hmac sha256 of raw request body>`

So the same secret must be configured on the Hermes webhook route or global webhook platform config.

Forward payload shape:

```json
{
  "jobId": "mx_abc123",
  "prompt": "Explain Fourier series\n\nMorphix delivery constraints:\n1. The final video must be no longer than 30 seconds.\n2. The video must stay mathematically accurate and visually clear even within that shorter duration.\n3. Prioritize the core explanation and avoid filler or decorative scenes.\n4. Do not generate or save any report text file; only produce the rendered video and the main Manim code file.",
  "originalPrompt": "Explain Fourier series",
  "promptBase64": "...",
  "outputDir": "/home/vrepo/render/mx_abc123",
  "workdir": "/home/vrepo",
  "source": "morphix",
  "requestedAt": "2026-04-09T12:34:56.000Z",
  "maxDurationSeconds": 30,
  "requireMathAccuracy": true,
  "disallowReportFile": true,
  "jobCompletion": {
    "completesWhenFilesExist": ["final.mp4"],
    "autoOpenVideoPlayer": false,
    "cleanupAfterCompletion": false,
    "stopAfterCompletion": true,
    "readyForNextPrompt": true
  },
  "renderSpec": {
    "resolution": "854x480",
    "fps": 30,
    "allowAlternateRenders": false,
    "allowDraftRenders": false,
    "finalVideoName": "final.mp4"
  }
}
```

Morphix also augments the forwarded prompt with these delivery constraints:

- final video must be `<= 30s`
- math must stay accurate and visually clear
- render only one production output at exactly `854x480` and `30 fps`
- do not generate draft, alternate-fps, or alternate-resolution outputs such as `480p15`, `480p30`, or `720p`
- do not generate a report text file
- do not auto-open or preview the video in WSL
- do not run post-render cleanup commands such as deleting `media/` or `partial_movie_files/`
- treat the job as finished once `final.mp4` exists and is ready, then return control to the running Hermes gateway for the next prompt

`HERMES_WSL_COMMAND_TEMPLATE` supports these placeholders:

- `__JOB_ID__`
- `__PROMPT__`
- `__PROMPT_B64__`
- `__OUTPUT_DIR__`
- `__WORKDIR__`

Morphix creates an output folder inside `HERMES_WSL_OUTPUT_DIR` for each job and expects Hermes to place artifacts there. The bridge then scans that job folder recursively and fetches the latest:

- `.mp4` as the rendered website video
- `.py` as the generated Manim scene code
- `.json` as optional structured metadata/report
- `.txt` as optional plain-text report

For the most reliable matching between prompt and fetched video, Hermes should write artifacts into the exact job folder it receives via `__OUTPUT_DIR__`, not just into a generic topic folder under `~/render/`.

Best practice contract for Hermes:

- write the final video to `__OUTPUT_DIR__/final.mp4`
- write the Manim source to `__OUTPUT_DIR__/scene.py`
- optionally write `__OUTPUT_DIR__/morphix-result.json`

Recommended `morphix-result.json` shape:

```json
{
  "jobId": "mx_abc123",
  "prompt": "Explain Fourier series",
  "video": "final.mp4",
  "code": "scene.py"
}
```

The Morphix bridge now prefers, in order:

1. paths from `morphix-result.json`
2. exact filenames inside the job folder such as `final.mp4`
3. recursive fallback search as a last resort

This is much safer than trying to infer the correct render from prompt-named folders like `~/render/fourier series/`, especially when multiple jobs may exist.

Example WSL job layout:

```text
/home/your-user/morphix-renders/
  mx_ab12cd34ef56/
    scene.mp4
    scene.py
    report.json
```

## Notes

- The website runtime uses `src/runtime.js`, which currently delegates to `src/hermesBridge.js`.
- Hermes is launched through `wsl.exe`, so it must be runnable from Windows.
- The bridge converts the WSL output path back to a Windows path with `wslpath -w` before copying the artifacts into `public/renders/`.
- The fetched video is published at `/renders/<job-id>/scene.mp4`.

## Project structure

- `server.js` - HTTP server and API routes
- `src/runtime.js` - live website runtime entry point
- `src/hermesBridge.js` - dispatch to WSL Hermes, collect artifacts, and publish the video
- `src/pipeline.js` - legacy/spoof pipeline kept for demo purposes
- `public/` - Morphix frontend
- `generated/` - prompt files, fetched scene code, and Hermes logs created at runtime
