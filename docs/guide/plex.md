---
title: Plex
description: >-
  Optional Plex integration — token detection and a library refresh after every
  sync that downloaded something.
---

# Plex

Plex is optional. Without it, Fetcharr still downloads and files episodes; you just refresh the library yourself. With it, Fetcharr refreshes the right section after every sync that downloaded something.

## Point Fetcharr at Plex

In Settings, set your Plex server URL and token, then Load sections and pick the TV library section. Auto-discover finds a Plex server on your network the same way Plex's own apps do (a protocol called GDM).

## The token

- **Auto-detect** reads `PlexOnlineToken` from Plex's `Preferences.xml`, which only works when Plex runs on the same host and you've bind-mounted the file (`PLEX_PREFS_PATH`; see [Configuration](/guide/configuration)).
- Otherwise **paste the token manually**; grab it from `app.plex.tv` or Plex's own support article on finding your token.

## Refresh

After any sync that saved a file, Fetcharr refreshes the configured section so new episodes appear without waiting for Plex's own scan interval. Refresh Plex now triggers it on demand.

## Where the files land

Downloads write under your media root using each show's folder and season template ([Following shows](/guide/following-shows)); Plex reads them as an ordinary TV library.
