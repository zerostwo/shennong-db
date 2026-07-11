# Resource providers

Each YAML or JSON file is an installable curated Resource. Its filename is the
provider name used by `POST /api/v1/resources/install`.

```yaml
name: opentargets
version: "24.12"
source: OpenTargets
download: https://example.org/opentargets.parquet
checksum: sha256:<sha256 digest>
resource_schema:
  kind: KnowledgeResource
  domain: gene-disease-drug
storage:
  backend: local
```

The server copies the source to `SHENNONG_LOCAL_DATA_ROOT/resources/`, verifies
the checksum when supplied, and registers both Resource metadata and Artifact.
