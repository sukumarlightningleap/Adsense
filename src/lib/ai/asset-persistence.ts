/**
 * Shared "persist a Gemini-generated image as a full Asset tree" helper.
 *
 * Pulled out of the pipeline so both `pipeline-simple` and
 * `pipeline-modular` use the identical persist path:
 *
 *   1. Dedup against `(userId, sha256)` — never store the same bytes twice.
 *   2. Create the parent Asset row (the raw generated image).
 *   3. Run `resizeForGoogleAds` to produce sharp variants:
 *      - master image → 3 variants (landscape, square, portrait)
 *      - logo        → 2 variants (square, landscape)
 *   4. Persist variants linked to the parent via `parentAssetId`.
 *   5. Audit-log the generation.
 *
 * The PMAX adapter resolves "parent + role" back to the right child
 * variant at launch time, so the wizard can point all 3 marketing role
 * slots at the same master parent ID — no duplication needed.
 */
import { createHash } from "node:crypto";

import { db } from "@/lib/db";
import type { AssetRole } from "@/lib/ads/types";
import { resizeForGoogleAds, resizeForRole } from "@/lib/assets/sizing";

import type { GeneratedImageBytes } from "./types";

export async function persistGeneratedImage(
  img: GeneratedImageBytes,
  opts: {
    userId: string;
    accountId: string | null;
    isLogo: boolean;
    label: string;
    /** Free-form audit tag — "pipeline-simple", "pipeline-modular:fusion". */
    auditSource: string;
  },
): Promise<string> {
  const sha256 = createHash("sha256").update(img.bytes).digest("hex");

  // Dedup: reuse parent if these exact bytes already exist for the user.
  const existing = await db.asset.findFirst({
    where: { userId: opts.userId, sha256, demoMode: false },
    select: { id: true },
  });
  if (existing) return existing.id;

  const parent = await db.asset.create({
    data: {
      userId: opts.userId,
      accountId: opts.accountId,
      name: opts.label.slice(0, 255),
      kind: opts.isLogo ? "logo" : "image",
      mime: img.mimeType,
      sha256,
      bytes: Buffer.from(new Uint8Array(img.bytes)),
      width: null,
      height: null,
      demoMode: false,
    },
  });

  try {
    const variants = await resizeForGoogleAds(img.bytes, {
      isLogo: opts.isLogo,
    });
    if (variants.length > 0) {
      await db.asset.createMany({
        data: variants.map((v) => ({
          userId: opts.userId,
          accountId: opts.accountId,
          parentAssetId: parent.id,
          name: `${opts.label.slice(0, 200)} · ${v.size.name}`,
          kind: opts.isLogo ? ("logo" as const) : ("image" as const),
          mime: "image/png",
          sha256: v.sha256,
          bytes: Buffer.from(new Uint8Array(v.bytes)),
          width: v.size.width,
          height: v.size.height,
          variantRole: v.size.role,
          demoMode: false,
        })),
      });
    }
  } catch (e) {
    await db.auditLog.create({
      data: {
        userId: opts.userId,
        action: "asset.resize_failed",
        targetKind: "asset",
        targetId: parent.id,
        payload: {
          reason: e instanceof Error ? e.message : String(e),
          source: opts.auditSource,
        },
      },
    });
  }

  await db.auditLog.create({
    data: {
      userId: opts.userId,
      action: "asset.ai_generate",
      targetKind: "asset",
      targetId: parent.id,
      payload: {
        sha256,
        mime: img.mimeType,
        kind: parent.kind,
        promptUsed: img.promptUsed.slice(0, 500),
        source: opts.auditSource,
      },
    },
  });

  return parent.id;
}

/**
 * Persist a user-uploaded image as the source for a single Google Ads
 * role slot. Creates the parent (original bytes) + one variant resized
 * to the role's exact dimensions. The PMAX adapter's resolveAssetForRole
 * then picks up the variant at launch time — same path the AI pipeline
 * uses, so launch behaviour is identical regardless of source.
 *
 * Caller is expected to have validated mime + dimensions client-side;
 * we re-validate here as a safety net.
 */
export async function persistUploadedImageForRole(
  raw: { bytes: Buffer; mime: string },
  opts: {
    userId: string;
    accountId: string | null;
    role: AssetRole;
    label: string;
  },
): Promise<string> {
  const sha256 = createHash("sha256").update(raw.bytes).digest("hex");

  const existing = await db.asset.findFirst({
    where: { userId: opts.userId, sha256, demoMode: false },
    select: { id: true },
  });
  if (existing) return existing.id;

  const isLogo = opts.role === "square_logo" || opts.role === "landscape_logo";

  const parent = await db.asset.create({
    data: {
      userId: opts.userId,
      accountId: opts.accountId,
      name: opts.label.slice(0, 255),
      kind: isLogo ? "logo" : "image",
      mime: raw.mime,
      sha256,
      bytes: Buffer.from(new Uint8Array(raw.bytes)),
      width: null,
      height: null,
      demoMode: false,
    },
  });

  try {
    const variant = await resizeForRole(raw.bytes, opts.role);
    await db.asset.create({
      data: {
        userId: opts.userId,
        accountId: opts.accountId,
        parentAssetId: parent.id,
        name: `${opts.label.slice(0, 200)} · ${variant.size.name}`,
        kind: isLogo ? "logo" : "image",
        mime: "image/png",
        sha256: variant.sha256,
        bytes: Buffer.from(new Uint8Array(variant.bytes)),
        width: variant.size.width,
        height: variant.size.height,
        variantRole: variant.size.role,
        demoMode: false,
      },
    });
  } catch (e) {
    await db.auditLog.create({
      data: {
        userId: opts.userId,
        action: "asset.resize_failed",
        targetKind: "asset",
        targetId: parent.id,
        payload: {
          reason: e instanceof Error ? e.message : String(e),
          source: `upload:${opts.role}`,
        },
      },
    });
  }

  await db.auditLog.create({
    data: {
      userId: opts.userId,
      action: "asset.upload",
      targetKind: "asset",
      targetId: parent.id,
      payload: {
        sha256,
        mime: raw.mime,
        role: opts.role,
      },
    },
  });

  return parent.id;
}
