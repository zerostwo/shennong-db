# ShennongDB

ShennongDB is a metadata-first biological data infrastructure service. The
all-in-one image includes the Next.js WebUI and gateway, Rust API, PostgreSQL,
SeaweedFS object storage, a ClickHouse query cache, and TileDB-backed arrays.

## Tags

- `latest` and `stable`: newest stable semantic-version release.
- `MAJOR.MINOR.PATCH` (for example, `0.6.0`): immutable release tag.
- `sha-COMMIT`: immutable source revision tag.

For production, pin a semantic-version tag or image digest. `latest` is useful
for evaluation but is not a rollback strategy.

## Quick start

```bash
mkdir shennong-db && cd shennong-db
curl -O https://raw.githubusercontent.com/zerostwo/shennong-db/main/docker-compose.production.yml
curl -O https://raw.githubusercontent.com/zerostwo/shennong-db/main/.env.example
cp .env.example .env
# Replace both placeholder secrets in .env before starting.
docker compose -f docker-compose.production.yml pull
docker compose -f docker-compose.production.yml up -d
```

The default endpoint is `http://127.0.0.1:18080`. Useful checks:

```bash
curl http://127.0.0.1:18080/health
curl http://127.0.0.1:18080/healthz
curl http://127.0.0.1:18080/version
```

All persistent state is stored below the single `/data` mount. The image
declares `/data` as a volume and publishes container port `8000`.

## Docker run

Compose is recommended because it makes the persistent mount and security
settings explicit. A minimal direct run is:

```bash
docker volume create shennong-data
docker run -d --name shennong-db \
  -p 127.0.0.1:18080:8000 \
  -v shennong-data:/data \
  -e SHENNONG_ADMIN_API_KEY="$(openssl rand -hex 32)" \
  -e SHENNONG_JWT_SECRET="$(openssl rand -hex 32)" \
  zerostwo/shennong-db:stable
```

## Supply-chain metadata

Release images include OCI source, revision, version, title, and description
labels. The release workflow also publishes BuildKit provenance and SBOM
attestations, uploads an SPDX SBOM artifact, and signs the image digest with
Cosign keyless signing.

## Documentation and source

- [Source and full documentation](https://github.com/zerostwo/shennong-db)
- [User guide](https://github.com/zerostwo/shennong-db/blob/main/docs/guide.md)
- [Production deployment](https://github.com/zerostwo/shennong-db/blob/main/docs/production-compose.md)
- [Backup and recovery](https://github.com/zerostwo/shennong-db/blob/main/docs/backup-recovery.md)
- [Agent integrations](https://github.com/zerostwo/shennong-db/blob/main/docs/agent-integrations.md)

ShennongDB is released under the MIT License.
