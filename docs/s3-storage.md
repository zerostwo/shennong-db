# S3-compatible storage

The production image sets `SHENNONG_STORAGE_BACKEND=s3` and starts an internal
SeaweedFS S3 endpoint at `http://127.0.0.1:8333`. Its object files live under
the single `/data` mount and are part of the DB backup boundary. SeaweedFS has
no public or container-network port in this bundled topology.

The same BlobStore implementation can target AWS S3 or another S3-compatible
endpoint. Configure `SHENNONG_S3_BUCKET`, `SHENNONG_S3_ENDPOINT`,
`SHENNONG_S3_REGION`, and `SHENNONG_S3_FORCE_PATH_STYLE`. Credentials come from
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` and optional
`AWS_SESSION_TOKEN`, or from the default profile in the file named by
`AWS_SHARED_CREDENTIALS_FILE`. Secrets are never included in errors or logs.

The backend streams GET responses, sends byte ranges, uses multipart PUT,
supports HEAD/delete, retries transient failures, and can issue short-lived
SigV4 presigned GET URLs. `S3Config::presign_ttl` controls the URL lifetime.

The default Docker image and Compose file already provide the bundled S3
service; no separate Compose profile is required:

```sh
docker compose up -d
curl --fail http://127.0.0.1:18080/healthz
```

The app uses only the S3-compatible contract and does not call SeaweedFS-specific
APIs. An external endpoint changes the object-storage failure and backup domain;
record its version, lifecycle policy, encryption, credentials, and snapshot
procedure in the deployment runbook instead of assuming `/data` contains the
objects.
