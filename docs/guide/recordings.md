---
title: Recordings
description: >-
  The per-episode ledger — download outcomes, live progress bars, re-scans, and
  tombstones.
---

# Recordings

The Recordings tab is the per-episode ledger: every download Fetcharr has attempted, with its outcome.

![The Recordings tab](../img/screenshot-recordings.png)

## Statuses

- **done** — downloaded and complete.
- **partial** — the on-disk bytes fell short of what Fetch reported; the next sync resumes from where it stopped (HTTP Range), so partials usually heal themselves.
- **skipped / recording** — the episode was still recording when the sync ran; it's retried on the next pass after it finishes.
- **failed** — the download errored.

With ad removal on, an ad status also appears: `scanning`, `detected`, `no_breaks`, `cut`, `detect_failed`, or `cut_failed`. See [Ad removal](/guide/ad-removal).

## Live progress

While a download, ad scan, or cut is running, the row shows a thin progress bar with a percent and ETA caption, and the list polls every 2 seconds instead of the idle 60. A download bar carries byte rate and ETA; a scan bar counts down from a duration estimate; a cut shows a segment counter. Once nothing is active the list drops back to the slow poll.

## Re-scan and re-cut

The row can re-run an ad scan or cut against the already-downloaded file without redownloading, so you can trial detection on recordings you already have.

## Tombstones

A recording deleted from the Fetch box appears struck-through and dimmed (a tombstone), but its pills, buttons, and progress bar stay legible: a tombstoned recording still exists on disk and can be re-scanned or re-cut.

## Filters and time

Filter by `ON FETCH` / `DELETED`; the `WHEN` filter adds `1H` / `24H` shortcuts for recent activity. Timestamps render in the container's `TZ` regardless of which device you're browsing from.
