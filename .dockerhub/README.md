# ShennongDB

ShennongDB `1.0.0` is the headless biomedical data plane for the Shennong V1
platform. It stores Resource metadata, immutable revisions, Artifacts,
Relations, Research Graph records, bounded query data, and provenance. Identity,
Project RBAC, Chat, Memory, providers, Skills, Agent orchestration, and the
browser UI belong to Shennong OS.

The image contains the internal Rust API plus PostgreSQL, SeaweedFS,
ClickHouse, and TileDB services behind container port `8000`. `/data` is its
only persistent mount. The production image does not build or start the legacy
ShennongDB WebUI or Pi runtime.

## Tags

- `latest` and `stable`: newest stable semantic-version release;
- `MAJOR.MINOR.PATCH` (for example, `1.0.0`): release tag;
- `sha-COMMIT`: immutable source-revision tag.

Resolve and deploy the image digest rather than relying on a mutable tag. Keep
the previous digest and matching data snapshot for rollback.

## Deployment

The supported V1 production path is the unified Shennong stack documented by
the [Shennong OS deployment guide](https://github.com/zerostwo/shennong-os/blob/v1.0.0/deploy/README.md).
It runs ShennongDB on a private control network with
`SHENNONG_DB_PROFILE=headless`, mounts a deployment service key as a read-only
secret file, and publishes no DB host port.

The repository's `docker-compose.production.yml` is a loopback-only standalone
diagnostic profile. It is useful for DB maintenance and contract testing, but
is not a browser product:

```bash
curl -fsSLO https://raw.githubusercontent.com/zerostwo/shennong-db/v1.0.0/docker-compose.production.yml
curl -fsSLO https://raw.githubusercontent.com/zerostwo/shennong-db/v1.0.0/.env.example
cp .env.example .env
docker compose --file docker-compose.production.yml config --quiet
docker compose --file docker-compose.production.yml up --detach --wait
curl --fail --silent --show-error http://127.0.0.1:18080/healthz
curl --fail --silent --show-error http://127.0.0.1:18080/version
```

Every data-plane request requires `X-Shennong-Admin-Key`; health and version
checks are the only intended unauthenticated operations. Do not publish the
standalone port or place the service key in browser code, URLs, logs, or shell
history.

## Supply-chain metadata

Release images include OCI source, revision, version, title, and description
labels. The release workflow publishes BuildKit provenance and SBOM
attestations, uploads an SPDX SBOM artifact, and signs the image digest with
Cosign keyless signing.

## Documentation and source

- [Source and current boundary](https://github.com/zerostwo/shennong-db/tree/v1.0.0)
- [Headless production topology](https://github.com/zerostwo/shennong-db/blob/v1.0.0/docs/production-compose.md)
- [Production verification](https://github.com/zerostwo/shennong-db/blob/v1.0.0/docs/production-hardening.md)
- [Backup and recovery](https://github.com/zerostwo/shennong-db/blob/v1.0.0/docs/backup-recovery.md)
- [OpenAPI contract](https://github.com/zerostwo/shennong-db/blob/v1.0.0/openapi/shennongdb.json)

ShennongDB is distributed under the
[MIT License](https://github.com/zerostwo/shennong-db/blob/v1.0.0/LICENSE).
