# ADR 0002: persistent TileDB query backend

## Decision

Use one long-lived Python worker per `TiledbExecutor`, connected over stdin and
stdout with newline-delimited JSON. The worker supports `query`, `resolve`,
`describe`, and `health`, caches feature IDs/names/barcodes per array (up to 16
arrays), and is restarted after EOF, timeout, or a malformed response.

## Alternatives

1. Rust TileDB bindings would remove Python but add a native ABI and a large
   build/runtime surface to the single image.
2. A gRPC worker would add another protocol and dependency for a local
   one-container call.
3. A process pool is a later throughput option; the current semaphore and
   worker mutex give bounded, serialized access and a predictable memory cap.

The persistent worker keeps the existing public API and avoids loading array
metadata on every request. The legacy subprocess path remains only for test
fixtures that deliberately use a non-Python executable; production uses the
`.py` worker path.
