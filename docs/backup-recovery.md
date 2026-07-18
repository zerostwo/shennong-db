# Backup, recovery, and restore drill

> V1 note: ShennongDB is headless. Metadata backup operations are initiated by
> an authorized Shennong OS workflow, not a DB WebUI. The complete DB data
> directory in the unified deployment is normally
> `/srv/shennong.one/data/db`; OS PostgreSQL, Runtime state, deployment secrets,
> and image-digest records require their own coordinated backup plan.

ShennongDB has two distinct backup layers. They solve different problems and
must not be described as interchangeable.

## 1. Metadata backup through Shennong OS or the internal API

An authorized Shennong OS backup workflow calls `POST /api/v1/backups` with the
deployment service credential to create a logical JSON snapshot of DB metadata
in ShennongDB object storage. This is an internal service operation; browser
sessions and legacy DB bearer tokens are not accepted in the headless profile.

The restore endpoint creates a safety metadata snapshot before applying the
selected backup. This layer is convenient for catalog-level recovery, but it
does not independently protect PostgreSQL files, uploaded objects, source data,
TileDB arrays, ClickHouse cache, or deployment secrets. Because the backup
object is stored inside the same `/data` failure domain, copy important logical
backups off-host.

## 2. Complete ShennongDB data-plane backup

A complete recovery point must include:

- the entire host directory mounted at `/data`;
- the exact Compose file, populated environment file, and unified secret backup;
- the deployed image tag and immutable digest;
- the ShennongDB version and backup timestamp;
- a checksum manifest.

Do not copy live PostgreSQL and ClickHouse files with a normal file-copy tool.
For the current all-in-one topology, the simplest consistent method is a short
maintenance stop or a storage-level snapshot that is atomic across the entire
data directory.

The repository helper performs a maintenance-stop archive. For the unified V1
deployment, run it from a trusted checkout and point it at the exact deployment
files and DB data directory:

```bash
cd /path/to/shennong-db
BACKUP_DIR=/backup/shennong/$(date -u +%Y%m%dT%H%M%SZ) \
COMPOSE_FILE=/srv/shennong.one/compose.yaml \
SHENNONG_ENV_FILE=/srv/shennong.one/.env \
SHENNONG_SERVICE=shennong-db \
SHENNONG_DATA_PATH=/srv/shennong.one/data/db \
  ./scripts/backup-production.sh
```

It stops only `shennong-db`, archives the contents of `SHENNONG_DATA_PATH`,
copies configuration when present, writes SHA-256 checksums, and restarts the
service if it was previously running. Protect the resulting directory because
it can contain credentials and private biomedical data.

For a large deployment, prefer a filesystem or volume snapshot:

1. stop the service or quiesce the full volume;
2. snapshot the entire data path atomically;
3. resume the service;
4. export the snapshot off-host;
5. checksum, encrypt, and record retention metadata.

## 3. Restore a complete backup

Restore to an isolated host first. Install Docker, copy the exact Compose and
environment configuration, pull the recorded image digest, and verify the
manifest:

Run `sha256sum -c MANIFEST.sha256` inside the selected backup directory before
any restore.

The restore helper refuses to replace an existing data directory unless the
operator explicitly sets `ALLOW_REPLACE=1`. It preserves the replaced directory
with a timestamped name:

```bash
ALLOW_REPLACE=1 \
COMPOSE_FILE=/srv/shennong.one/compose.yaml \
SHENNONG_ENV_FILE=/srv/shennong.one/.env \
SHENNONG_SERVICE=shennong-db \
SHENNONG_DATA_PATH=/srv/shennong.one/data/db \
  ./scripts/restore-production.sh /backup/shennong/20260714T120000Z
```

After startup, check DB health/version from the private control network, then
verify through Shennong OS that the service credential works, unauthenticated
data calls fail, Project shadows reconcile, and representative Resource,
revision, Artifact, provenance, upload, backup, and warm/cold query flows work.
Verify object checksums for a sample of large Artifacts. User/session/Project
RBAC restoration belongs to the separate OS PostgreSQL restore drill.

## 4. Recovery objectives and drills

Define and record:

- RPO: maximum acceptable data loss;
- RTO: maximum acceptable service-restoration time;
- backup frequency and off-host retention;
- encryption keys and who can perform a restore;
- expected Resource, Project-shadow, upload, and Artifact counts;
- the image digest and data snapshot used in each drill.

Run a restore drill before every production launch and on a regular schedule.
A backup is not considered valid until an isolated restore has passed health,
service authorization, Resource, object, and representative query checks.

Recommended alerts include backup age or checksum failure, readiness failure,
low disk space, persistent ingestion failure, object-storage error, PostgreSQL
or ClickHouse startup failure, cache saturation, and unexpected authentication
or grant changes.

## 5. What can be rebuilt

ClickHouse query cache and some derived indexes can be rebuilt from governed
source and canonical data. This does not make them disposable during an urgent
restore: rebuilding changes RTO and can require substantial compute and
external downloads. Record which Artifacts are authoritative, which are
derived, and which upstream sources remain reproducibly available.
