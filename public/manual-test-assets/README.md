# Manual test assets for /app/create

Drop the following image files into this folder. Manual mode on the
Create Campaign page reads from here to test the full PMax launch
pipeline without burning Gemini quota.

## Required files

| Filename | Ratio | Min size | Recommended | Required? |
|---|---|---|---|---|
| `logo-square.png` | 1:1 | 128×128 | **1200×1200** | YES |
| `marketing-landscape.png` | 1.91:1 | 600×314 | **1200×628** | YES |
| `marketing-square.png` | 1:1 | 300×300 | **1200×1200** | YES |
| `marketing-portrait.png` | 4:5 (0.8:1) | 480×600 | **960×1200** | optional |
| `logo-landscape.png` | 4:1 | 512×128 | **1200×300** | optional |

## Tips

- File extension must be `.png` (we read by exact filename).
- Max 5 MB each (Google's hard cap for image assets).
- Take one wide source photo and crop it into all 5 ratios with
  different framing — same brand, different compositions.
- Files in this folder are **not** committed to git (see .gitignore
  in this repo's root if present — drop them locally only).

After dropping the files, toggle "Manual mode" on the Create
Campaign page, then click "Launch test campaign".
