FROM rust:1.97-bookworm AS builder

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates crates
RUN cargo build --release --package shennong-server --package shennong-cli

FROM clickhouse/clickhouse-server:26.4.4.38 AS clickhouse

FROM postgres:17-bookworm

RUN apt-get update \
    && apt-get install --no-install-recommends --yes python3 python3-venv wget \
    && python3 -m venv /opt/tiledb \
    && /opt/tiledb/bin/pip install --no-cache-dir --retries 10 --timeout 120 h5py==3.16.0 numpy==2.3.5 tiledb==0.36.1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=clickhouse /usr/bin/clickhouse /usr/bin/clickhouse
COPY --from=clickhouse /etc/clickhouse-server /etc/clickhouse-server
COPY --from=builder /app/target/release/shennong-server /usr/local/bin/shennong-server
COPY --from=builder /app/target/release/shennong-cli /usr/local/bin/shennong-cli
COPY providers /app/providers
COPY seed /app/seed
COPY docker/entrypoint.sh /usr/local/bin/shennong-entrypoint
COPY docker/clickhouse-config.xml /etc/clickhouse-server/config.d/shennong.xml
COPY docker/tiledb_backend.py /app/tiledb_backend.py
RUN chmod 755 /usr/local/bin/shennong-entrypoint \
    && chmod 755 /app/tiledb_backend.py \
    && chmod 644 /etc/clickhouse-server/config.d/shennong.xml \
    && ln -s /usr/bin/clickhouse /usr/bin/clickhouse-server \
    && ln -s /usr/bin/clickhouse /usr/bin/clickhouse-client \
    && mkdir -p /data \
    && chown postgres:postgres /data

ENV SHENNONG_BIND=0.0.0.0:8000 \
    SHENNONG_LOCAL_DATA_ROOT=/data \
    SHENNONG_PROVIDER_DIR=/app/providers \
    SHENNONG_CLICKHOUSE_URL=http://127.0.0.1:8123 \
    SHENNONG_TILEDB_SCRIPT=/app/tiledb_backend.py \
    POSTGRES_USER=shennong \
    POSTGRES_DB=shennong

VOLUME ["/data", "/var/lib/postgresql/data"]
EXPOSE 8000
ENTRYPOINT ["shennong-entrypoint"]
CMD ["shennong-server"]
