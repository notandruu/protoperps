"""Circuit breakers for external dependencies."""

import pybreaker

# Trips after 5 failures in a 60s window; stays open for 30s before half-open.
kafka_breaker = pybreaker.CircuitBreaker(
    fail_max=5,
    reset_timeout=30,
    name="kafka_orders",
)

postgres_breaker = pybreaker.CircuitBreaker(
    fail_max=10,
    reset_timeout=60,
    name="postgres",
)

redis_breaker = pybreaker.CircuitBreaker(
    fail_max=10,
    reset_timeout=30,
    name="redis",
)
