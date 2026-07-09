# Security

## Reporting

Open a private security advisory at https://github.com/furey/fetcharr/security/advisories/new.

## Threat model

Fetcharr is an authless service for a **trusted home LAN**. It has no login: anyone who can reach the port can read configuration and change settings. CSRF, rate limiting, a strict CSP, and `noindex` headers are in place, and cross-origin browser attacks are blocked (no CORS, `SameSite=Strict` cookie, mandatory custom header), but the following are accepted consequences of the design, not defects. Do not expose Fetcharr to the internet.

- **`GET /api/settings` returns configuration to any LAN client.** The Plex token and Fetch Cloud PIN are never returned (they collapse to `*_set` booleans), but the Fetch box IP, Plex URL, media/config paths, and the Fetch Cloud activation code are. The activation code is half of the cloud credential pair (useless without the PIN) and is shown in the UI like an account identifier; on a trusted LAN this is acceptable.
- **`plex_url` is a server-side request vector.** `POST /api/plex-sections` and `/api/plex-refresh` fetch a caller-supplied URL, so a LAN client can use Fetcharr as a bounded HTTP status oracle against other hosts. Blocking private ranges isn't viable because Plex itself lives on a private LAN address.
- **No DNS-rebinding / `Host`-header defense.** A trusted-LAN, plain-HTTP service accessed by IP can't meaningfully allowlist `Host`. This is the same class as HSTS being disabled: re-add both when fronting Fetcharr with TLS and a stable hostname.

## Accepted Residual Risks

Fetcharr pins `fetchtv@1.8.2` and overrides `qs` to `^6.15.2`. Two transitive advisories remain in the dependency tree; both are non-applicable to fetcharr's code paths.

### `ip` — GHSA-2p57-rm9w-gvfp (SSRF via `isPublic` miscategorisation)

- Pulled in transitively by `node-ssdp@4.0.1`, which is itself a transitive of `fetchtv`.
- fetcharr does not import `node-ssdp` or call `ip.isPublic` anywhere. Plex discovery uses `dgram` directly (`src/plex.js` — GDM broadcast, not SSDP), and Fetch TV discovery is delegated to the `fetchtv` package, which also does not call `ip.isPublic`.
- No upstream patch exists (`ip@2.0.1` is still affected).
- See [furey/fetchtv SECURITY.md](https://github.com/furey/fetchtv/blob/main/SECURITY.md) for the upstream decision.

### `fast-xml-parser` — GHSA-gh4j-gqv2-49f6 (XMLBuilder comment/CDATA injection)

- Affects `XMLBuilder` only. fetcharr imports `XMLParser` only (`src/plex.js`), never `XMLBuilder`.
- The 4.x line will not receive a fix; only `fast-xml-parser@5.x` patches it. Bumping to 5.x is unnecessary work given we don't touch the affected surface.
