/**
 * Thin wrappers around the Gemini image API for the two pipeline paths:
 *
 *   - `renderImage(prompt)`           — single text-to-image call.
 *   - `fuseImages(prompt, refs)`      — multi-image fusion (Whisk-style).
 *
 * Both return raw bytes + mime type. Resizing + persisting happen
 * downstream in the pipeline / asset-persistence layer.
 */
import { generateImage } from "./gemini-client";
import type { GeneratedImageBytes } from "./types";

export async function renderImage(prompt: string): Promise<GeneratedImageBytes> {
  const out = await generateImage({ prompt });
  return {
    bytes: out.bytes,
    mimeType: out.mimeType,
    promptUsed: prompt,
  };
}

/**
 * Whisk-style fusion: feed the model 2-4 reference images and a master
 * prompt that names them by position. Returns a single fused image.
 *
 * The Gemini 2.5 Flash Image model accepts multiple inlineData parts —
 * this is the API hook into that capability.
 */
export async function fuseImages(
  prompt: string,
  references: Array<{ bytes: Buffer; mimeType: string }>,
): Promise<GeneratedImageBytes> {
  const out = await generateImage({ prompt, inputImages: references });
  return {
    bytes: out.bytes,
    mimeType: out.mimeType,
    promptUsed: prompt,
  };
}
