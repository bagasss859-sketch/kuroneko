# Security Policy

## Supported versions

Security fixes are applied to the latest release on `main`. Older versions are not actively maintained.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Instead, report privately via GitHub's private vulnerability reporting on this repository (Settings → Security → "Report a vulnerability"), or open a draft PR if you have a fix.

When reporting, include:

- The affected module and line/function
- A minimal reproduction (if possible)
- Impact: what an attacker could do
- Suggested fix, if you have one

## What we care about

- **Credential handling**: sources may require secrets (app secret + salt) or session cookies. If a code path logs, commits, or exposes those values, that is a high-priority issue.
- **SSRF / URL safety**: all URLs that originate from third-party sites must stay protected by `safeHttpUrl`/`isSafeExternalUrl` (src/security.js). A bypass would let scraped content target internal services.
- **Injection via scraped content**: HTML stripping must prevent script/style injection when scraped text is rendered by consumers.
- **Dependency supply chain**: the project has zero runtime dependencies — report anything that would add one unnecessarily.

## Security checklist for maintainers

- Verify no `.env*` files or real credentials are ever committed (`git status` before push).
- New sources must sanitize all external input before it leaves the module.
- Keep the offline test suite green — it is the safety net for parsers.
