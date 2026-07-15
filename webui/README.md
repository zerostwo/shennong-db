# ShennongDB WebUI

The active Agent-first Next.js WebUI for ShennongDB. Agent Chat is the default workspace, with focused access to Resources, Projects, personal data, model connections, secure authentication, and administration. Production and local builds target this directory.

The frozen v0.6.0 catalog-first WebUI is available at [`../web-archive/v0.6.0`](../web-archive/v0.6.0) for reference only. It is not part of the current build.

## Local development

```bash
cd webui
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

The development server uses the configured live Rust API. Authentication comes from the HttpOnly Web session exposed through the BFF; there is no runtime demo-role or mock-data mode.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm playwright
pnpm build
```

Set `SHENNONG_E2E_BASE_URL`, `SHENNONG_E2E_EMAIL`, and `SHENNONG_E2E_PASSWORD` to run Playwright against a live deployment. Reference screenshots are written to `../docs/screenshots/webui`.

## Production

The standalone image is a non-root, read-only-compatible service with a healthcheck. From the repository root:

```bash
docker compose build shennong-db-web
docker compose up -d shennong-db-web
```

Set `SHENNONG_API_INTERNAL_URL` to the internal Rust API origin. Personal tokens never replace the HttpOnly browser session.
