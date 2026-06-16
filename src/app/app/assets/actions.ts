"use server";

/**
 * Asset upload + delete actions.
 *
 * Storage: raw bytes go into Postgres (`Asset.bytes`). Fine for hundreds
 * of assets; we'll migrate to Vercel Blob / S3 once we cross ~1GB.
 *
 * Dedup: identical bytes (same sha256) under the same caller are
 * collapsed into one row — no extra storage, returns the existing ID.
 *
 * Day 2 will add the sharp resize pipeline that runs after this action.
 */
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  readDimensions,
  resizeForGoogleAds,
} from "@/lib/assets/sizing";

export type UploadState = {
  error: string | null;
  /** Set after a successful upload so the client can react. */
  uploadedAssetId: string | null;
};

const MAX_BYTES = 8 * 1024 * 1024; // 8MB per file (sits under the 10MB action limit)
const ALLOWED_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function uploadAssetAction(
  _prev: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const session = await auth();
  if (!session?.user) {
    return { error: "Sign-in required.", uploadedAssetId: null };
  }
  if (session.user.role === "demo") {
    return {
      error: "Demo users can't upload assets.",
      uploadedAssetId: null,
    };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Pick an image file first.", uploadedAssetId: null };
  }
  if (file.size > MAX_BYTES) {
    return {
      error: `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — max is ${MAX_BYTES / 1024 / 1024} MB.`,
      uploadedAssetId: null,
    };
  }
  if (!ALLOWED_MIMES.has(file.type)) {
    return {
      error: `Unsupported file type (${file.type}). Use PNG, JPEG, or WebP.`,
      uploadedAssetId: null,
    };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  // Dedup against this user's existing live assets.
  const existing = await db.asset.findFirst({
    where: {
      userId: session.user.id,
      sha256,
      demoMode: false,
    },
    select: { id: true },
  });
  if (existing) {
    revalidatePath("/app/assets");
    return { error: null, uploadedAssetId: existing.id };
  }

  const nameInput = (formData.get("name") as string | null)?.trim();
  const name = nameInput || file.name || "Untitled asset";

  const accountIdInput = (formData.get("accountId") as string | null)?.trim();
  // Optional — only tag if the account belongs to this user.
  let accountId: string | null = null;
  if (accountIdInput) {
    const account = await db.adsAccount.findFirst({
      where: {
        id: accountIdInput,
        userId: session.user.id,
        demoMode: false,
      },
      select: { id: true },
    });
    if (account) accountId = account.id;
  }

  const isLogo = (formData.get("isLogo") as string | null) === "on";
  const dims = await readDimensions(bytes);

  const created = await db.asset.create({
    data: {
      userId: session.user.id,
      accountId,
      name: name.slice(0, 255),
      kind: isLogo ? "logo" : "image",
      mime: file.type,
      sha256,
      bytes,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      demoMode: false,
    },
  });

  // Generate Google Ads variants. Fire-and-forget would be nicer for
  // perceived latency, but a sync pipeline gives us atomic guarantees:
  // either we have the original + all variants, or none.
  let variantCount = 0;
  try {
    const variants = await resizeForGoogleAds(bytes, { isLogo });
    if (variants.length > 0) {
      await db.asset.createMany({
        data: variants.map((v) => ({
          userId: session.user.id,
          accountId,
          parentAssetId: created.id,
          name: `${name.slice(0, 200)} · ${v.size.name}`,
          kind: isLogo ? ("logo" as const) : ("image" as const),
          mime: "image/png",
          sha256: v.sha256,
          // Re-wrap sharp's Buffer to satisfy Prisma's strict
          // `Buffer<ArrayBuffer>` requirement on Bytes columns.
          bytes: Buffer.from(new Uint8Array(v.bytes)),
          width: v.size.width,
          height: v.size.height,
          variantRole: v.size.role,
          demoMode: false,
        })),
      });
      variantCount = variants.length;
    }
  } catch (e) {
    // Don't fail the upload — operator still gets the original and can
    // re-trigger sizing later. Surface the cause in the audit log.
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "asset.resize_failed",
        targetKind: "asset",
        targetId: created.id,
        payload: {
          reason: e instanceof Error ? e.message : String(e),
        },
      },
    });
  }

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "asset.upload",
      targetKind: "asset",
      targetId: created.id,
      payload: {
        name,
        sha256,
        mime: file.type,
        sizeBytes: file.size,
        kind: created.kind,
        width: dims?.width,
        height: dims?.height,
        variantCount,
      },
    },
  });

  revalidatePath("/app/assets");
  return { error: null, uploadedAssetId: created.id };
}

export async function deleteAssetAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user || session.user.role === "demo") return;

  const id = String(formData.get("assetId") ?? "");
  if (!id) return;

  const asset = await db.asset.findFirst({
    where: { id, userId: session.user.id, demoMode: false },
    include: { campaignLinks: true },
  });
  if (!asset) return;

  // Refuse to delete if the asset is linked to a campaign — surfaces in
  // the UI as a stale form (the button is disabled if linkedCount > 0).
  if (asset.campaignLinks.length > 0) return;

  await db.asset.delete({ where: { id } });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "asset.delete",
      targetKind: "asset",
      targetId: id,
      payload: { name: asset.name, sha256: asset.sha256 },
    },
  });

  revalidatePath("/app/assets");
}
