const fsp = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");

const rootDir = path.join(__dirname, "..");
const generatedRoot = path.join(rootDir, "generated");
const publicRenderRoot = path.join(rootDir, "public", "renders");

const modelRequestTimeoutMs = Number(process.env.MODEL_TIMEOUT_MS || 0);
const syntaxRepairAttempts = Number(process.env.SYNTAX_REPAIR_ATTEMPTS || 1);
const validationIterations = Number(process.env.VALIDATION_ITERATIONS || 12);

const stageBlueprint = [
  ["prompt", "Understanding prompt"],
  ["interpreter", "Planning animation"],
  ["dsl", "Building scene DSL"],
  ["codegen", "Rendering deterministic Manim code"],
  ["validator", "Validating math, layout, and flow"],
  ["renderer", "Rendering video"],
];

const allowedSceneTypes = new Set([
  "intro_title",
  "graph_plot",
  "point_motion",
  "tangent_visualization",
  "equation_display",
  "equation_transform",
  "geometric_visual",
  "explanation_text",
  "highlight",
]);

const morphixSkill = {
  planningRules: [
    "One new mathematical idea per scene.",
    "Prefer visual explanation over long prose.",
    "Every scene must have a clear teaching purpose.",
    "Plans must preserve the user's real topic, theorem, graph, or proof goal.",
    "For incomplete prompts, infer the most educational mathematically correct interpretation.",
  ],
  visualRules: [
    "Keep titles at the top edge and diagrams in the central or lower frame.",
    "Do not place dense text on top of graphs or geometry.",
    "At most two short text blocks should be visible at once.",
    "Use color consistently to express mathematical relationships.",
    "Fade out or transform old content before unrelated new content appears.",
    "Avoid decorative filler shapes unless they are mathematically meaningful.",
    "Use readable equations and labels separated from the main visual.",
    "Make the scene feel like a clear mathematical explainer, not random objects appearing and disappearing.",
  ],
  codeRules: [
    "Return executable Python for Manim Community Edition.",
    "Use exactly one Scene subclass named MorphixScene.",
    "Use current Manim APIs; avoid deprecated play-method patterns.",
    "Use precise geometry and accurate plotted functions.",
    "Avoid coordinate-space mistakes and keep all objects fully on screen.",
  ],
  validationRules: [
    "Reject mathematically incorrect visuals.",
    "Reject scenes that do not really correspond to the prompt.",
    "Reject overlap, clipping, unreadable text, or weak explanation flow.",
    "Reject scenes with warnings if they still indicate layout or pedagogy problems.",
  ],
};

function getJobSnapshot(job) {
  return JSON.parse(JSON.stringify(job));
}

