# Contributing

Thanks for considering a contribution. This project is intentionally small and dependency-free — please keep it that way.

## Project layout

```
src/          scraper modules (ESM, zero dependencies, global fetch)
test/         offline unit tests (no network required)
examples/     runnable usage examples
```

## Development

1. Clone and enter the repo. There are no dependencies to install — it runs on plain Node.js ≥ 18.17.
2. Run the offline test suite:

   ```bash
   npm test
   ```

   (The suite is fully offline. Live smoke tests exist separately and are only run in CI/at your discretion.)

3. Add or update tests for any change. Tests live in `test/` and must not require network access or real credentials.

## Style

- ESM only (`import`/`export`), no build step, no transpilation.
- **Zero runtime dependencies** — if a change needs a library, prefer implementing it with `fetch` + regex/JSON parsing instead.
- Keep every module self-contained; share only via `src/cache.js` and `src/security.js`.
- Normalize and sanitize all data that originates from external sources (`safeHttpUrl`, `stripHtml`).
- Use plain `Error`s with descriptive messages; never throw raw HTML or unparsed payloads.
- Comment non-obvious parsing logic (the sites change; future readers need the "why").

## Secrets and credentials

- Never commit `.env`, `.env.local`, or any real secret/token/cookie.
- If a source needs credentials, document them in `.env.example` and README, and read them at runtime from `process.env`.
- Do not include real cookies or API secrets in test fixtures — use synthetic values.

## Pull requests

1. Fork the repo and create a branch (`feat/...`, `fix/...`).
2. Make your change with tests.
3. Run `npm test` and ensure everything passes.
4. Open a PR against `main` using the PR template. Keep the description focused: what changed, why, and how it was tested.

## Reporting issues

Use the issue templates. For security-related findings, see `SECURITY.md` — do not open a public issue for credential leaks or vulnerabilities.
