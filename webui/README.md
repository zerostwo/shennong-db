# Legacy ShennongDB WebUI migration source

This pre-V1 Agent-first Next.js source is retained for migration verification
and rollback context. Its private package metadata follows the repository's
`1.0.0` release line, but Shennong OS owns and ships the V1 WebUI. The
ShennongDB production image neither builds nor copies this directory.

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

Do not deploy this source as a V1 browser application. UI fixes belong in
`shennong-os/apps/web`; this tree is tested only to protect migration fidelity.
