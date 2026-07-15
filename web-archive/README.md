# Archived WebUI

`v0.6.0/` is a frozen source snapshot of the catalog-first WebUI from commit
`0bcfecf38ee1ef745249dbff30c529c4e64c4ced` (ShennongDB `v0.6.0`). It is kept
for historical reference and rollback-oriented code comparison only.

The active Agent-first application lives in [`../webui`](../webui). Docker,
Compose, CI, local development, and release builds must use `webui/`; the
archive is excluded from the Docker build context and must not receive feature
or dependency updates.

To verify a file against the frozen Git source:

```bash
git show 0bcfecf:web/path/to/file | sha256sum
sha256sum web-archive/v0.6.0/path/to/file
```
