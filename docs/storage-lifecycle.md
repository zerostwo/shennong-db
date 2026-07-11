# Artifact lifecycle

Artifacts are catalog metadata plus an object in the configured BlobStore. The
database remains the source of truth for lineage and retention; files in
staging are never cataloged.

| Class | Meaning | Retention | Rebuildable |
| --- | --- | --- | --- |
| `raw` | Immutable bytes received from a provider | Retain | No |
| `canonical` | Versioned, loss-minimizing normalized data | Retain | From raw |
| `derived` | Indexes, TileDB, Parquet, embeddings | Rebuildable | Yes |
| `cache` | Query acceleration output | Delete anytime | Yes |
| `staging` | In-progress provider download or conversion | Delete after failure or expiry | Yes |

Raw objects are addressed by their SHA-256 in provenance and must be
immutable. Re-submitting the same raw checksum is idempotent; a different
checksum cannot replace the existing immutable artifact. Canonical and
derived artifacts record `source_uri`, `derived_from`, and
`pipeline_version`; a new transformation creates a new artifact id.

The local layout is:

```text
resources/.staging/<ingestion-id>/...       # never exposed in the catalog
resources/<resource>/<version>/...           # published canonical objects
```

The logical lifecycle classes map to the same BlobStore interface, so a future
object backend can use the recommended physical layout without changing the
catalog API:

```text
raw/<resource>/<version>/<sha256>/<filename>
canonical/<resource>/<version>/<pipeline-digest>/<filename>
derived/<resource>/<version>/<pipeline-digest>/<filename>
staging/<ingestion-id>/<filename>.part
```

Recovery is deliberately boring: keep `raw` and `canonical`, rebuild
`derived` and `cache` from their lineage, and remove abandoned `staging`
directories after the ingestion timeout. A backup is complete only when the
database dump and every retained raw/canonical object are captured together.
