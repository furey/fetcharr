---
title: What Fetcharr is
description: >-
  Fetcharr is a self-hosted bridge that syncs Fetch TV PVR recordings into Plex,
  named and foldered, on your LAN.
---

# What Fetcharr is

Your Fetch TV box records the shows you tell it to, then the recordings sit on the box, watchable only through Fetch's own interface. Fetcharr watches the box on your LAN, downloads new episodes of shows you mark to follow, drops the files into your Plex TV library, pokes Plex to scan, and optionally deletes the recording from the Fetch box once Plex confirms the file.

If your media stack is Fetch TV → Plex, Fetcharr is the automation in between: schedule recordings on the box as usual, and they turn up in Plex named and foldered.

![The Fetcharr dashboard](../img/screenshot-dashboard.png)

## What Fetcharr isn't

- **Not an indexer integration** (Sonarr / Radarr / Prowlarr). Fetcharr only works with what Fetch has already recorded; it doesn't tell Fetch what to record. Schedule recordings from the box's own on-screen TV guide (its EPG), as usual.
- **Not authenticated.** There's no login, so it's built for a home network you trust. The usual web hardening is in place (CSRF protection, rate limiting, a strict content-security policy), but anyone who can reach the page can change its settings, so don't expose it to the internet. See the [security model](/deep-dive#security-model).
- **Not a converter.** Files arrive from the box as `.ts` (the raw broadcast format) and stay `.ts`; Fetcharr never re-encodes them. The optional ad-cutting copies the video across untouched and just drops the ad sections, so there's no quality loss and no change of format. If you want `.mkv`, run the files through Tdarr or similar afterwards.
- **Not a notifier.** No Discord / ntfy / push integration.

> [!IMPORTANT]<br>
> Tested against a Fetch TV Mighty 3 and Plex Media Server. Other Fetch hardware and firmware are unverified.

## Where next

- **[Getting started](/guide/getting-started)** — run it with Docker and walk the first-run wizard.
- **[Following shows](/guide/following-shows)** — mark shows to follow and point them at library folders.
- **[Recordings](/guide/recordings)** and **[Syncs](/guide/syncs)** — watch downloads happen and read the status of each one.
- **[Ad removal](/guide/ad-removal)** — the optional comskip detect/cut pass.
- **[Plex](/guide/plex)** and **[Delete from Fetch](/guide/delete-from-fetch)** — the two optional integrations.
- **[Configuration](/guide/configuration)** and **[Troubleshooting](/guide/troubleshooting)** — the deploy knobs and the fixes for common snags.

It works on a phone, too: on a narrow screen every view rearranges into cards and swipeable rows of buttons.

<div class="fetcharr-mobile-shots">

![Dashboard on a phone](../img/screenshot-mobile-dashboard.png)
![Shows on a phone](../img/screenshot-mobile-shows.png)
![Recordings on a phone](../img/screenshot-mobile-recordings.png)

</div>

<style>
.fetcharr-mobile-shots {
  margin-top: 1.5rem;
}
.fetcharr-mobile-shots p {
  display: flex;
  gap: 12px;
  margin: 0;
}
.fetcharr-mobile-shots img {
  flex: 1 1 0;
  min-width: 0;
  width: 100%;
  border-radius: 10px;
  border: 1px solid var(--vp-c-divider);
}
</style>
