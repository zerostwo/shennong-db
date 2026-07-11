# S3-compatible storage

Set `SHENNONG_STORAGE_BACKEND=s3` to use the same BlobStore API against AWS S3,
SeaweedFS, or another S3-compatible endpoint. Configure `SHENNONG_S3_BUCKET`,
`SHENNONG_S3_ENDPOINT`, `SHENNONG_S3_REGION`, and
`SHENNONG_S3_FORCE_PATH_STYLE`. Credentials come from `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` for development or the default profile in
`AWS_SHARED_CREDENTIALS_FILE` for production. Secrets are never included in
errors or logs.

The backend streams GET responses, sends byte ranges, uses multipart PUT,
supports HEAD/delete, retries transient failures, and can issue short-lived
SigV4 presigned GET URLs. `S3Config::presign_ttl` controls the URL lifetime.

For local development, start the private SeaweedFS profile and point the app
at its internal S3 endpoint:

```sh
SHENNONG_STORAGE_BACKEND=s3 \
SHENNONG_S3_ENDPOINT=http://seaweedfs:8333 \
SHENNONG_S3_FORCE_PATH_STYLE=1 \
docker compose --profile seaweedfs up -d
```

The profile uses a fixed SeaweedFS image tag and an isolated volume. It has no
published host port; only the application network can reach it. The app does
not call SeaweedFS-specific APIs.
