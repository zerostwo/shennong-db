FROM rust:1.97-bookworm AS builder

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates crates
RUN cargo build --release --package shennong-server --package shennong-cli

FROM postgres:17-bookworm

RUN apt-get update \
    && apt-get install --no-install-recommends --yes wget \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/shennong-server /usr/local/bin/shennong-server
COPY --from=builder /app/target/release/shennong-cli /usr/local/bin/shennong-cli
COPY providers /app/providers
COPY docker/entrypoint.sh /usr/local/bin/shennong-entrypoint
RUN chmod 755 /usr/local/bin/shennong-entrypoint \
    && mkdir -p /data \
    && chown postgres:postgres /data

ENV SHENNONG_BIND=0.0.0.0:8000 \
    SHENNONG_LOCAL_DATA_ROOT=/data \
    SHENNONG_PROVIDER_DIR=/app/providers \
    POSTGRES_USER=shennong \
    POSTGRES_DB=shennong

VOLUME ["/data", "/var/lib/postgresql/data"]
EXPOSE 8000
ENTRYPOINT ["shennong-entrypoint"]
CMD ["shennong-server"]
