# Security

## Reporting

Open a private security advisory at https://github.com/furey/fetcharr/security/advisories/new.

## Accepted Residual Risks

After the 2026-05 Dependabot sweep (bumped `fetchtv` to 1.7.3, `fast-xml-parser` to ^4.5.5, `node-cron` to ^4.2.1, overrode `qs` to ^6.15.2), two transitive advisories remain. Both are non-applicable to fetcharr's code paths.

### `ip` — GHSA-2p57-rm9w-gvfp (SSRF via `isPublic` miscategorisation)

- Pulled in transitively by `node-ssdp@4.0.1`, which is itself a transitive of `fetchtv`.
- fetcharr does not import `node-ssdp` or call `ip.isPublic` anywhere. Plex discovery uses `dgram` directly (`src/plex.js` — GDM broadcast, not SSDP), and Fetch TV discovery is delegated to the `fetchtv` package, which also does not call `ip.isPublic`.
- No upstream patch exists (`ip@2.0.1` is still affected).
- See [furey/fetchtv SECURITY.md](https://github.com/furey/fetchtv/blob/main/SECURITY.md) for the upstream decision.

### `fast-xml-parser` — GHSA-gh4j-gqv2-49f6 (XMLBuilder comment/CDATA injection)

- Affects `XMLBuilder` only. fetcharr imports `XMLParser` only (`src/plex.js`), never `XMLBuilder`.
- The 4.x line will not receive a fix; only `fast-xml-parser@5.x` patches it. Bumping to 5.x is unnecessary work given we don't touch the affected surface.
