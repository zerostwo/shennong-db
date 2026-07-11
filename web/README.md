# Shennong Web

The v0.1.0 browser is a lightweight Resource catalog and expression-query client.

```bash
cd web
npm install
npm run dev
```

Vite proxies `/api`, `/health`, `/healthz`, and `/version` to the default local
ShennongDB service at `http://127.0.0.1:8000`. Configure a different server
with `VITE_SHENNONG_API_URL`.

```bash
npm run build
```
