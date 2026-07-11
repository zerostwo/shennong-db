# Shennong Web

The v0.1.0 browser is a Next.js Resource catalog, user console, administrator
workspace, and authentication shell. The catalog uses the local adapter until
the authenticated API routes are enabled.

```bash
cd web
npm install
npm run dev
```

The pages are static-safe and can be connected to `/api/v1` once the session
middleware is enabled. Build and type checks are available with:

```bash
npm run typecheck
npm run build
```
