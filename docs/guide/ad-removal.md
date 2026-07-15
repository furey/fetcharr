---
title: Ad removal
description: >-
  Optional comskip commercial detection and keyframe stream-copy cutting, with a
  detect-only audit mode.
---

# Ad removal

Free-to-air recordings carry their ad breaks. Fetcharr can detect them, and optionally cut them out, using comskip and ffmpeg baked into the image. It's off by default, and built assuming detection is sometimes wrong.

> [!WARNING]<br>
> Detection accuracy on AU free-to-air varies by channel. Trial `DETECT` mode and check the reported breaks before you let it `CUT`.

## Turn it on

Two gates have to line up: a global switch in Settings → AD REMOVAL (off by default), and a per-show mode on the Shows tab.

## Modes

- **DETECT** records where the breaks are and stores them on the recording, without touching the file. Use it to audit comskip's accuracy on your channels.
- **CUT** removes the breaks with a keyframe stream-copy (no re-encode; output stays `.ts`) and keeps the original as `<file>.ts.orig`.

## Backups and retention

Every cut keeps a `.ts.orig` backup for a configurable window (`ad_original_retention_days`, default 7), pruned during housekeeping. A bad cut is recoverable by renaming the `.orig` back over it.

## The comskip.ini

Fetcharr ships a `comskip.ini` tuned for AU free-to-air. Drop your own `comskip.ini` into the `/config` bind mount to override it; Settings shows which one is active.

## Cost and gating

Scans are CPU-bound: budget roughly 30 minutes per 75-minute recording on NAS-class hardware. The scan is niced so it doesn't starve concurrent downloads. For a `CUT`-mode show, delete-from-Fetch is only queued once the cut verifies, so the box keeps the pristine copy if a cut fails.

Cuts snap to keyframes, so a second or two either side of a break is expected. The full pipeline (verify-then-swap, keep-segment maths, crash recovery) is in the [deep dive](/deep-dive#ad-removal).
