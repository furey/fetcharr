---
title: Reference
description: >-
  The technical companion to the guide — how Fetcharr works under the hood, and
  why it works that way.
---

# Reference

The guide covers how to run Fetcharr and use each tab. This section is the companion for how it works underneath, and why.

Most of it lives in one place:

- **[Technical deep dive](/deep-dive)** — architecture, the sync state machine, why delete-from-Fetch goes through the cloud rather than the LAN, the ad-removal pipeline, the live-progress registry, the mobile layout, the full environment reference, the Docker deployment model, the security model, and local development.

The deep dive is a single long page with its own contents list; the right-hand outline follows along as you scroll. If you're after a specific mechanism (why a recording lands as `partial`, how keep-segments are computed for a cut, what the `I_AM_ALIVE` handshake is doing), start there.

For the source itself, see the [repository on GitHub](https://github.com/furey/fetcharr).
