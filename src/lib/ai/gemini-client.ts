/**
 * Minimal HTTP wrapper around Google's Gemini API.
 *
 * Supports BOTH key formats — auto-detected by prefix:
 *
 *   - "AIza…" → AI Studio key → `generativelanguage.googleapis.com/v1beta`
 *   - "AQ.…"  → Agent Platform / Vertex AI express-mode key →
 *               `aiplatform.googleapis.com/v1/publishers/google`
 *
 * Both endpoints accept the same JSON body shape we send (role: "user" +
 * generationConfig). The only difference is the URL.
 *
 * Auth precedence: GOOGLE_AGENT_PLATFORM_KEY (preferred) > GEMINI_API_KEY.
 * Throws `GeminiKeyError` if missing or blocked so callers can surface a
 * clean message in the UI rather than a 500.
 *
 * We don't pull the `@google/generative-ai` SDK — keeps the dep tree small
 * and gives us full control over JSON-mode and image-mode requests, and
 * the SDK doesn't speak the AQ. key's endpoint anyway.
 */

const DEFAULT_TEXT_MODEL = "gemini-2.5-flash";
const IMAGE_MODEL = "gemini-2.5-flash-image";

const AI_STUDIO_HOST = "https://generativelanguage.googleapis.com/v1beta";
const AGENT_PLATFORM_HOST =
  "https://aiplatform.googleapis.com/v1/publishers/google";

function endpointForKey(model: string, key: string): string {
  // AQ.-prefixed keys are Agent Platform / Vertex AI express-mode and
  // MUST hit aiplatform.googleapis.com. AIza-prefixed are AI Studio and
  // hit generativelanguage.googleapis.com.
  if (key.startsWith("AQ.")) {
    return `${AGENT_PLATFORM_HOST}/models/${model}:generateContent`;
  }
  return `${AI_STUDIO_HOST}/models/${model}:generateContent`;
}

export class GeminiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiKeyError";
  }
}

export class GeminiCallError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "GeminiCallError";
    this.status = status;
  }
}

function readKey(): string {
  // Prefer the Agent Platform key when present (AQ.* — Vertex AI express).
  // Fall back to GEMINI_API_KEY (AIza* — AI Studio) for back-compat.
  const key =
    process.env.GOOGLE_AGENT_PLATFORM_KEY?.trim() ||
    process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    throw new GeminiKeyError(
      "No Gemini key configured. Set GOOGLE_AGENT_PLATFORM_KEY (AQ.* — Vertex AI express) or GEMINI_API_KEY (AIza* — AI Studio) in .env.",
    );
  }
  return key;
}

function textModel(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_TEXT_MODEL;
}

type GenerateTextOpts = {
  prompt: string;
  /** JSON schema for structured output (responseMimeType=application/json). */
  schema?: object;
  /** Override model. Default: env GEMINI_MODEL or gemini-2.5-flash. */
  model?: string;
  /** Sampling temperature. Default 0.8 for creative copy. */
  temperature?: number;
  /**
   * Optional image inputs for multimodal calls (vision). The model sees
   * each image alongside the text prompt and can reason about pixel
   * content. Used by the vision-ingest pipeline to extract style packs
   * from reference ads.
   */
  images?: Array<{ bytes: Buffer; mimeType: string }>;
};

/**
 * Issue a text-generation call. Returns the model's first candidate text
 * verbatim, or — if `schema` was provided — the JSON-parsed value typed as
 * `T`. Pass `images` for multimodal (vision) reasoning.
 */