function resetStages(job) {
  job.stages = stageBlueprint.map(([id, label]) => ({
    id,
    label,
    status: "pending",
    details: "",
  }));
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
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePrompt(prompt) {
  return String(prompt || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function detectTopic(prompt) {
  const normalized = normalizePrompt(prompt);

  if (/(pythagoras|pythagorean)/.test(normalized)) return "pythagorean_theorem";
  if (/fourier/.test(normalized)) return "fourier_series";
  if (/(derivative|differentiat|tangent|slope)/.test(normalized)) return "derivative";
  if (/(integral|area under|riemann)/.test(normalized)) return "integral";
  if (/matrix|linear transformation|transformation/.test(normalized)) return "transformation";
  if (/circle|radius|diameter/.test(normalized)) return "circle_geometry";
  return "generic";
}

function extractConcept(prompt) {
  const topic = detectTopic(prompt);
  const conceptMap = {
    pythagorean_theorem: "Pythagorean Theorem",
    fourier_series: "Fourier Series",
    derivative: "Derivative as Slope",
    integral: "Integral as Accumulation",
    transformation: "Linear Transformation",
    circle_geometry: "Circle Geometry",
    generic: "Mathematical Concept",
  };
  return conceptMap[topic] || "Mathematical Concept";
}

function extractEquation(prompt) {
  const topic = detectTopic(prompt);
  if (topic === "pythagorean_theorem") return "a^2 + b^2 = c^2";
  if (topic === "fourier_series") return "f(x) = a_0/2 + \\sum_{n=1}^{\\infty}(a_n\\cos nx + b_n\\sin nx)";
  if (topic === "derivative") {
    if (/x\^2/.test(prompt)) return "f(x) = x^2,\\quad f'(x) = 2x";
    return "f'(x) = \\lim_{h\\to 0}\\frac{f(x+h)-f(x)}{h}";
  }
  if (topic === "integral") return "\\int_a^b f(x)\\,dx";

  const equationWithEquality = String(prompt || "").match(
    /([A-Za-z]\s*\([^)]*\)\s*=\s*.+|[A-Za-z]\s*=\s*.+)/i,
  );
  if (equationWithEquality) {
    return equationWithEquality[1]
      .split(/\s+(?:as|where|when|while|because|showing|with|using|for)\s+/i)[0]
      .replace(/[.,;:]$/, "")
      .trim();
  }

  const focusedMatch = String(prompt || "").match(/((?:sin|cos|tan)\s*\([^)]*\)|x\^2|x\^3|e\^x)/i);
  if (focusedMatch) {
    return focusedMatch[1].trim();
  }

  return "";
}

function buildPromptSummary(prompt) {
  return {
    topic: detectTopic(prompt),
    concept: extractConcept(prompt),
    equation: extractEquation(prompt),
  };
}

function isGraphFriendlyEquation(equation) {
  const compact = String(equation || "").toLowerCase();
  return /x|\bsin\b|\bcos\b|\btan\b|e\^x|exp\(x\)/.test(compact);
}

function buildGoal(topic, concept) {
  const goals = {
    pythagorean_theorem: "Show geometrically why the areas on the legs combine to the area on the hypotenuse.",
    fourier_series: "Show how simple harmonics combine to approximate a periodic waveform.",
    derivative: "Show derivative as a local slope and rate of change on a graph.",
    integral: "Show an integral as signed area accumulating under a curve.",
    transformation: "Show how a transformation moves geometry while preserving mathematical structure.",
    circle_geometry: "Explain the key circle relationship visually with clean geometry.",
    generic: `Explain ${concept.toLowerCase()} using a sequence of clean mathematical visuals.`,
  };
  return goals[topic] || goals.generic;
}

function scene(type, description, elements, animation, duration) {
  return { type, description, elements, animation, duration };
}

function buildTeachingFlow(summary) {
  if (summary.topic === "pythagorean_theorem") {
    return [
      scene("intro_title", "Introduce the Pythagorean theorem as a geometric area relationship in a right triangle.", ["Pythagorean Theorem"], "fade_in", 2.5),
      scene("geometric_visual", "Draw a clean right triangle, mark the right angle, and label the two legs as a and b and the hypotenuse as c.", ["right triangle", "side labels", "right angle"], "draw", 4),
      scene("equation_display", "Display a^2 + b^2 = c^2 only after the labeled triangle is already visible and understandable.", ["a^2 + b^2 = c^2"], "write", 3),
      scene("geometric_visual", "Construct one square externally on each side of the triangle so no square overlaps another and every area is readable.", ["square on a", "square on b", "square on c"], "draw", 5),
      scene("highlight", "Compare the areas of the two smaller squares against the larger square using matching colors and clean emphasis.", ["area comparison", "matching colors", "sum of areas"], "highlight", 4),
      scene("equation_transform", "Work through the 3-4-5 example step by step so the numerical substitution is clearly tied to the geometry.", ["3^2 + 4^2 = 5^2"], "transform", 3),
      scene("explanation_text", "Close by stating that the area built on the hypotenuse equals the sum of the areas built on the legs.", ["Area on c equals area on a plus area on b."], "fade_in", 3),
    ];
  }

  if (summary.topic === "fourier_series") {
    return [
      scene("intro_title", "Introduce Fourier series as a way to build a complicated periodic signal from simple oscillations.", ["Fourier Series"], "fade_in", 2.5),
      scene("graph_plot", "Plot a single sine wave on labeled axes as the first building block.", ["axes", "base sine wave"], "draw", 4),
      scene("highlight", "Add the third harmonic and show how the combined wave changes shape without cluttering the frame.", ["third harmonic", "combined wave"], "transform", 4),
      scene("highlight", "Add the fifth harmonic so the audience sees the approximation become sharper and more square-like.", ["fifth harmonic", "partial sum"], "transform", 4),
      scene("equation_display", "Show the Fourier series formula in a readable math block separated from the graph.", [summary.equation || "Fourier series equation"], "write", 3),
      scene("graph_plot", "Compare the partial sum to a square-wave target using distinct colors and clearly separated labels.", ["partial sum", "target wave"], "draw", 5),
      scene("explanation_text", "Wrap up by stating that repeated harmonics combine to approximate the target waveform.", ["Harmonics add together to approximate a complex periodic function."], "fade_in", 3),
    ];
  }

  if (summary.topic === "derivative") {
    return [
      scene("intro_title", "Introduce derivative as a visual notion of slope at a point on a curve.", ["Derivative as Slope"], "fade_in", 2.5),
      scene("graph_plot", "Plot the requested function on coordinate axes and keep labels outside the curve.", ["axes", summary.equation || "graph of the function"], "draw", 4),
      scene("point_motion", "Move a highlighted point along the curve so the viewer tracks where the slope is being measured.", ["point on curve"], "move_along_curve", 4),
      scene("tangent_visualization", "Show a tangent line at the moving point and make the local slope idea visually obvious.", ["tangent line", "slope label"], "transform", 5),
      scene("equation_display", "Connect the visual slope to derivative notation and, when possible, the explicit derivative formula.", [summary.equation || "f'(x)"], "write", 3),
      scene("explanation_text", "State clearly that the derivative gives the instantaneous rate of change at each point.", ["The derivative tells us the instantaneous slope of the graph."], "fade_in", 3),
    ];
  }

  if (summary.topic === "integral") {
    return [
      scene("intro_title", "Introduce the integral as accumulated area under a curve.", ["Integral as Area"], "fade_in", 2.5),
      scene("graph_plot", "Plot the curve and mark the interval of integration on the x-axis.", ["axes", "curve"], "draw", 4),
      scene("highlight", "Shade the area under the curve on the chosen interval so the geometric meaning is obvious.", ["area under curve", "interval"], "highlight", 5),
      scene("equation_display", "Show the matching integral notation in a separate readable location.", [summary.equation || "\\int_a^b f(x)\\,dx"], "write", 3),
      scene("explanation_text", "Explain that the integral adds many thin slices into one total signed area.", ["An integral accumulates many tiny contributions into one total area."], "fade_in", 3),
    ];
  }

  return [
    scene("intro_title", "Introduce the concept clearly.", [summary.concept], "fade_in", 2.5),
    scene(
      isGraphFriendlyEquation(summary.equation) ? "graph_plot" : "equation_display",
      isGraphFriendlyEquation(summary.equation)
        ? "Set up the axes and draw the main function or relationship from the prompt."
        : "State the main equation or relationship.",
      isGraphFriendlyEquation(summary.equation)
        ? ["axes", summary.equation || summary.concept]
        : [summary.equation || summary.concept],
      "draw",
      4,
    ),
    scene("equation_display", "Show the key equation or symbolic relationship cleanly.", [summary.equation || summary.concept], "write", 3),
    scene("explanation_text", "Summarize the main idea succinctly.", [`${summary.concept} explained through the requested mathematical relationship.`], "fade_in", 3),
  ];
}

function buildInterpreterFallback(prompt) {
  const summary = buildPromptSummary(prompt);
  return {
    originalPrompt: prompt,
    topic: summary.topic,
    concept: summary.concept,
    equation: summary.equation,
    goal: buildGoal(summary.topic, summary.concept),
    scenes: buildTeachingFlow(summary),
  };
}

function buildSkillText(section) {
  return (morphixSkill[section] || []).join(" ");
}

function stripCodeFences(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/^```(?:json|python)?\s*([\s\S]*?)```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function normalizeAzureBaseUrl(baseUrl) {
  if (!baseUrl) return "";
  try {
    const parsed = new URL(baseUrl);
    return parsed.origin;
  } catch (error) {
    return String(baseUrl)
      .replace(/\/$/, "")
      .replace(/\/openai\/deployments\/.*$/i, "")
      .replace(/\/openai\/v1.*$/i, "")
      .replace(/\/openai.*$/i, "");
  }
}

function buildAzureChatCompletionsUrl(provider) {
  const apiVersion = provider.apiVersion || "2024-10-21";
  return `${provider.baseUrl}/openai/deployments/${encodeURIComponent(provider.model)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
}

function resolveGenerationProvider() {
  if (process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_BASE_URL && process.env.AZURE_OPENAI_MODEL) {
    return {
      type: "azure-openai",
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      baseUrl: normalizeAzureBaseUrl(process.env.AZURE_OPENAI_BASE_URL),
      model: process.env.AZURE_OPENAI_MODEL,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || "2024-10-21",
    };
  }

  if (process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_MODEL) {
    return {
      type: "openrouter",
      apiKey: process.env.OPENROUTER_API_KEY,
      baseUrl: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
      model: process.env.OPENROUTER_MODEL,
      appName: process.env.OPENROUTER_APP_NAME || "Morphix",
      appUrl: process.env.OPENROUTER_APP_URL || "http://127.0.0.1:3000",
    };
  }

  if (process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL) {
    return {
      type: "openai",
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      model: process.env.OPENAI_MODEL,
    };
  }

  if (process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL) {
    return {
      type: "gemini",
      apiKey: process.env.GEMINI_API_KEY,
      baseUrl: process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta",
      model: process.env.GEMINI_MODEL,
    };
  }

  if (process.env.GROQ_API_KEY && process.env.GROQ_MODEL) {
    return {
      type: "groq",
      apiKey: process.env.GROQ_API_KEY,
      baseUrl: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
      model: process.env.GROQ_MODEL,
    };
  }

  return null;
}

function resolveValidationProvider() {
  if (process.env.GROQ_API_KEY && process.env.GROQ_MODEL) {
    return {
      type: "groq",
      apiKey: process.env.GROQ_API_KEY,
      baseUrl: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
      model: process.env.GROQ_MODEL,
    };
  }

  return resolveGenerationProvider();
}

async function callJson(url, options) {
  const controller = new AbortController();
  const useTimeout = Number.isFinite(modelRequestTimeoutMs) && modelRequestTimeoutMs > 0;
  const timeout = useTimeout ? setTimeout(() => controller.abort(), modelRequestTimeoutMs) : null;

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${response.status} ${text}`);
    }
    return response.json();
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function normalizeMessages(messages) {
  return messages.map((message) => ({
    role: message.role,
    content: String(message.content || ""),
  }));
}

async function callChatModel(provider, messages, temperature = 0.2) {
  const normalized = normalizeMessages(messages);

  if (provider.type === "azure-openai") {
    const payload = await callJson(buildAzureChatCompletionsUrl(provider), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": provider.apiKey,
      },
      body: JSON.stringify({
        messages: normalized,
        temperature,
        max_tokens: 2400,
      }),
    });
    return payload.choices?.[0]?.message?.content?.trim() || "";
  }

  if (provider.type === "gemini") {
    const system = normalized.find((message) => message.role === "system")?.content || "";
    const contents = normalized
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      }));

    const payload = await callJson(
      `${provider.baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(provider.model)}:generateContent?key=${encodeURIComponent(provider.apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: system ? { parts: [{ text: system }] } : undefined,
          contents,
          generationConfig: { temperature },
        }),
      },
    );

    return payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n").trim() || "";
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${provider.apiKey}`,
  };
  if (provider.type === "openrouter") {
    headers["HTTP-Referer"] = provider.appUrl;
    headers["X-Title"] = provider.appName;
  }

  const payload = await callJson(`${provider.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: provider.model,
      messages: normalized,
      temperature,
      max_tokens: 2400,
    }),
  });

  const content = payload.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === "string" ? part : part.text || "")).join("\n").trim();
  }
  return String(content || "").trim();
}

function normalizePlan(rawPlan, fallback) {
  const shouldUseCuratedScenes = fallback.topic !== "generic";
  const scenes = shouldUseCuratedScenes
    ? fallback.scenes
    : (Array.isArray(rawPlan?.scenes) && rawPlan.scenes.length > 0 ? rawPlan.scenes : fallback.scenes);
  return {
    originalPrompt: fallback.originalPrompt,
    topic: String(fallback.topic || rawPlan?.topic || "generic"),
    concept: fallback.concept,
    equation: fallback.equation,
    goal: String(shouldUseCuratedScenes ? fallback.goal : (rawPlan?.goal || fallback.goal || "")),
    scenes: scenes
      .map((sceneEntry, index) => ({
        type: allowedSceneTypes.has(sceneEntry?.type) ? sceneEntry.type : fallback.scenes[Math.min(index, fallback.scenes.length - 1)].type,
        description: String(sceneEntry?.description || fallback.scenes[Math.min(index, fallback.scenes.length - 1)].description || "Explain the next idea clearly."),
        elements: Array.isArray(sceneEntry?.elements)
          ? sceneEntry.elements.slice(0, 3).map((entry) => String(entry))
          : fallback.scenes[Math.min(index, fallback.scenes.length - 1)].elements,
        animation: String(sceneEntry?.animation || fallback.scenes[Math.min(index, fallback.scenes.length - 1)].animation || "fade_in"),
        duration: Math.max(1.5, Math.min(8, Number(sceneEntry?.duration) || fallback.scenes[Math.min(index, fallback.scenes.length - 1)].duration || 3)),
      }))
      .slice(0, 10),
  };
}

async function interpretPrompt(prompt) {
  const fallback = buildInterpreterFallback(prompt);
  const provider = resolveGenerationProvider();
  if (!provider) {
    return fallback;
  }

  const messages = [
    {
      role: "system",
      content: [
        "You are a mathematical animation planner.",
        "Your job is NOT to write code.",
        "Convert the prompt into a strict JSON animation plan.",
        "Return valid JSON only.",
        "No markdown. No prose. No explanations.",
        'Use exactly this top-level shape: {"topic":"","goal":"","scenes":[{"type":"","description":"","elements":[],"animation":"","duration":0}]}',
        "Allowed scene types: intro_title, graph_plot, point_motion, tangent_visualization, equation_display, equation_transform, geometric_visual, explanation_text, highlight.",
        "Each scene must teach one idea only.",
        "Maximum 3 elements per scene.",
        "Prefer geometry and motion over text.",
        "Keep text short enough to stay inside the frame.",
        "Infer the user's real intent even if the prompt is short or incomplete.",
        "Make the plan mathematically faithful, visually structured, and suitable for a polished educational Manim video.",
        "For theorem or proof prompts, include the actual proof structure or geometric reasoning rather than generic exposition.",
        "For graph-based prompts, include axes, the correct function, and the specific concept being illustrated on that graph.",
        "For geometry prompts, avoid generic shapes and specify the exact diagram needed by the concept.",
        "Plan for a premium mathematical explainer with crisp pacing and strong continuity.",
        buildSkillText("planningRules"),
        buildSkillText("visualRules"),
      ].join(" "),
    },
    {
      role: "user",
      content: `User prompt: ${prompt}`,
    },
  ];

  try {
    const raw = await callChatModel(provider, messages, 0.15);
    return normalizePlan(JSON.parse(stripCodeFences(raw)), fallback);
  } catch (error) {
    return fallback;
  }
}

function buildCodeGenerationMessages(prompt, interpreted, dsl, feedback = "") {
  const topicRequirements = {
    pythagorean_theorem: [
      "Use a real right triangle with clearly labeled sides a, b, and c.",
      "Place the right-angle marker at the correct vertex.",
      "Construct the three squares externally on the triangle so they do not overlap each other or hide labels.",
      "Keep the theorem equation away from the triangle and squares.",
      "If you include an example, tie the 3-4-5 numbers directly to the labeled sides.",
    ],
    fourier_series: [
      "Use labeled axes and show actual harmonic curves rather than abstract filler.",
      "Use separate colors for the base sine wave, added harmonics, and the resulting partial sum.",
      "Keep the Fourier formula readable and separate from the plotted waves.",
      "If comparing to a target wave, show the target in a distinct style or color.",
    ],
    derivative: [
      "Plot the requested function accurately.",
      "Use a moving point on the graph and a tangent line that is actually tangent to the curve.",
      "Keep explanatory text away from the graph area.",
      "Show how the slope changes with the point position.",
    ],
    integral: [
      "Plot the requested curve accurately.",
      "Shade the exact area corresponding to the integral interval.",
      "Place the integral notation in a readable separate region of the frame.",
      "Do not cover the shaded region with text.",
    ],
    generic: [
      "Use visuals that directly correspond to the specific prompt, equation, or theorem.",
      "Do not invent abstract shapes unless they are mathematically meaningful.",
    ],
  };

  const qualityChecklist = [
    "Think through the full storyboard before writing code.",
    "The finished animation must be mathematically accurate, visually clean, and pedagogically useful.",
    "Every scene must correspond to a concrete idea from the prompt.",
    "Use self.next_section for major explanation beats.",
    "Do not put long text paragraphs over the main diagram or graph.",
    "At most two text blocks should be visible at once.",
    "Use MathTex for equations and Text only for short titles or labels.",
    "Titles should stay near the top edge, while diagrams remain centered or lower in the frame.",
    "Do not let labels overlap shapes, lines, or equations.",
    "Before introducing a new major visual, fade out or transform the previous one.",
    "Prefer precise geometric construction and plotted functions over placeholder objects.",
    "If the prompt asks for proof or explanation, the code must actually demonstrate the reasoning, not just flash equations.",
  ];

  const visualConstraints = [
    buildSkillText("codeRules"),
    "Return Python code only.",
    "The animation must directly correspond to the user prompt.",
    "Do not use random decorative shapes unless they are mathematically required by the prompt.",
    "Each scene beat must clearly explain the requested concept.",
    "Keep text concise, inside the frame, and away from plotted curves.",
    "Use FadeOut or ReplacementTransform before introducing unrelated new content.",
    "Use clean layout control with to_edge, next_to, arrange, scale_to_fit_width, and VGroup or Group.",
    "Avoid deprecated Scene.play(mobject.method, ...) patterns. Use .animate.",
    "Avoid unsupported helper signatures such as axes.get_tangent_line(x=..., graph=...).",
    "Use 3D coordinates where Manim expects points.",
    "Prefer mathematically accurate visuals over filler exposition.",
    "If the topic is derivative, include the graph, a moving point, and a tangent-line explanation.",
    "If the topic is Pythagorean theorem, include a right triangle, labeled sides, and the theorem relationship.",
    "If the topic is Fourier series, include harmonics and how they combine into a waveform.",
    "If the topic is integral, include area under a curve and integral notation.",
    "Make the scene visually polished and educational.",
    buildSkillText("visualRules"),
    ...qualityChecklist,
    ...(topicRequirements[interpreted.topic] || topicRequirements.generic),
  ].join(" ");

  return [
    {
      role: "system",
      content: visualConstraints,
    },
    {
      role: "user",
      content: [
        `Original prompt: ${prompt}`,
        "",
        `Interpreted plan JSON: ${JSON.stringify(interpreted)}`,
        "",
        `Scene DSL JSON: ${JSON.stringify(dsl)}`,
        "",
        feedback ? `Previous validator feedback to fix: ${feedback}` : "",
        feedback ? "" : "",
        "Write high-quality Manim code that follows the plan faithfully and explains the topic accurately.",
      ].join("\n"),
    },
  ];
}

async function generateCodeFromPlan(prompt, interpreted, dsl, feedback = "") {
  const provider = resolveGenerationProvider();
  if (!provider) {
    return {
      configured: false,
      source: "deterministic-renderer",
      code: renderDslToManim(interpreted, dsl),
      notes: "No generation model was configured, so Morphix used the deterministic renderer.",
    };
  }

  const raw = await callChatModel(provider, buildCodeGenerationMessages(prompt, interpreted, dsl, feedback), 0.2);
  return {
    configured: true,
    source: `${provider.type}:${provider.model}`,
    code: stripCodeFences(raw),
    notes: `Generated Manim code using ${provider.type}:${provider.model}.`,
  };
}

function wrapText(input, maxLineLength = 32) {
  const words = String(input || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxLineLength) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
    }
    current = word;
  }

  if (current) {
    lines.push(current);
  }

  return lines.slice(0, 3);
}

function mapElementToComponent(element, index, sceneType) {
  const raw = String(element || "");
  const normalized = raw.toLowerCase();
  if (sceneType === "explanation_text" || sceneType === "intro_title") {
    return { type: "text", content: raw, position: index === 0 ? "top" : "bottom" };
  }
  if (sceneType === "equation_display" || sceneType === "equation_transform") {
    return { type: "equation", content: raw, position: index === 0 ? "top" : "center" };
  }
  if (sceneType === "graph_plot" || sceneType === "point_motion" || sceneType === "tangent_visualization") {
    if (index === 0 && !normalized.includes("axes")) {
      return { type: "visual", content: "axes", position: "center" };
    }
    if (normalized.includes("=") || normalized.includes("^") || normalized.includes("\\") || normalized.includes("sin") || normalized.includes("cos")) {
      return { type: "equation", content: raw, position: "top" };
    }
    return { type: "visual", content: raw, position: "center" };
  }
  if (sceneType === "geometric_visual" || sceneType === "highlight") {
    return { type: normalized.includes("=") || normalized.includes("^") ? "equation" : "visual", content: raw, position: "center" };
  }
  if (normalized.includes("=") || normalized.includes("^") || normalized.includes("\\") || normalized.includes("int_")) {
    return { type: "equation", content: raw, position: index === 0 ? "top" : "center" };
  }
  if (
    normalized.includes("axes")
    || normalized.includes("graph")
    || normalized.includes("curve")
    || normalized.includes("triangle")
    || normalized.includes("wave")
    || normalized.includes("square")
    || normalized.includes("point")
  ) {
    return { type: "visual", content: raw, position: "center" };
  }
  return { type: "text", content: raw, position: index === 0 ? "top" : "bottom" };
}

function buildSceneDsl(plan) {
  return {
    topic: plan.topic,
    goal: plan.goal,
    scenes: (plan.scenes || []).map((sceneEntry, index) => ({
      id: `scene_${index + 1}`,
      type: allowedSceneTypes.has(sceneEntry.type) ? sceneEntry.type : "explanation_text",
      layout: sceneEntry.type === "intro_title" ? "center" : "progressive",
      teachingPurpose: sceneEntry.description,
      duration: Math.max(1.5, Math.min(8, Number(sceneEntry.duration) || 3)),
      components: (Array.isArray(sceneEntry.elements) ? sceneEntry.elements : [])
        .slice(0, 3)
        .map((entry, componentIndex) => mapElementToComponent(entry, componentIndex, sceneEntry.type)),
      transitions: [sceneEntry.animation || "fade_in"],
    })),
  };
}

function sanitizePythonString(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function sanitizeMath(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function parseGraphExpression(equation, topic) {
  const compact = String(equation || "").replace(/\s+/g, "");
  if (topic === "fourier_series") return "(4/np.pi)*(np.sin(x) + (1/3)*np.sin(3*x) + (1/5)*np.sin(5*x))";
  if (topic === "integral") return "0.25*x**2 + 1";
  if (compact.includes("x^2") || compact.includes("x**2")) return "x**2";
  if (compact.includes("x^3") || compact.includes("x**3")) return "x**3";
  if (compact.includes("sin(x)")) return "np.sin(x)";
  if (compact.includes("cos(x)")) return "np.cos(x)";
  if (compact.includes("e^x") || compact.includes("exp(x)")) return "np.exp(x)";
  return "x**2";
}

function buildGraphLabel(plan) {
  const equation = String(plan.equation || "");
  const match = equation.match(/([A-Za-z]\([^)]*\)\s*=\s*[^,]+|[A-Za-z]\s*=\s*[^,]+)/);
  return sanitizeMath(match ? match[1].trim() : (equation || plan.concept || "y=x^2"));
}

function getSceneTitle(sceneDsl, plan) {
  if (sceneDsl.type === "intro_title") {
    return String(sceneDsl.components[0]?.content || plan.concept || "Morphix");
  }

  const titles = {
    graph_plot: "Visual Setup",
    point_motion: "Moving Along the Curve",
    tangent_visualization: "Local Slope",
    equation_display: "Key Equation",
    equation_transform: "Apply the Equation",
    geometric_visual: "Geometric Picture",
    explanation_text: "Takeaway",
    highlight: "Key Relationship",
  };
  return titles[sceneDsl.type] || plan.concept || "Morphix";
}

function getExplanationLines(sceneDsl) {
  const lines = wrapText(sceneDsl.teachingPurpose || "");
  return lines.length ? lines : ["Visual explanation in progress."];
}

function renderIntroTitle(sceneDsl, plan) {
  const title = sanitizePythonString(getSceneTitle(sceneDsl, plan));
  const goalLines = getExplanationLines(sceneDsl).map((line) => `"${sanitizePythonString(line)}"`).join(", ");

  return [
    "        stage_objects = self.clear_stage(stage_objects)",
    `        title_obj = self.safe_title("${title}")`,
    `        goal_obj = self.safe_paragraph([${goalLines}], font_size=26)`,
    "        group = self.layout_center(title_obj, goal_obj)",
    "        self.play(FadeIn(group), run_time=1.0)",
    `        self.wait(${sceneDsl.duration.toFixed(1)})`,
    "        stage_objects = [group]",
  ];
}

function renderEquationScene(sceneDsl, plan) {
  const title = sanitizePythonString(getSceneTitle(sceneDsl, plan));
  const eq = sanitizeMath(sceneDsl.components.find((entry) => entry.type === "equation")?.content || plan.equation || "y=x^2");
  const explicitText = sceneDsl.components.filter((entry) => entry.type === "text").map((entry) => entry.content);
  const explanationSource = explicitText.length > 0 ? explicitText.join(" ") : sceneDsl.teachingPurpose;
  const explanationLines = wrapText(explanationSource, 30).map((line) => `"${sanitizePythonString(line)}"`).join(", ");

  return [
    "        stage_objects = self.clear_stage(stage_objects)",
    `        title_obj = self.safe_title("${title}")`,
    `        equation_obj = self.safe_equation(r"${eq}")`,
    `        note_obj = self.safe_paragraph([${explanationLines}], font_size=24)`,
    "        group = self.layout_center(title_obj, equation_obj, note_obj)",
    "        self.play(FadeIn(title_obj), Write(equation_obj), FadeIn(note_obj), run_time=1.3)",
    `        self.wait(${sceneDsl.duration.toFixed(1)})`,
    "        stage_objects = [group]",
  ];
}

function renderGraphPlot(sceneDsl, plan) {
  const title = sanitizePythonString(getSceneTitle(sceneDsl, plan));
  const expr = parseGraphExpression(plan.equation, plan.topic);
  const label = buildGraphLabel(plan);
  const explicitText = sceneDsl.components.filter((entry) => entry.type === "text").map((entry) => entry.content);
  const explanationSource = explicitText.length > 0 ? explicitText.join(" ") : sceneDsl.teachingPurpose;
  const noteLines = wrapText(explanationSource, 30).map((line) => `"${sanitizePythonString(line)}"`).join(", ");

  return [
    "        stage_objects = self.clear_stage(stage_objects)",
    `        title_obj = self.safe_title("${title}")`,
    "        axes = Axes(",
    "            x_range=[-4, 4, 1],",
    "            y_range=[-3, 6, 1],",
    "            x_length=9,",
    "            y_length=4.8,",
    "            axis_config={\"include_tip\": False, \"stroke_opacity\": 0.5},",
    "        )",
    "        axes.to_edge(DOWN, buff=0.6)",
    `        graph = axes.plot(lambda x: ${expr}, x_range=[-3.2, 3.2], color=BLUE_C, stroke_width=5)`,
    `        label = MathTex(r"${label}", color=YELLOW_B).scale(0.9)`,
    "        label.next_to(axes, UP, buff=0.35)",
    `        note_obj = self.safe_paragraph([${noteLines}], font_size=22)`,
    "        note_obj.to_edge(RIGHT, buff=0.4)",
    "        note_obj.scale_to_fit_width(3.2)",
    "        note_obj.set_opacity(0.88)",
    "        self.play(FadeIn(title_obj), run_time=0.7)",
    "        self.play(Create(axes), Create(graph), FadeIn(label), FadeIn(note_obj), run_time=2.0)",
    `        self.wait(${sceneDsl.duration.toFixed(1)})`,
    "        graph_group = Group(axes, graph, label, note_obj)",
    "        stage_objects = [title_obj, graph_group]",
  ];
}

function renderPointMotion(sceneDsl, plan) {
  const title = sanitizePythonString(getSceneTitle(sceneDsl, plan));
  const expr = parseGraphExpression(plan.equation, plan.topic);
  const explicitText = sceneDsl.components.filter((entry) => entry.type === "text").map((entry) => entry.content);
  const explanationSource = explicitText.length > 0 ? explicitText.join(" ") : sceneDsl.teachingPurpose;
  const noteLines = wrapText(explanationSource, 30).map((line) => `"${sanitizePythonString(line)}"`).join(", ");
  const trackedExpr = expr.replace(/x/g, "tracker.get_value()");

  return [
    "        stage_objects = self.clear_stage(stage_objects)",
    `        title_obj = self.safe_title("${title}")`,
    "        axes = Axes(",
    "            x_range=[-4, 4, 1],",
    "            y_range=[-3, 6, 1],",
    "            x_length=9,",
    "            y_length=4.8,",
    "            axis_config={\"include_tip\": False, \"stroke_opacity\": 0.5},",
    "        )",
    "        axes.to_edge(DOWN, buff=0.6)",
    `        graph = axes.plot(lambda x: ${expr}, x_range=[-3.2, 3.2], color=BLUE_C, stroke_width=5)`,
    "        tracker = ValueTracker(-2.2)",
    `        moving_point = always_redraw(lambda: Dot(axes.c2p(tracker.get_value(), ${trackedExpr}), color=RED_C, radius=0.08))`,
    `        note_obj = self.safe_paragraph([${noteLines}], font_size=22)`,
    "        note_obj.to_edge(RIGHT, buff=0.6)",
    "        note_obj.set_opacity(0.88)",
    "        self.play(FadeIn(title_obj), Create(axes), Create(graph), FadeIn(note_obj), run_time=1.8)",
    "        self.play(FadeIn(moving_point), run_time=0.6)",
    "        self.play(tracker.animate.set_value(2.2), run_time=3.2, rate_func=smooth)",
    `        self.wait(${Math.max(sceneDsl.duration - 1.4, 1).toFixed(1)})`,
    "        graph_group = Group(axes, graph, moving_point, note_obj)",
    "        stage_objects = [title_obj, graph_group]",
  ];
}

function renderTangentScene(sceneDsl, plan) {
  const title = sanitizePythonString(getSceneTitle(sceneDsl, plan));
  const expr = parseGraphExpression(plan.equation, plan.topic);
  const explicitText = sceneDsl.components.filter((entry) => entry.type === "text").map((entry) => entry.content);
  const explanationSource = explicitText.length > 0 ? explicitText.join(" ") : sceneDsl.teachingPurpose;
  const noteLines = wrapText(explanationSource, 30).map((line) => `"${sanitizePythonString(line)}"`).join(", ");
  const trackedExpr = expr.replace(/x/g, "tracker.get_value()");
  const leftExpr = expr.replace(/x/g, "(tracker.get_value() - dx)");
  const rightExpr = expr.replace(/x/g, "(tracker.get_value() + dx)");

  return [
    "        stage_objects = self.clear_stage(stage_objects)",
    `        title_obj = self.safe_title("${title}")`,
    "        axes = Axes(",
    "            x_range=[-4, 4, 1],",
    "            y_range=[-3, 6, 1],",
    "            x_length=9,",
    "            y_length=4.8,",
    "            axis_config={\"include_tip\": False, \"stroke_opacity\": 0.5},",
    "        )",
    "        axes.to_edge(DOWN, buff=0.6)",
    `        graph = axes.plot(lambda x: ${expr}, x_range=[-3.2, 3.2], color=BLUE_C, stroke_width=5)`,
    "        tracker = ValueTracker(-1.5)",
    `        point = always_redraw(lambda: Dot(axes.c2p(tracker.get_value(), ${trackedExpr}), color=RED_C, radius=0.08))`,
    "        dx = 0.08",
    "        tangent = always_redraw(lambda: Line(",
    `            axes.c2p(tracker.get_value() - dx, ${leftExpr}),`,
    `            axes.c2p(tracker.get_value() + dx, ${rightExpr}),`,
    "            color=YELLOW_B,",
    "            stroke_width=7,",
    "        ).scale(8))",
    `        note_obj = self.safe_paragraph([${noteLines}], font_size=22)`,
    "        note_obj.to_edge(RIGHT, buff=0.6)",
    "        note_obj.set_opacity(0.88)",
    "        slope_label = always_redraw(lambda: self.safe_paragraph([f\"x = {tracker.get_value():.2f}\"], font_size=20).next_to(axes, UP, buff=0.35))",
    "        self.play(FadeIn(title_obj), Create(axes), Create(graph), FadeIn(note_obj), run_time=1.8)",
    "        self.play(FadeIn(point), Create(tangent), FadeIn(slope_label), run_time=1.1)",
    "        self.play(tracker.animate.set_value(1.6), run_time=3.0, rate_func=smooth)",
    `        self.wait(${Math.max(sceneDsl.duration - 1.0, 1).toFixed(1)})`,
    "        graph_group = Group(axes, graph, point, tangent, slope_label, note_obj)",
    "        stage_objects = [title_obj, graph_group]",
  ];
}

function renderPythagoreanGeometry(sceneDsl, plan) {
  const title = sanitizePythonString(getSceneTitle(sceneDsl, plan));
  const explicitText = sceneDsl.components.filter((entry) => entry.type === "text").map((entry) => entry.content);
  const explanationSource = explicitText.length > 0 ? explicitText.join(" ") : sceneDsl.teachingPurpose;
  const noteLines = wrapText(explanationSource, 30).map((line) => `"${sanitizePythonString(line)}"`).join(", ");

  return [
    "        stage_objects = self.clear_stage(stage_objects)",
    `        title_obj = self.safe_title("${title}")`,
    "        a = np.array([-3.4, -1.5, 0.0])",
    "        b = np.array([-3.4, 1.5, 0.0])",
    "        c = np.array([0.6, -1.5, 0.0])",
    "        triangle = Polygon(a, b, c, color=BLUE_C, stroke_width=5)",
    "        right_marker = RightAngle(Line(a, b), Line(a, c), length=0.25, quadrant=(-1, 1), color=YELLOW_B)",
    "        label_a = MathTex(r\"a\", color=BLUE_B).scale(0.8).next_to(Line(a, b), LEFT, buff=0.2)",
    "        label_b = MathTex(r\"b\", color=GREEN_B).scale(0.8).next_to(Line(a, c), DOWN, buff=0.2)",
    "        label_c = MathTex(r\"c\", color=YELLOW_B).scale(0.8).next_to(Line(b, c), RIGHT, buff=0.2)",
    "        square_a = Square(side_length=3, color=BLUE_B, fill_color=BLUE_E, fill_opacity=0.2).next_to(Line(a, b), LEFT, buff=0)",
    "        square_b = Square(side_length=4, color=GREEN_B, fill_color=GREEN_E, fill_opacity=0.2).next_to(Line(a, c), DOWN, buff=0)",
    "        square_c = Square(side_length=5, color=YELLOW_B, fill_color=YELLOW_E, fill_opacity=0.18).rotate(np.arctan2(3, 4)).next_to(Line(b, c), RIGHT, buff=0)",
    `        note_obj = self.safe_paragraph([${noteLines}], font_size=22)`,
    "        note_obj.to_edge(RIGHT, buff=0.55)",
    "        note_obj.scale_to_fit_width(3.0)",
    "        self.play(FadeIn(title_obj), Create(triangle), FadeIn(right_marker), run_time=1.3)",
    "        self.play(FadeIn(label_a), FadeIn(label_b), FadeIn(label_c), run_time=0.8)",
    "        self.play(Create(square_a), Create(square_b), Create(square_c), FadeIn(note_obj), run_time=2.0)",
    `        self.wait(${sceneDsl.duration.toFixed(1)})`,
    "        geometry_group = Group(triangle, right_marker, label_a, label_b, label_c, square_a, square_b, square_c, note_obj)",
    "        stage_objects = [title_obj, geometry_group]",
  ];
}

function renderIntegralHighlight(sceneDsl) {
  const title = sanitizePythonString(getSceneTitle(sceneDsl, { concept: "Integral" }));
  const explicitText = sceneDsl.components.filter((entry) => entry.type === "text").map((entry) => entry.content);
  const explanationSource = explicitText.length > 0 ? explicitText.join(" ") : sceneDsl.teachingPurpose;
  const noteLines = wrapText(explanationSource, 30).map((line) => `"${sanitizePythonString(line)}"`).join(", ");

  return [
    "        stage_objects = self.clear_stage(stage_objects)",
    `        title_obj = self.safe_title("${title}")`,
    "        axes = Axes(",
    "            x_range=[-1, 5, 1],",
    "            y_range=[0, 6, 1],",
    "            x_length=9,",
    "            y_length=4.8,",
    "            axis_config={\"include_tip\": False, \"stroke_opacity\": 0.5},",
    "        )",
    "        axes.to_edge(DOWN, buff=0.6)",
    "        graph = axes.plot(lambda x: 0.25*x**2 + 1, x_range=[0, 4], color=BLUE_C, stroke_width=5)",
    "        area = axes.get_area(graph, x_range=(0, 4), color=BLUE_E, opacity=0.35)",
    `        note_obj = self.safe_paragraph([${noteLines}], font_size=22)`,
    "        note_obj.to_edge(RIGHT, buff=0.6)",
    "        self.play(FadeIn(title_obj), Create(axes), Create(graph), run_time=1.7)",
    "        self.play(FadeIn(area), FadeIn(note_obj), run_time=1.2)",
    `        self.wait(${sceneDsl.duration.toFixed(1)})`,
    "        graph_group = Group(axes, graph, area, note_obj)",
    "        stage_objects = [title_obj, graph_group]",
  ];
}

function renderFourierHighlight(sceneDsl) {
  const title = sanitizePythonString(getSceneTitle(sceneDsl, { concept: "Fourier Series" }));
  const explicitText = sceneDsl.components.filter((entry) => entry.type === "text").map((entry) => entry.content);
  const explanationSource = explicitText.length > 0 ? explicitText.join(" ") : sceneDsl.teachingPurpose;
  const noteLines = wrapText(explanationSource, 30).map((line) => `"${sanitizePythonString(line)}"`).join(", ");

  return [
    "        stage_objects = self.clear_stage(stage_objects)",
    `        title_obj = self.safe_title("${title}")`,
    "        axes = Axes(",
    "            x_range=[-np.pi, np.pi, np.pi/2],",
    "            y_range=[-2, 2, 1],",
    "            x_length=9,",
    "            y_length=4.6,",
    "            axis_config={\"include_tip\": False, \"stroke_opacity\": 0.5},",
    "        )",
    "        axes.to_edge(DOWN, buff=0.6)",
    "        base_wave = axes.plot(lambda x: (4/np.pi)*np.sin(x), x_range=[-np.pi, np.pi], color=BLUE_B, stroke_width=4)",
    "        richer_wave = axes.plot(lambda x: (4/np.pi)*(np.sin(x) + (1/3)*np.sin(3*x) + (1/5)*np.sin(5*x)), x_range=[-np.pi, np.pi], color=YELLOW_B, stroke_width=5)",
    `        note_obj = self.safe_paragraph([${noteLines}], font_size=22)`,
    "        note_obj.to_edge(RIGHT, buff=0.6)",
    "        self.play(FadeIn(title_obj), Create(axes), Create(base_wave), run_time=1.7)",
    "        self.play(Transform(base_wave, richer_wave), FadeIn(note_obj), run_time=2.0)",
    `        self.wait(${sceneDsl.duration.toFixed(1)})`,
    "        graph_group = Group(axes, base_wave, note_obj)",
    "        stage_objects = [title_obj, graph_group]",
  ];
}

function renderGenericHighlight(sceneDsl, plan) {
  return renderEquationScene({
    ...sceneDsl,
    type: "equation_display",
    teachingPurpose: sceneDsl.teachingPurpose,
    components: [
      { type: "equation", content: plan.equation || plan.concept, position: "center" },
      ...sceneDsl.components.filter((entry) => entry.type === "text"),
    ],
  }, plan);
}

function renderHighlight(sceneDsl, plan) {
  if (plan.topic === "integral") return renderIntegralHighlight(sceneDsl);
  if (plan.topic === "fourier_series") return renderFourierHighlight(sceneDsl);
  return renderGenericHighlight(sceneDsl, plan);
}

function renderGeometricVisual(sceneDsl, plan) {
  if (plan.topic === "pythagorean_theorem") {
    return renderPythagoreanGeometry(sceneDsl, plan);
  }
  return renderEquationScene({
    ...sceneDsl,
    type: "equation_display",
    components: [
      { type: "equation", content: plan.equation || plan.concept, position: "center" },
      ...sceneDsl.components.filter((entry) => entry.type === "text"),
    ],
  }, plan);
}

function renderExplanation(sceneDsl, plan) {
  const title = sanitizePythonString(getSceneTitle(sceneDsl, plan));
  const explicitText = sceneDsl.components.map((entry) => entry.content).filter(Boolean);
  const explanationSource = explicitText.length > 0 ? explicitText.join(" ") : sceneDsl.teachingPurpose;
  const explanationLines = wrapText(explanationSource, 30).map((line) => `"${sanitizePythonString(line)}"`).join(", ");

  return [
    "        stage_objects = self.clear_stage(stage_objects)",
    `        title_obj = self.safe_title("${title}")`,
    `        explanation_obj = self.safe_paragraph([${explanationLines}], font_size=28)`,
    "        group = self.layout_center(title_obj, explanation_obj)",
    "        self.play(FadeIn(group), run_time=1.0)",
    `        self.wait(${sceneDsl.duration.toFixed(1)})`,
    "        stage_objects = [group]",
  ];
}

function renderDslToManim(plan, dsl) {
  const sceneBlocks = [];

  for (const sceneDsl of dsl.scenes) {
    sceneBlocks.push(`        self.next_section("${sanitizePythonString(sceneDsl.id)}")`);

    if (sceneDsl.type === "intro_title") {
      sceneBlocks.push(...renderIntroTitle(sceneDsl, plan));
    } else if (sceneDsl.type === "graph_plot") {
      sceneBlocks.push(...renderGraphPlot(sceneDsl, plan));
    } else if (sceneDsl.type === "point_motion") {
      sceneBlocks.push(...renderPointMotion(sceneDsl, plan));
    } else if (sceneDsl.type === "tangent_visualization") {
      sceneBlocks.push(...renderTangentScene(sceneDsl, plan));
    } else if (sceneDsl.type === "equation_display" || sceneDsl.type === "equation_transform") {
      sceneBlocks.push(...renderEquationScene(sceneDsl, plan));
    } else if (sceneDsl.type === "geometric_visual") {
      sceneBlocks.push(...renderGeometricVisual(sceneDsl, plan));
    } else if (sceneDsl.type === "highlight") {
      sceneBlocks.push(...renderHighlight(sceneDsl, plan));
    } else {
      sceneBlocks.push(...renderExplanation(sceneDsl, plan));
    }
  }

  return [
    "from manim import *",
    "import numpy as np",
    "",
    'FONT_FAMILY = "DejaVu Sans Mono"',
    'BG_COLOR = "#0D1117"',
    "",
    "class MorphixScene(Scene):",
    "    def clear_stage(self, objects):",
    "        if objects:",
    "            self.play(*[FadeOut(obj) for obj in objects], run_time=0.55)",
    "        return []",
    "",
    "    def safe_title(self, text):",
    "        title = Text(text, font=FONT_FAMILY, color=WHITE, weight=BOLD, font_size=40)",
    "        title.to_edge(UP, buff=0.5)",
    "        title.set_z_index(20)",
    "        self.bring_to_front(title)",
    "        return title",
    "",
    "    def safe_paragraph(self, lines, font_size=24):",
    "        paragraph = Paragraph(*lines, font=FONT_FAMILY, alignment=\"left\", line_spacing=0.65, font_size=font_size)",
    "        paragraph.scale_to_fit_width(6.3)",
    "        paragraph.set_opacity(0.92)",
    "        paragraph.set_z_index(18)",
    "        return paragraph",
    "",
    "    def safe_equation(self, tex):",
    "        equation = MathTex(tex, color=YELLOW_B)",
    "        equation.scale(1.0)",
    "        equation.set_z_index(18)",
    "        return equation",
    "",
    "    def layout_center(self, *objs):",
    "        filtered = [obj for obj in objs if obj is not None]",
    "        group = Group(*filtered)",
    "        group.arrange(DOWN, buff=0.35, center=True)",
    "        group.move_to(ORIGIN)",
    "        return group",
    "",
    "    def construct(self):",
    "        self.camera.background_color = BG_COLOR",
    "        stage_objects = []",
    ...sceneBlocks,
    "        stage_objects = self.clear_stage(stage_objects)",
    "        self.wait(0.4)",
    "",
  ].join("\n");
}

async function checkPythonSyntax(code) {
  const pythonExecutable = process.env.PYTHON_EXECUTABLE || "python";
  const syntaxDir = path.join(generatedRoot, "_syntax");
  await fsp.mkdir(syntaxDir, { recursive: true });
  const filePath = path.join(syntaxDir, `syntax_${Date.now()}_${Math.random().toString(16).slice(2)}.py`);
  await fsp.writeFile(filePath, code, "utf-8");

  try {
    await runCommandDetailed(pythonExecutable, ["-m", "py_compile", filePath], syntaxDir, 20000);
    return { valid: true, error: "", diagnostics: [] };
  } catch (error) {
    return {
      valid: false,
      error: error.message || "Unknown syntax error.",
      diagnostics: [error.message || "Unknown syntax error."],
    };
  } finally {
    await fsp.rm(filePath, { force: true }).catch(() => {});
  }
}

function findTwoDimensionalCoordinateIssues(code) {
  const issues = [];
  const patterns = [
    { label: "start point", regex: /start\s*=\s*\[([^\]]+)\]/g },
    { label: "end point", regex: /end\s*=\s*\[([^\]]+)\]/g },
    { label: "move_to point", regex: /move_to\s*\(\s*\[([^\]]+)\]/g },
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.regex.exec(code)) !== null) {
      const components = match[1].split(",").map((entry) => entry.trim()).filter(Boolean);
      if (components.length === 2) {
        issues.push(`Manim ${pattern.label} appears to use 2D coordinates instead of 3D coordinates: [${match[1]}]`);
      }
    }
  }

  return issues;
}

function findDeprecatedPlayPatterns(code) {
  const issues = [];
  const playCalls = [...code.matchAll(/self\.play\(([\s\S]*?)\)/g)];
  for (const match of playCalls) {
    const args = match[1];
    const deprecatedPattern = /[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*\s*,/;
    if (deprecatedPattern.test(args) && !args.includes(".animate")) {
      issues.push(`Deprecated Scene.play method pattern detected: self.play(${args.trim()})`);
    }
  }
  return issues;
}

function findManimApiMisuse(code) {
  const issues = [];
  if (/get_tangent_line\s*\(\s*x\s*=/.test(code)) {
    issues.push("Detected axes.get_tangent_line called with keyword argument x=, which is incompatible with this Manim version.");
  }
  if (/get_tangent_line\s*\([\s\S]*graph\s*=/.test(code)) {
    issues.push("Detected axes.get_tangent_line called with keyword argument graph=, which is incompatible with this Manim version.");
  }
  if (/Line\s*\(\s*point\s*,\s*point\s*\+/.test(code)) {
    issues.push("Detected Line constructed from a Mobject plus a vector; use coordinate points instead.");
  }
  return issues;
}

function findLayoutIssues(code, dsl) {
  const issues = [];
  const warnings = [];

  for (const sceneDsl of dsl.scenes || []) {
    if ((sceneDsl.components || []).length > 3) {
      issues.push(`${sceneDsl.id} exceeds the maximum of 3 components.`);
    }
  }

  const textMatches = [...code.matchAll(/Text\("([^"]+)"[^)]*\)/g)];
  for (const match of textMatches) {
    if (match[1].length > 48) {
      warnings.push(`Long text may risk clipping: "${match[1]}"`);
    }
  }

  if (!code.includes("set_z_index")) {
    warnings.push("Generated code does not explicitly raise important foreground elements with z-index.");
  }
  if (!code.includes("self.bring_to_front")) {
    warnings.push("Generated code does not explicitly bring titles to the front.");
  }

  return { issues, warnings };
}

function validatePlanStructure(plan) {
  const issues = [];
  const warnings = [];

  if (!plan.topic) issues.push("Plan is missing a topic.");
  if (!plan.goal) issues.push("Plan is missing a goal.");
  if (!Array.isArray(plan.scenes) || plan.scenes.length === 0) {
    issues.push("Plan must contain at least one scene.");
  }

  for (const [index, sceneEntry] of (plan.scenes || []).entries()) {
    if (!allowedSceneTypes.has(sceneEntry.type)) {
      issues.push(`Scene ${index + 1} uses an unsupported scene type: ${sceneEntry.type}`);
    }
    if (!sceneEntry.description) {
      issues.push(`Scene ${index + 1} is missing a description.`);
    }
    if (!Array.isArray(sceneEntry.elements) || sceneEntry.elements.length === 0) {
      issues.push(`Scene ${index + 1} is missing elements.`);
    }
    if (Array.isArray(sceneEntry.elements) && sceneEntry.elements.length > 3) {
      issues.push(`Scene ${index + 1} has more than 3 elements.`);
    }
    if ((sceneEntry.duration || 0) < 1) {
      warnings.push(`Scene ${index + 1} has a very short duration.`);
    }
  }

  return { valid: issues.length === 0, issues, warnings };
}

function extractPromptKeywords(prompt) {
  return String(prompt || "")
    .toLowerCase()
    .replace(/[^a-z0-9^=+\-\\\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4)
    .filter((token) => !["with", "that", "this", "from", "into", "show", "make", "build", "visualize", "explain"].includes(token));
}

function validatePromptAlignment(prompt, plan, code) {
  const issues = [];
  const normalizedCode = String(code || "").toLowerCase();
  const normalizedPrompt = String(prompt || "").toLowerCase();
  const keywords = extractPromptKeywords(prompt);

  if (plan.topic === "pythagorean_theorem" && !/rightangle|a\^2 \+ b\^2 = c\^2|triangle/.test(normalizedCode)) {
    issues.push("Rendered scene does not clearly encode the core Pythagorean theorem visuals.");
  }

  if (plan.topic === "fourier_series" && !/sin|cos|fourier|partial sum|harmonic/.test(normalizedCode)) {
    issues.push("Rendered scene does not clearly encode Fourier-series content.");
  }

  if (plan.topic === "derivative" && !/tangent|tracker|x\*\*2|2x|slope/.test(normalizedCode)) {
    issues.push("Rendered scene does not clearly encode derivative or tangent-line content.");
  }

  if (plan.topic === "integral" && !/get_area|int_a\^b|integral|area/.test(normalizedCode)) {
    issues.push("Rendered scene does not clearly encode integral or area-under-curve content.");
  }

  const matchedKeywords = keywords.filter((keyword) => normalizedCode.includes(keyword));
  if (keywords.length > 0 && matchedKeywords.length === 0 && !normalizedCode.includes(normalizedPrompt.slice(0, 12))) {
    issues.push("Generated scene does not appear to contain meaningful keywords from the user prompt.");
  }

  return issues;
}

async function validatePlanWithAI(provider, prompt, plan, dsl, code) {
  const messages = [
    {
      role: "system",
      content: [
        "You are a mathematical animation validator.",
        "Judge whether the plan, DSL, and generated Manim code correctly represent the requested concept.",
        "Reject if the math is wrong, the visuals are misleading, the flow is cluttered, or the layout is likely to clip or overlap.",
        buildSkillText("validationRules"),
        "Return only one line.",
        "Either VALID",
        "or INVALID: <reason>",
      ].join(" "),
    },
    {
      role: "user",
      content: [
        `Prompt: ${prompt}`,
        "",
        `Plan JSON: ${JSON.stringify(plan)}`,
        "",
        `DSL JSON: ${JSON.stringify(dsl)}`,
        "",
        "Generated code:",
        code,
      ].join("\n"),
    },
  ];

  const raw = await callChatModel(provider, messages, 0);
  const cleaned = stripCodeFences(raw).trim();
  if (/^valid$/i.test(cleaned)) {
    return { valid: true, reason: "", judge: `${provider.type}:${provider.model}` };
  }
  if (/^invalid:/i.test(cleaned)) {
    return {
      valid: false,
      reason: cleaned.replace(/^invalid:\s*/i, "").trim() || "Validator rejected the plan.",
      judge: `${provider.type}:${provider.model}`,
    };
  }

  return {
    valid: !/\binvalid\b/i.test(cleaned),
    reason: cleaned,
    judge: `${provider.type}:${provider.model}`,
  };
}

async function validateMathLayoutFlow(prompt, plan, dsl, code) {
  const structure = validatePlanStructure(plan);
  const layout = findLayoutIssues(code, dsl);
  const coordinateIssues = findTwoDimensionalCoordinateIssues(code);
  const deprecatedIssues = findDeprecatedPlayPatterns(code);
  const apiIssues = findManimApiMisuse(code);
  const alignmentIssues = validatePromptAlignment(prompt, plan, code);

  const issues = [...structure.issues, ...layout.issues, ...coordinateIssues, ...deprecatedIssues, ...apiIssues, ...alignmentIssues];
  const warnings = [...structure.warnings, ...layout.warnings];
  let judge = "local-heuristic";
  let rationale = "";

  const validationProvider = resolveValidationProvider();
  if (validationProvider) {
    try {
      const aiResult = await validatePlanWithAI(validationProvider, prompt, plan, dsl, code);
      judge = aiResult.judge;
      if (!aiResult.valid) {
        issues.push(aiResult.reason || "AI validator rejected the plan.");
      } else if (aiResult.reason) {
        rationale = aiResult.reason;
      }
    } catch (error) {
      warnings.push(`AI validation fallback engaged: ${error.message}`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
    summary: issues.length === 0
      ? "Plan, DSL, and generated code passed math/layout validation."
      : "Validator found math, layout, or compatibility issues.",
    rationale,
    judge,
  };
}

function hasBlockingWarnings(validation, runtimeValidation) {
  const validationWarnings = Array.isArray(validation?.warnings) ? validation.warnings : [];
  const runtimeWarnings = Array.isArray(runtimeValidation?.warnings) ? runtimeValidation.warnings : [];
  const ignorableRuntimeWarnings = new Set([
    "Runtime validation skipped by configuration.",
    "Runtime validation skipped because Manim is unavailable.",
  ]);

  const blockingRuntimeWarnings = runtimeWarnings.filter((warning) => !ignorableRuntimeWarnings.has(warning));
  return validationWarnings.length > 0 || blockingRuntimeWarnings.length > 0;
}

function shouldRepairPlan(feedback) {
  const normalized = String(feedback || "").toLowerCase();
  return [
    "plan is missing",
    "unsupported scene type",
    "scene must contain",
    "scene is missing",
    "more than 3 elements",
    "topic",
    "goal",
    "does not appear to contain meaningful keywords from the user prompt",
  ].some((needle) => normalized.includes(needle));
}

async function requestPlanRepair(provider, prompt, interpreted, dsl, feedback) {
  const fallback = buildInterpreterFallback(prompt);
  if (!provider) {
    return fallback;
  }

  const messages = [
    {
      role: "system",
      content: [
        "You repair mathematical animation plans.",
        "Return strict JSON only.",
        "Fix the plan so that it becomes mathematically correct, visually clean, and compatible with a deterministic Manim renderer.",
        "Keep one idea per scene, maximum 3 elements per scene, and short on-screen text.",
        buildSkillText("planningRules"),
        buildSkillText("visualRules"),
        'Use exactly this top-level shape: {"topic":"","goal":"","scenes":[{"type":"","description":"","elements":[],"animation":"","duration":0}]}',
      ].join(" "),
    },
    {
      role: "user",
      content: [
        `Original prompt: ${prompt}`,
        "",
        `Current interpreted plan: ${JSON.stringify(interpreted)}`,
        "",
        `Current DSL: ${JSON.stringify(dsl)}`,
        "",
        `Validator feedback: ${feedback}`,
      ].join("\n"),
    },
  ];

  try {
    const raw = await callChatModel(provider, messages, 0.15);
    return normalizePlan(JSON.parse(stripCodeFences(raw)), fallback);
  } catch (error) {
    return fallback;
  }
}

function localRepairPlan(prompt, interpreted, feedback) {
  const fallback = buildInterpreterFallback(prompt);
  return {
    ...fallback,
    goal: interpreted.goal || fallback.goal,
    scenes: fallback.scenes.map((sceneEntry, index) => ({
      ...sceneEntry,
      description: index === 0
        ? sceneEntry.description
        : `${sceneEntry.description} ${feedback ? "Keep the layout spacious and the meaning explicit." : ""}`.trim(),
    })),
  };
}

async function repairPlan(prompt, interpreted, dsl, feedback) {
  const provider = resolveValidationProvider() || resolveGenerationProvider();
  if (!provider) {
    return localRepairPlan(prompt, interpreted, feedback);
  }

  const repaired = await requestPlanRepair(provider, prompt, interpreted, dsl, feedback);
  return normalizePlan(repaired, buildInterpreterFallback(prompt));
}

async function requestSyntaxRepair(provider, prompt, code, errorText) {
  const messages = [
    {
      role: "system",
      content: [
        "You repair Python Manim code.",
        "Return corrected Python code only.",
        "Do not add markdown fences.",
        buildSkillText("codeRules"),
        buildSkillText("visualRules"),
      ].join(" "),
    },
    {
      role: "user",
      content: [
        `Prompt: ${prompt}`,
        `Syntax error: ${errorText}`,
        "",
        "Current code:",
        code,
      ].join("\n"),
    },
  ];

  return callChatModel(provider, messages, 0);
}

async function ensureSyntacticCode(prompt, generated) {
  let currentCode = stripCodeFences(generated.code);
  const diagnostics = [];
  const repairProvider = resolveValidationProvider() || resolveGenerationProvider();

  for (let attempt = 0; attempt <= syntaxRepairAttempts; attempt += 1) {
    const syntax = await checkPythonSyntax(currentCode);
    if (syntax.valid) {
      return {
        ...generated,
        code: currentCode,
        syntax: {
          valid: true,
          diagnostics,
          summary: diagnostics.length > 0
            ? "Morphix repaired Python syntax before accepting the generated code."
            : "Generated Manim code passed Python syntax checks.",
        },
      };
    }

    diagnostics.push(syntax.error);
    if (!repairProvider || attempt === syntaxRepairAttempts) {
      return {
        ...generated,
        source: "syntax-repair-failed",
        code: currentCode,
        notes: `Generated Manim code still contains syntax errors. ${syntax.error}`,
        syntax: {
          valid: false,
          diagnostics,
          summary: "Morphix could not repair the Python syntax automatically.",
        },
      };
    }

    const repaired = await requestSyntaxRepair(repairProvider, prompt, currentCode, syntax.error);
    currentCode = stripCodeFences(repaired);
  }

  return {
    ...generated,
    source: "syntax-repair-failed",
    code: currentCode,
    notes: "Morphix exhausted syntax repair attempts.",
    syntax: {
      valid: false,
      diagnostics,
      summary: "Morphix exhausted syntax repair attempts.",
    },
  };
}

function runCommandDetailed(command, args, cwd, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let finished = false;

    const useTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0;
    const timer = useTimeout
      ? setTimeout(() => {
          if (!finished) {
            child.kill();
            reject(new Error(`Command timed out after ${timeoutMs}ms.`));
          }
        }, timeoutMs)
      : null;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", (error) => {
      finished = true;
      if (timer) {
        clearTimeout(timer);
      }
      reject(error);
    });
    child.on("exit", (code) => {
      finished = true;
      if (timer) {
        clearTimeout(timer);
      }
      if (code === 0) {
        resolve({ stdout, stderr, code });
        return;
      }
      reject(new Error([stdout, stderr].filter(Boolean).join("\n").trim() || `Command exited with code ${code}.`));
    });
  });
}

async function validateManimRuntime(code) {
  const runtimeValidationEnabled = process.env.ENABLE_RUNTIME_VALIDATION === "true";
  if (!runtimeValidationEnabled) {
    return {
      valid: true,
      summary: "Runtime dry-run skipped by configuration.",
      issues: [],
      warnings: ["Runtime validation skipped by configuration."],
    };
  }

  const pythonExecutable = process.env.PYTHON_EXECUTABLE || "python";
  const runtimeDir = path.join(generatedRoot, "_runtime");
  await fsp.mkdir(runtimeDir, { recursive: true });

  const filePath = path.join(runtimeDir, `runtime_${Date.now()}.py`);
  await fsp.writeFile(filePath, code, "utf-8");

  try {
    await runCommandDetailed(
      pythonExecutable,
      ["-m", "manim", "render", "--dry_run", "--disable_caching", "-ql", filePath, "MorphixScene"],
      runtimeDir,
      120000,
    );
    return {
      valid: true,
      summary: "Manim dry-run validation passed.",
      issues: [],
      warnings: [],
    };
  } catch (error) {
    const message = error.message || "Unknown runtime validation error.";
    if (message.includes("No module named manim")) {
      return {
        valid: true,
        summary: "Runtime dry-run skipped because Manim is unavailable in the configured Python environment.",
        issues: [],
        warnings: ["Runtime validation skipped because Manim is unavailable."],
      };
    }
    return {
      valid: false,
      summary: "Manim dry-run validation failed.",
      issues: [message],
      warnings: [],
    };
  } finally {
    await fsp.rm(filePath, { force: true }).catch(() => {});
  }
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

async function renderArtifact(jobId, prompt, code) {
  const jobDir = path.join(generatedRoot, jobId);
  const renderDir = path.join(publicRenderRoot, jobId);
  await fsp.mkdir(jobDir, { recursive: true });
  await fsp.mkdir(renderDir, { recursive: true });

  const scenePath = path.join(jobDir, "morphix_scene.py");
  await fsp.writeFile(scenePath, code, "utf-8");

  const manifest = {
    mode: "video",
    prompt,
    generatedAt: new Date().toISOString(),
    scenePath,
    videoAsset: null,
    rendererNotes: ["Morphix attempted a direct Manim video render for website playback."],
  };

  const manifestPath = path.join(jobDir, "render-manifest.json");
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

  const manimExecutable = process.env.MANIM_EXECUTABLE;
  const pythonExecutable = process.env.PYTHON_EXECUTABLE || "python";
  const renderResolution = process.env.MANIM_RENDER_RESOLUTION || "1280,720";
  const renderFps = process.env.MANIM_RENDER_FPS || "60";
  const renderTimeoutMs = Number(process.env.MANIM_RENDER_TIMEOUT_MS || 0);

  const runner = manimExecutable
    ? [manimExecutable, [scenePath, "MorphixScene", "-r", renderResolution, "--fps", renderFps, "-o", "scene.mp4", "--media_dir", renderDir]]
    : [pythonExecutable, ["-m", "manim", scenePath, "MorphixScene", "-r", renderResolution, "--fps", renderFps, "-o", "scene.mp4", "--media_dir", renderDir]];

  try {
    await runCommandDetailed(runner[0], runner[1], jobDir, renderTimeoutMs);
    const discoveredVideo = await findLatestFileRecursive(renderDir, ".mp4");
    if (!discoveredVideo) {
      throw new Error("Manim completed without producing a discoverable MP4 file.");
    }

    const finalVideoPath = path.join(renderDir, "scene.mp4");
    if (path.normalize(discoveredVideo) !== path.normalize(finalVideoPath)) {
      await fsp.copyFile(discoveredVideo, finalVideoPath);
    }

    manifest.videoAsset = `/renders/${jobId}/scene.mp4`;
    manifest.rendererNotes = [`Manim render completed successfully at ${renderResolution} and ${renderFps} fps.`];
    await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  } catch (error) {
    manifest.mode = "failed";
    manifest.rendererNotes = [`Manim render failed: ${error.message}`];
    await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  }

  return manifest;
}

async function buildVisualizationJob(job) {
  resetStages(job);
  job.status = "running";

  markStage(job, "prompt", "running", "Extracting the mathematical concept and equation cues.");
  await sleep(150);
  const summary = buildPromptSummary(job.prompt);
  markStage(job, "prompt", "completed", `Identified ${summary.concept}${summary.equation ? ` with equation cue "${summary.equation}".` : "."}`);

  markStage(job, "interpreter", "running", "Planning a strict JSON animation outline.");
  let interpreted = await interpretPrompt(job.prompt);
  await sleep(150);
  markStage(job, "interpreter", "completed", `Built a plan with ${(interpreted.scenes || []).length} scenes for ${interpreted.concept}.`);

  let currentDsl = buildSceneDsl(interpreted);
  markStage(job, "dsl", "running", "Translating the plan into Morphix scene DSL.");
  await sleep(120);
  markStage(job, "dsl", "completed", `Prepared ${(currentDsl.scenes || []).length} deterministic scene definitions.`);

  let finalState = null;
  let feedback = "";
  let needsPlanRepair = false;

  for (let attempt = 0; attempt <= validationIterations; attempt += 1) {
    if (attempt > 0 && needsPlanRepair) {
      markStage(job, "interpreter", "running", `Repairing the animation plan from validator feedback (attempt ${attempt}).`);
      interpreted = await repairPlan(job.prompt, interpreted, currentDsl, feedback);
      markStage(job, "interpreter", "completed", `Updated the plan using validator feedback (attempt ${attempt}).`);

      markStage(job, "dsl", "running", "Rebuilding scene DSL from the repaired plan.");
      currentDsl = buildSceneDsl(interpreted);
      markStage(job, "dsl", "completed", `Rebuilt ${(currentDsl.scenes || []).length} deterministic scene definitions.`);
      needsPlanRepair = false;
    }

    const generationProvider = resolveGenerationProvider();
    markStage(
      job,
      "codegen",
      "running",
      attempt > 0
        ? `Regenerating Manim code from validator feedback using ${generationProvider ? `${generationProvider.type}:${generationProvider.model}` : "the deterministic renderer fallback"}.`
        : `Generating Manim code using ${generationProvider ? `${generationProvider.type}:${generationProvider.model}` : "the deterministic renderer fallback"}.`,
    );
    const generated = await generateCodeFromPlan(job.prompt, interpreted, currentDsl, feedback);
    if (attempt > 0 && generated.notes) {
      generated.notes = `${generated.notes} Regeneration attempt ${attempt}.`;
    }

    const prepared = await ensureSyntacticCode(job.prompt, generated);
    markStage(job, "codegen", "completed", [generated.notes, prepared.syntax?.summary].filter(Boolean).join(" "));

    if (prepared.source === "syntax-repair-failed") {
      feedback = prepared.syntax?.diagnostics?.join(" ") || prepared.notes;
      if (attempt === validationIterations) {
        markStage(job, "codegen", "failed", feedback);
        job.status = "failed";
        job.error = feedback;
        job.result = {
          interpreted,
          dsl: currentDsl,
          source: prepared.source,
          code: prepared.code,
          syntax: prepared.syntax,
          validation: null,
          renderManifest: null,
        };
        return getJobSnapshot(job);
      }
      continue;
    }

    markStage(job, "validator", "running", "Checking math, layout, flow, and deterministic Manim safety.");
    const validation = await validateMathLayoutFlow(job.prompt, interpreted, currentDsl, prepared.code);
    const runtimeValidation = validation.valid
      ? await validateManimRuntime(prepared.code)
      : {
          valid: false,
          summary: "Runtime validation skipped because earlier validation checks did not pass.",
          issues: [],
          warnings: [],
        };

    finalState = {
      interpreted,
      dsl: currentDsl,
      source: prepared.source,
      code: prepared.code,
      syntax: prepared.syntax,
      validation,
      runtimeValidation,
    };

    if (validation.valid && runtimeValidation.valid && !hasBlockingWarnings(validation, runtimeValidation)) {
      markStage(
        job,
        "validator",
        "completed",
        [
          validation.summary,
          validation.warnings.length ? `Warnings: ${validation.warnings.join(" ")}` : "",
          runtimeValidation.warnings.length ? `Runtime warnings: ${runtimeValidation.warnings.join(" ")}` : "",
        ].filter(Boolean).join(" "),
      );
      break;
    }

    feedback = [
      validation.summary,
      validation.rationale,
      validation.issues.join(" "),
      validation.warnings.join(" "),
      runtimeValidation.summary,
      runtimeValidation.issues?.join(" ") || "",
      runtimeValidation.warnings?.join(" ") || "",
      validation.warnings.length > 0 || (runtimeValidation.warnings?.length || 0) > 0
        ? "Remove every remaining warning and return a fully clean result with no overlap, no clipping, and no weak visual explanation."
        : "",
    ].filter(Boolean).join(" ");
    needsPlanRepair = shouldRepairPlan(feedback);

    if (attempt === validationIterations) {
      markStage(job, "validator", "failed", feedback || "Validator could not approve the scene.");
      job.status = "failed";
      job.error = feedback || "Validator could not approve the scene.";
      job.result = finalState;
      return getJobSnapshot(job);
    }
  }

  markStage(job, "renderer", "running", "Rendering the final website-ready Manim video.");
  const renderManifest = await renderArtifact(job.id, job.prompt, finalState.code);

  if (!renderManifest.videoAsset) {
    markStage(job, "renderer", "failed", renderManifest.rendererNotes.join(" "));
    job.status = "failed";
    job.error = renderManifest.rendererNotes.join(" ");
    job.result = {
      ...finalState,
      renderManifest,
    };
    return getJobSnapshot(job);
  }

  markStage(job, "renderer", "completed", "Video render complete.");
  job.status = "completed";
  job.result = {
    ...finalState,
    renderManifest,
  };

  return getJobSnapshot(job);
}

module.exports = {
  buildVisualizationJob,
  getJobSnapshot,
};
