# ADR-001 — MVP Architecture

**Date:** 2026-05-12  
**Status:** Accepted

---

## Context

This project demonstrates industrial telemetry collection and visualization for UAA production-line integration with Consuman. The goal is a working, inspectable system that proves the data flow — not a production deployment. Decisions prioritize speed to working state, debuggability, and a clear path to production when the time comes.

---

## Decisions

### 1. Docker Compose over Kubernetes

**Decision:** Single `docker-compose.yml` orchestrates all services locally.

**Rationale:**  
The MVP runs on one developer machine. Kubernetes introduces cluster management, YAML verbosity, and networking complexity that adds no value at this stage. Docker Compose provides container isolation, named networking, volume persistence, health checks, and dependency ordering — everything the MVP needs. Migration to Kubernetes is additive: the same images and environment variables carry forward.

**Rejected:** Kubernetes, Docker Swarm.

---

### 2. TimescaleDB over plain PostgreSQL or InfluxDB

**Decision:** PostgreSQL 15 with the TimescaleDB extension as the single data store.

**Rationale:**  
Industrial telemetry is time-series by nature. TimescaleDB adds automatic time partitioning (hypertables), efficient time-range queries, and built-in data compression — on top of standard PostgreSQL. This means the team uses familiar SQL, standard `pg` drivers, and any PostgreSQL-compatible tool (including Grafana's native PostgreSQL datasource) without learning a new query language. InfluxDB would require Flux or InfluxQL and a separate operational footprint for no additional benefit at MVP scale.

**Rejected:** Plain PostgreSQL (no time partitioning), InfluxDB (non-standard query language, separate stack).

---

### 3. Services separated by responsibility

**Decision:** Three distinct services — `plc-simulator`, `collector`, `processor` — each with a single, documented responsibility.

**Rationale:**  
A monolith would be faster to write initially but harder to reason about and extend. Separating responsibilities means each service can be restarted, scaled, or replaced independently. The boundary between `collector` (persist raw signals) and `processor` (derive events) is industrially meaningful: raw data is immutable, processed data is recomputed. This separation also makes it safe to iterate on event logic without risking data loss.

The contracts are documented in `agents.md` and enforced by structure, not by a framework.

**Rejected:** Single-process monolith, combined collector+processor.

---

### 4. HTTP polling over Kafka or MQTT

**Decision:** The collector polls `plc-simulator` via HTTP at a configurable interval (`COLLECTOR_INTERVAL_MS`).

**Rationale:**  
At MVP stage, the PLC is simulated — there is no real SCADA system or broker. HTTP polling is transparent (inspectable with `curl`), requires no broker infrastructure, and is trivially debuggable. The polling interval is sufficient for 1 Hz telemetry.

Kafka would require a broker, schema registry, topic management, and consumer-group logic before a single row reaches the database. MQTT requires a broker and a different client library. Both are correct choices for production, where reliability guarantees and fan-out matter. For a local demo, they are pure overhead.

The interface contract — `GET /telemetry` returns a JSON snapshot — is simple enough that swapping to MQTT or Kafka later requires changing only the collector's ingress logic, not the database schema or downstream services.

**Rejected:** Kafka (broker overhead, not justified at 1 Hz), MQTT (broker overhead, no real device to connect to), WebSocket push (inverts the dependency).

---

### 5. No authentication, no service mesh, no distributed tracing

**Decision:** The MVP ships with no auth layer, no inter-service mTLS, and no observability platform beyond Grafana.

**Rationale:**  
Every auth system, service mesh, and tracing backend added to an MVP is a system that must be understood, maintained, and debugged before the core value is proven. The MVP's goal is to show that telemetry flows from simulation to visualization correctly. Grafana logs, container logs via `docker compose logs`, and direct database queries are sufficient for that proof. Production hardening follows once the architecture is validated.

**Rejected:** OAuth2/JWT auth, Istio/Linkerd, OpenTelemetry + Jaeger/Tempo.

---

## Consequences

- The stack runs with `docker compose up --build` on any machine with Docker installed.
- All architectural boundaries are preserved in code even though enforcement is lightweight.
- Moving to production requires: replacing the simulator with a real PLC adapter, adding a message broker (Kafka or MQTT), adding auth, and deploying to a container platform. None of these require schema changes or service redesign.
