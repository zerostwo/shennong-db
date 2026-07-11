# Resource providers

Each YAML file is an installable curated Resource. Its filename is the
provider name used by `POST /api/v1/resources/install`.

```yaml
name: opentargets
version: "24.12"
source: OpenTargets
files:
  - id: opentargets-data
    download: https://example.org/opentargets.parquet
    filename: opentargets.parquet
    format: parquet
    download_size: 1000000
    size: 1000000
    checksum: sha256:<sha256 digest>
    canonical_checksum: sha256:<sha256 digest after decompression, if applicable>
    uncompressed_size: 1000000
    compression: null
    index: null
    schema: {role: evidence}
resource_schema:
  kind: KnowledgeResource
  domain: gene-disease-drug
resource_spec:
  backend: local
  operations: [artifacts]
storage:
  backend: local
```

The server streams each source into `SHENNONG_LOCAL_DATA_ROOT/resources/`,
resumes partial downloads, verifies the declared SHA-256 and Content-Length,
decompresses declared gzip files with a hard uncompressed-size limit, builds a
byte-offset index when `index: gene_matrix`, and registers raw, canonical, and
index Artifacts with their checksums and provenance. Raw compressed files are
retained after materialization.

Production mode rejects a Provider file without a SHA-256 checksum. For an
isolated development fixture only, set SHENNONG_PROVIDER_ALLOW_UNVERIFIED=1;
the resulting Artifacts are explicitly marked `integrity_status: unverified`.

`toil.yaml` is the built-in complete TCGA TARGET GTEx provider. It installs the
TPM expression matrix, phenotype, category, survival endpoints, and GENCODE v23
gene map from the UCSC Xena Toil hub.

PBMC 1k/3k/4k are ordinary provider examples when supplied by an operator. A
manifest can declare a generic 10x HDF5 materializer; the installer runs it
after atomic directory promotion but before the catalog transaction, then
records the output as a rebuildable derived Artifact:

```yaml
storage:
  backend: local
  materializer:
    id: tiledb
    command: /app/tiledb_backend.py
    python: /opt/tiledb/bin/python
    source_file: pbmc3k.h5
    target: derived/pbmc-3k
    format: tiledb
    storage_backend: tiledb
    version: tiledb-0.36.1
    schema: {role: expression, layout: sparse_feature_by_cell}
```

The source file checksum is required in production. A missing source, corrupt
HDF5 file, or failed materializer leaves the ingestion job failed and does not
publish an `available` Resource. Re-running the same provider is idempotent.
