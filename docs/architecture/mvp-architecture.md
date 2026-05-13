# MVP Architecture

**Version:** 1.0  
**Date:** 2026-05-12

---

## System Overview

The MVP is a five-container system that simulates an industrial PLC, collects its telemetry, persists it in a time-series database, and visualizes it in Grafana. All containers run on a single Docker bridge network (`iot-network`) and communicate by service name.

```
┌─────────────────────────────────────────────────────────────┐
│  Docker network: iot-network                                │
│                                                             │
│  ┌──────────────┐   HTTP poll    ┌───────────────┐          │
│  │ plc-simulator│ ◄────────────  │   collector   │          │
│  │   :3001      │  GET /telemetry│               │          │
│  └──────────────┘                └───────┬───────┘          │
│                                          │ INSERT            │
│                                          ▼                   │
│                                  ┌───────────────┐          │
│  ┌──────────────┐   SELECT       │  timescaledb  │          │
│  │   processor  │ ──────────────►│    :5432      │          │
│  └──────────────┘                └───────┬───────┘          │
│                                          │ SELECT            │
│                                          ▼                   │
│                                  ┌───────────────┐          │
│                                  │    grafana    │          │
│                                  │    :3000      │          │
│                                  └───────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

---

## Service Responsibilities

### plc-simulator

- Node.js HTTP server (built-in `http` module, no framework)
- Exposes `GET /telemetry` — returns a JSON snapshot of five signals for `PLC-001`
- Exposes `GET /health` — liveness check
- Generates stateless random values on every request; no internal state between calls
- Does not write to the database or know about downstream consumers

### collector

- Polls `plc-simulator` every `COLLECTOR_INTERVAL_MS` (default: 1000 ms)
- Normalizes the response: resolves `machine_id` from the machine name, adds quality flag
- Inserts one row per signal per poll cycle into `telemetry_raw`
- Owns the only write path to `telemetry_raw`
- Does not interpret signals — no threshold checks, no event logic

### processor

- Reads from `telemetry_raw` on a `PROCESSOR_INTERVAL_MS` cycle (default: 5000 ms)
- Currently logs signal read counts from the last 10-second window
- Scaffold for future event detection and KPI computation
- Writes to `processed_events` (not yet implemented)
- Does not communicate with `plc-simulator`

### timescaledb

- PostgreSQL 15 with the TimescaleDB extension
- Schema initialized from `infrastructure/timescaledb/init.sql` on first start
- `telemetry_raw` and `processed_events` are hypertables (auto-partitioned by `time`)
- `machines` is a plain reference table, seeded with `PLC-001` and `PLC-002`
- Persistent data stored in Docker volume `timescaledb-data`

### grafana

- Grafana 13, datasource and dashboard provisioned from files at startup
- Datasource: `grafana-postgresql-datasource` connecting to `timescaledb:5432`
- Dashboard: `Industrial Telemetry` — four panels auto-loaded from `industrial.json`
- Persistent state stored in Docker volume `grafana-data`

---

## Telemetry Flow

```
1. collector timer fires (every 1 s)
2. HTTP GET http://plc-simulator:3001/telemetry
3. plc-simulator generates snapshot:
     { machineId: "PLC-001", timestamp: <ISO>, signals: [...] }
4. collector resolves machine_id (SELECT machines WHERE name = 'PLC-001')
5. collector inserts one row per signal into telemetry_raw
6. loop repeats
```

Each poll cycle produces 5 rows (one per signal). At 1 Hz this is 300 rows/minute, 18 000 rows/hour per machine.

---

## Database Schema

```sql
-- Time-series hypertable — one row per signal per reading
telemetry_raw (
  time        TIMESTAMPTZ   NOT NULL,   -- partition key
  machine_id  INTEGER       NOT NULL,
  signal_name TEXT          NOT NULL,
  value       DOUBLE PRECISION NOT NULL,
  unit        TEXT,
  quality     SMALLINT      NOT NULL DEFAULT 192
)

-- Index for panel queries
idx_telemetry_machine_signal ON (machine_id, signal_name, time DESC)

-- Future processor output — hypertable, not yet populated
processed_events (
  time             TIMESTAMPTZ NOT NULL,
  machine_id       INTEGER     NOT NULL,
  event_type       TEXT        NOT NULL,
  duration_seconds DOUBLE PRECISION,
  metadata         JSONB
)

-- Reference
machines (id, name, description)
-- Seeded: PLC-001 (id=1), PLC-002 (id=2)
```

---

## Grafana Integration

Provisioning is file-based — no manual configuration is needed after `docker compose up`.

**Datasource** (`provisioning/datasources/timescaledb.yml`)  
Connects as `grafana-postgresql-datasource` to `timescaledb:5432`, database `iot_demo`. TimescaleDB mode enabled.

**Dashboard** (`provisioning/dashboards/industrial.json`)  
Four panels, all using `rawQuery: true` against the provisioned datasource:

| Panel | Type | Query pattern |
|---|---|---|
| Speed RPM | timeseries | `SELECT time, value … WHERE signal_name = 'speed_rpm' AND $__timeFilter(time)` |
| Temperature °C | stat | `SELECT value … ORDER BY time DESC LIMIT 1` (table format) |
| Running State | timeseries | `SELECT time, value … WHERE signal_name = 'running' AND $__timeFilter(time)` |
| Parts Count | stat | `SELECT COALESCE(SUM(value), 0) … AND $__timeFilter(time)` (table format) |

Default time range: last 30 minutes. Grafana handles `$__timeFilter` expansion and browser-timezone rendering.

---

## Current Limitations

- **Single machine** — only `PLC-001` (machine_id = 1) produces data; `PLC-002` is seeded but unused
- **No event detection** — `processed_events` table exists but is never written to; the processor only logs read counts
- **No KPIs** — OEE, availability, and performance metrics are not calculated
- **Stateless simulator** — signals are independent random values; there are no realistic state transitions (e.g. machine starting up, sustained downtime)
- **No data retention policy** — TimescaleDB compression and chunk drop are not configured; data grows indefinitely
- **No external API** — there is no HTTP endpoint exposing processed data for Consuman integration
- **No persistence across schema changes** — dropping and recreating the volume is required if `init.sql` is modified after first run

---

## Next Planned Improvements

- Implement state-transition logic in `plc-simulator` (sustained running/stopped periods) to produce realistic signal sequences
- Implement event detection in `processor`: detect downtime start/end, write to `processed_events`
- Add KPI queries (OEE components) as Grafana panels sourced from `processed_events`
- Add `PLC-002` signal generation and multi-machine dashboard views
- Configure TimescaleDB compression policy for chunks older than 7 days
- Build the `api` service exposing `processed_events` for Consuman consumption
