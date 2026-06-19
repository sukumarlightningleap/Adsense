/**
 * Minimal HTTP wrapper around the Gemini REST API.
 *
 * We don't pull the `@google/generative-ai` SDK — keeps the dep tree small
 * and gives us full control over JSON-mode and image-mode requests.
 *
 * Auth: GEMINI_API_KEY from env. Throws `GeminiKeyError` if missing or
 * blocked so callers can surface a clean message in the UI rather than a
 * 500.
 */

const DEFAULT_TEXT_MODEL = "gemini-2.5-flash";
const IMAGE_MODEL = "gemini-2.5-flash-image";
const ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

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
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    throw new GeminiKeyError(
      "GEMINI_API_KEY is not set. Add it to .env to enable AI generation.",
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

  const res = await fetch(`${ENDPOINT(model)}?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 403 || /API_KEY/.test(errText)) {
      throw new GeminiKeyError(
        `Gemini rejected the API key (HTTP ${res.status}). Check GCP API restrictions on the key.`,
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

  const res = await fetch(`${ENDPOINT(model)}?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 403 || /API_KEY/.test(errText)) {
      throw new GeminiKeyError(
        `Gemini rejected the API key (HTTP ${res.status}). Check GCP API restrictions on the key.`,
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
