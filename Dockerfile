FROM rust:1.97-bookworm AS builder

ARG VCS_REF=unknown
ARG VERSION=0.1.0

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates crates
RUN cargo build --release --package shennong-server --package shennong-cli

FROM mirror.gcr.io/library/node:24-bookworm-slim AS web-builder
WORKDIR /app/web
RUN corepack enable && corepack prepare pnpm@10.17.1 --activate
COPY web/package.json web/pnpm-lock.yaml web/.npmrc ./
RUN pnpm install --frozen-lockfile
COPY web .
ENV SHENNONG_API_INTERNAL_URL=http://127.0.0.1:8001
RUN pnpm build

FROM clickhouse/clickhouse-server:26.4.4.38 AS clickhouse

FROM chrislusf/seaweedfs:4.39 AS seaweedfs

FROM postgres:17-bookworm

ARG VCS_REF=unknown
ARG VERSION=0.1.0
LABEL org.opencontainers.image.source="https://github.com/zerostwo/shennong-db" \
      org.opencontainers.image.revision="$VCS_REF" \
      org.opencontainers.image.version="$VERSION" \
      org.opencontainers.image.title="ShennongDB"

RUN apt-get update \
    && apt-get install --no-install-recommends --yes gzip python3 python3-venv wget \
    && python3 -m venv /opt/tiledb \
    && /opt/tiledb/bin/pip install --no-cache-dir --retries 10 --timeout 120 setuptools==83.0.0 h5py==3.16.0 numpy==2.3.5 tiledb==0.36.1 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin shennong

COPY --from=clickhouse /usr/bin/clickhouse /usr/bin/clickhouse
COPY --from=clickhouse /etc/clickhouse-server /etc/clickhouse-server
COPY --from=seaweedfs /usr/bin/weed /usr/local/bin/weed
COPY --from=web-builder /usr/local/bin/node /usr/local/bin/node
COPY --from=web-builder /app/web/.next/standalone /app/web
COPY --from=web-builder /app/web/.next/static /app/web/.next/static
COPY --from=builder /app/target/release/shennong-server /usr/local/bin/shennong-server
COPY --from=builder /app/target/release/shennong-cli /usr/local/bin/shennong-cli
COPY providers /app/providers
COPY seed /app/seed
COPY docker/entrypoint.sh /usr/local/bin/shennong-entrypoint
COPY docker/clickhouse-config.xml /etc/clickhouse-server/config.d/shennong.xml
COPY docker/clickhouse/001_expression_cache.sql /app/clickhouse/001_expression_cache.sql
COPY docker/tiledb_backend.py /app/tiledb_backend.py
RUN chmod 755 /usr/local/bin/shennong-entrypoint \
    && chmod 755 /app/tiledb_backend.py \
    && chmod -R a+rX /app/providers /app/seed \
    && chmod 644 /etc/clickhouse-server/config.d/shennong.xml \
    && ln -s /usr/bin/clickhouse /usr/bin/clickhouse-server \
    && ln -s /usr/bin/clickhouse /usr/bin/clickhouse-client \
    && rm -f /usr/local/bin/gosu \
    && mkdir -p /data \
    && chown postgres:postgres /data

ENV SHENNONG_BIND=127.0.0.1:8001 \
    SHENNONG_API_INTERNAL_URL=http://127.0.0.1:8001 \
    SHENNONG_LOCAL_DATA_ROOT=/data/work \
    PGDATA=/data/postgresql \
    SHENNONG_PROVIDER_DIR=/app/providers \
    SHENNONG_STORAGE_BACKEND=s3 \
    SHENNONG_S3_BUCKET=shennong \
    SHENNONG_S3_ENDPOINT=http://127.0.0.1:8333 \
    SHENNONG_S3_REGION=us-east-1 \
    SHENNONG_S3_FORCE_PATH_STYLE=1 \
    SHENNONG_CLICKHOUSE_URL=http://127.0.0.1:8123 \
    SHENNONG_TILEDB_SCRIPT=/app/tiledb_backend.py \
    POSTGRES_USER=shennong \
    POSTGRES_DB=shennong

VOLUME ["/data"]
EXPOSE 8000
ENTRYPOINT ["shennong-entrypoint"]
CMD ["shennong-server"]