export async function generateText<T = string>(
  opts: GenerateTextOpts,
): Promise<T> {
  const key = readKey();
  const model = opts.model ?? textModel();

  // Order matters: image parts first, text prompt last. This is the layout
  // Gemini documents for multimodal reasoning — the text instructions get
  // applied to the preceding images.
  const parts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [];
  if (opts.images?.length) {
    for (const img of opts.images) {
      parts.push({
        inlineData: {
          mimeType: img.mimeType,
          data: img.bytes.toString("base64"),
        },
      });
    }
  }
  parts.push({ text: opts.prompt });

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: opts.temperature ?? 0.8,
      ...(opts.schema
        ? {
            responseMimeType: "application/json",
            responseSchema: opts.schema,
          }
        : {}),
    },
  };

  const res = await fetch(`${endpointForKey(model, key)}?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 403 || /API_KEY/.test(errText)) {
      const isAgentPlatform = key.startsWith("AQ.");
      throw new GeminiKeyError(
        isAgentPlatform
          ? `Vertex AI Agent Platform rejected the key (HTTP ${res.status}). Common causes: (1) the Agent Platform API is not enabled on the key's GCP project — enable at console.cloud.google.com/apis/library/aiplatform.googleapis.com; (2) billing is not attached to that project; (3) the key is restricted to a different API. Raw: ${errText.slice(0, 250)}`
          : `Gemini AI Studio rejected the key (HTTP ${res.status}). Check GCP API restrictions on the key. Raw: ${errText.slice(0, 250)}`,
      );
    }
    throw new GeminiCallError(
      `Gemini text call failed (HTTP ${res.status}): ${errText.slice(0, 400)}`,
      res.status,
    );
  }

  const json = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) {
    throw new GeminiCallError("Gemini returned no text candidate.");
  }

  if (opts.schema) {
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new GeminiCallError(
        `Gemini returned non-JSON despite schema request: ${text.slice(0, 200)}`,
      );
    }
  }
  return text as unknown as T;
}

type GenerateImageOpts = {
  prompt: string;
  /** Override model. Default: gemini-2.5-flash-image. */
  model?: string;
  /**
   * Optional reference images for image-to-image fusion. The Whisk-style
   * modular pipeline feeds in `subject.png + scene.png + style.png` here
   * with a master fusion prompt. Order matters — the prompt should
   * reference inputs by position ("the first reference is the subject…").
   */
  inputImages?: Array<{ bytes: Buffer; mimeType: string }>;
};

/**
 * Issue an image-generation call. Returns the first inline image part as a
 * Buffer plus its mime type (typically `image/png`). Pass `inputImages`
 * for image-to-image fusion.
 */
export async function generateImage(opts: GenerateImageOpts): Promise<{
  bytes: Buffer;
  mimeType: string;
}> {
  const key = readKey();
  const model = opts.model ?? IMAGE_MODEL;

  const parts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [];
  if (opts.inputImages?.length) {
    for (const img of opts.inputImages) {
      parts.push({
        inlineData: {
          mimeType: img.mimeType,
          data: img.bytes.toString("base64"),
        },
      });
    }
  }
  parts.push({ text: opts.prompt });

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseModalities: ["IMAGE", "TEXT"],
    },
  };

  const res = await fetch(`${endpointForKey(model, key)}?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 403 || /API_KEY/.test(errText)) {
      const isAgentPlatform = key.startsWith("AQ.");
      throw new GeminiKeyError(
        isAgentPlatform
          ? `Vertex AI Agent Platform rejected the key (HTTP ${res.status}). Common causes: (1) the Agent Platform API is not enabled on the key's GCP project — enable at console.cloud.google.com/apis/library/aiplatform.googleapis.com; (2) billing is not attached to that project; (3) the key is restricted to a different API. Raw: ${errText.slice(0, 250)}`
          : `Gemini AI Studio rejected the key (HTTP ${res.status}). Check GCP API restrictions on the key. Raw: ${errText.slice(0, 250)}`,
      );
    }
    throw new GeminiCallError(
      `Gemini image call failed (HTTP ${res.status}): ${errText.slice(0, 400)}`,
      res.status,
    );
  }

  const json = (await res.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: { mimeType?: string; data?: string };
        }>;
      };
    }>;
  };

  const respParts = json.candidates?.[0]?.content?.parts ?? [];
  for (const p of respParts) {
    if (p.inlineData?.data) {
      return {
        bytes: Buffer.from(p.inlineData.data, "base64"),
        mimeType: p.inlineData.mimeType ?? "image/png",
      };
    }
  }
  throw new GeminiCallError("Gemini returned no image data in candidate parts.");
}

/**
 * Liveness probe — does the configured key answer a tiny text call?
 * Returns `{ ok: true }` on success, `{ ok: false, reason }` otherwise.
 * The wizard can call this to show "AI ready" vs "AI offline" up-front.
 */
export async function isGeminiKeyLive(): Promise<{
  ok: boolean;
  reason?: string;
}> {
  try {
    await generateText({ prompt: "Say only: ok", temperature: 0 });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}
