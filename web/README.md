# ShennongDB WebUI

Production-oriented Next.js App Router frontend for the public catalog, user console, secure authentication flows, and administrator workspace.

## Local development

```bash
cd web
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Use the browser API mock during isolated UI development:

```bash
NEXT_PUBLIC_MSW_ENABLED=1 NEXT_PUBLIC_SHENNONG_DEMO_ROLE=admin pnpm dev
```

`NEXT_PUBLIC_SHENNONG_DEMO_ROLE` accepts `guest`, `user`, or `admin` and is only read when explicitly set. Production authentication always comes from the HttpOnly Web session exposed by the Rust API through the BFF.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm playwright
pnpm build
```

The Playwright suite starts the role-aware MSW environment and writes reference screenshots to `../docs/screenshots/webui`.

## Production

The standalone image is a non-root, read-only-compatible service with a healthcheck. From the repository root:

```bash
docker compose build shennong-db-web
docker compose up -d shennong-db-web
```

Set `SHENNONG_API_INTERNAL_URL` to the internal Rust API origin. Personal tokens never replace the HttpOnly browser session.
