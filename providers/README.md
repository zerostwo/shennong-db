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
resumes partial downloads, verifies size and optional SHA-256, decompresses
declared gzip files, builds a byte-offset index when `index: gene_matrix`, and
registers the Resource and all Artifacts.

`toil.yaml` is the built-in complete TCGA TARGET GTEx provider. It installs the
TPM expression matrix, phenotype, category, survival endpoints, and GENCODE v23
gene map from the UCSC Xena Toil hub.
