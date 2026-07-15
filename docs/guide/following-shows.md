---
title: Following shows
description: >-
  Mark Fetch shows to follow, match them to library folders, and set where
  episodes land.
---

# Following shows

Fetch records shows; Fetcharr syncs the ones you follow. The Shows tab is where you pick them.

## Add a show

On first visit with a Fetch box configured, the Shows tab auto-runs Refresh Shows to pull the box's recorded titles into a datalist. Pick a title and Fetcharr fuzzy-matches it against the folders already under your media root, suggesting a destination. If nothing matches, it suggests a new folder named after the show. Either way you can override the folder before saving.

![The Shows tab](../img/screenshot-shows.png)

## Season template

Each show has a season-folder template that decides where episodes land: `{season}`, `{season_padded}` (zero-padded, `01`), or `{season_unpadded}` (`1`). Fetcharr writes to `<media_root>/<dest_folder>/<season>/…` and rejects any template that would escape the media root, so a follow can only ever write inside your library.

## Enable, sync, remove

- Toggle a show enabled or disabled; disabled shows are skipped by scheduled syncs.
- Sync now on a single show downloads just its new episodes, without waiting for the schedule.
- Delete a follow to stop tracking it; downloaded files stay on disk.

## In-progress protection

Fetcharr won't download a show that's still recording. Fetch reports misleading sizes during a live record, so a currently-recording episode is skipped and picked up on the next sync after it finishes. That shows up as a `skipped` / `recording` row in [Recordings](/guide/recordings).
