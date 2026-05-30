FROM rust:1.89-slim AS builder
RUN apt-get update && apt-get install -y pkg-config libssl-dev cmake && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY engine engine/
COPY ingestor ingestor/
COPY pyth-consumer pyth-consumer/
COPY bench bench/
RUN cargo build --release -p pyth-consumer

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/pyth-consumer /usr/local/bin/pyth-consumer
CMD ["pyth-consumer"]
