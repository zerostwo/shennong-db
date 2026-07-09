# Shennong Web

Shennong Web is the first browser workbench for the Shennong platform. It is a
React/Vite app designed for:

- dataset catalog browsing
- shareable dataset release pages at `/datasets/:dataset_id`
- cell and expression exploration
- dataset-aware agent chat
- publishing workflow scaffolding
- future multi-user administration

## Run locally

```bash
cd web
npm install
npm run dev
```

The Vite dev server proxies `/v1` to `http://127.0.0.1:18000`. If the API is not
available, the app falls back to mock datasets so design and interaction can
still be reviewed.

Dataset release pages are addressable directly, for example:

```text
http://127.0.0.1:5173/datasets/toil
```

## Build

```bash
npm run build
```

## Design references

- CELLxGENE Discover: catalog, explorer, gene expression, and cell type
  discovery patterns.
- ChatGPT: conversation layout and prompt input.
- Codex: workbench model with visible actions and traceability.
