"use client";

import { useActionState, useRef, useState } from "react";
import { motion } from "motion/react";
import { CheckCircle2, ImagePlus, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { uploadAssetAction, type UploadState } from "../actions";

const INITIAL: UploadState = { error: null, uploadedAssetId: null };

export function UploadForm({
  accounts,
}: {
  accounts: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(
    uploadAssetAction,
    INITIAL,
  );
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function onFile(f: File | null) {
    setFile(f);
  }

  function clearFile() {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <form
      action={formAction}
      className="space-y-5"
      // Reset the picked file after a successful upload.
      key={state.uploadedAssetId ?? "form"}
    >
      <div
        className={cn(
          "relative rounded-2xl border-2 border-dashed bg-card transition-colors",
          dragOver
            ? "border-brand bg-brand/[0.04]"
            : "border-border hover:border-foreground/30",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f && fileInputRef.current) {
            const dt = new DataTransfer();
            dt.items.add(f);
            fileInputRef.current.files = dt.files;
            onFile(f);
          }
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          name="file"
          accept="image/png,image/jpeg,image/webp"
          required
          disabled={pending}
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label="Pick an image file"
        />

        <div className="pointer-events-none flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
          <div className="inline-flex size-11 items-center justify-center rounded-xl bg-foreground text-background">
            <ImagePlus className="size-5" />
          </div>
          {file ? (
            <div>
              <div className="text-[14px] font-medium">{file.name}</div>
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                {file.type} · {(file.size / 1024).toFixed(1)} KB
              </div>
            </div>
          ) : (
            <div>
              <div className="text-[14px] font-medium">
                Drop an image here, or click to browse
              </div>
              <div className="mt-1 text-[12px] text-muted-foreground">
                PNG, JPEG, or WebP · 8 MB max
              </div>
            </div>
          )}
        </div>

        {file && (
          <button
            type="button"
            onClick={clearFile}
            disabled={pending}
            className="absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Clear file"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name" className="text-sm font-medium">
            Name (optional)
          </Label>
          <Input
            id="name"
            name="name"
            placeholder="Defaults to the filename"
            disabled={pending}
            className="h-10"
          />
        </div>

        {accounts.length > 0 && (
          <div className="space-y-2">
            <Label htmlFor="accountId" className="text-sm font-medium">
              Tag to account (optional)
            </Label>
            <select
              id="accountId"
              name="accountId"
              disabled={pending}
              defaultValue=""
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              <option value="">No tag</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <label className="flex items-center gap-2 text-[13px] text-foreground">
        <input
          type="checkbox"
          name="isLogo"
          disabled={pending}
          className="size-4 rounded border-border accent-foreground"
        />
        This is a logo (use square / landscape ratios)
      </label>

      {state.error && (
        <motion.div
          key={state.error}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-md border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-[13px] text-destructive"
          role="alert"
        >
          {state.error}
        </motion.div>
      )}

      {state.uploadedAssetId && !state.error && (
        <motion.div
          key={state.uploadedAssetId}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2 text-[13px] text-emerald-700"
          role="status"
        >
          <CheckCircle2 className="size-3.5" />
          Uploaded.
        </motion.div>
      )}

      <Button
        type="submit"
        disabled={pending || !file}
        className="h-10 px-5"
      >
        {pending ? (
          <>
            <Loader2 className="animate-spin" />
            Uploading…
          </>
        ) : (
          <>
            <ImagePlus />
            Upload
          </>
        )}
      </Button>
    </form>
  );
}
