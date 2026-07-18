# syntax=docker/dockerfile:1.7

FROM rust:1.97-bookworm@sha256:77fac8b98f9f46062bb680b6d25d5bcaabfc400143952ebc572e924bcbedc3fa AS builder

ARG VCS_REF=unknown
ARG VERSION=1.0.0

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates crates
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,target=/app/target,sharing=locked \
    cargo build --locked --release --package shennong-server --package shennong-cli --package shennong-mcp \
    && install -d /out \
    && install -m 0755 target/release/shennong-server /out/shennong-server \
    && install -m 0755 target/release/shennong-cli /out/shennong-cli \
    && install -m 0755 target/release/shennong-mcp /out/shennong-mcp

FROM clickhouse/clickhouse-server:26.4.4.38@sha256:338a4187b899c53ff2300e3ab33be047a3a7f4ede161af0bed077815be6f2425 AS clickhouse

FROM chrislusf/seaweedfs:4.39@sha256:c7d6c721b30ae711db766bbbfd40192776e263d4e51e22f57baef7bef93c12c6 AS seaweedfs

FROM debian:bookworm-slim@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818 AS runtime-binaries
RUN apt-get update \
    && apt-get install --no-install-recommends --yes binutils \
    && rm -rf /var/lib/apt/lists/*
COPY --from=clickhouse /usr/bin/clickhouse /out/clickhouse
COPY --from=seaweedfs /usr/bin/weed /out/weed
COPY --from=builder /out/shennong-server /out/shennong-server
COPY --from=builder /out/shennong-cli /out/shennong-cli
COPY --from=builder /out/shennong-mcp /out/shennong-mcp
RUN chmod u+w /out/* \
    && strip --strip-unneeded /out/* \
    && chmod 755 /out/*

FROM postgres:17-bookworm@sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394

ARG VCS_REF=unknown
ARG VERSION=1.0.0
LABEL org.opencontainers.image.source="https://github.com/zerostwo/shennong-db" \
      org.opencontainers.image.revision="$VCS_REF" \
      org.opencontainers.image.version="$VERSION" \
      org.opencontainers.image.title="ShennongDB"

RUN apt-get update \
    && apt-get install --no-install-recommends --yes gzip python3 python3-venv wget \
    && python3 -m venv /opt/tiledb \
    && /opt/tiledb/bin/pip install --no-cache-dir --retries 10 --timeout 600 setuptools==83.0.0 h5py==3.16.0 numpy==2.3.5 tiledb==0.36.1 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin shennong

COPY --from=runtime-binaries /out/clickhouse /usr/bin/clickhouse
COPY --from=clickhouse /etc/clickhouse-server /etc/clickhouse-server
COPY --from=runtime-binaries /out/weed /usr/local/bin/weed
COPY --from=runtime-binaries /out/shennong-server /usr/local/bin/shennong-server
COPY --from=runtime-binaries /out/shennong-cli /usr/local/bin/shennong-cli
COPY --from=runtime-binaries /out/shennong-mcp /usr/local/bin/shennong-mcp
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

ENV SHENNONG_BIND=0.0.0.0:8000 \
    SHENNONG_ENV=production \
    SHENNONG_DB_PROFILE=headless \
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
