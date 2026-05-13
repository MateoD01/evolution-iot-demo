# Evolution IoT Demo

Industrial telemetry MVP for PLC integration with Consuman. Simulates the UAA production-line architecture: signal collection, time-series persistence, event processing, and real-time visualization.

---

## Architecture

```
PLC Simulator  →  Collector  →  TimescaleDB  →  Processor
   (HTTP)           (poll)       (hypertable)    (events)
                                      ↓
                                   Grafana
                                 (dashboards)
```

Each service owns a single responsibility. No shared state outside the database.

---

## Services

| Service | Role |
|---|---|
| **plc-simulator** | HTTP server that emits realistic PLC signals (speed, temperature, running state, alarms, parts count) at every request |
| **collector** | Polls the simulator every second, normalizes signals, and persists rows into `telemetry_raw` |
| **processor** | Reads recent telemetry on a 5-second cycle — scaffold for future event detection and KPI calculation |
| **timescaledb** | PostgreSQL + TimescaleDB extension; `telemetry_raw` and `processed_events` are hypertables |
| **grafana** | Pre-provisioned dashboards with live queries against TimescaleDB |

---

## Tech Stack

- **Runtime** — Node.js 20, TypeScript 5
- **Database** — PostgreSQL 15 + TimescaleDB
- **Visualization** — Grafana 13
- **Infrastructure** — Docker Compose

---

## Quickstart

```bash
cp .env.example .env
docker compose up --build
```

Services start in dependency order. TimescaleDB initializes the schema automatically on first run.

**Ports**

| Service | URL |
|---|---|
| Grafana | http://localhost:3000 |
| PLC Simulator | http://localhost:3001/telemetry |
| TimescaleDB | localhost:5432 |

---

## Grafana

Open **http://localhost:3000** — credentials `admin / admin`.

The **Industrial Telemetry** dashboard loads automatically and shows live data from PLC-001:

- Speed RPM (time series)
- Temperature °C (last value)
- Running State (time series)
- Parts Count (sum over window)

> **Screenshot placeholder** — `docs/screenshots/dashboard-overview.png`

---

## Database Schema

```sql
telemetry_raw       -- hypertable, partitioned by time
  time, machine_id, signal_name, value, unit, quality

processed_events    -- hypertable, partitioned by time
  time, machine_id, event_type, duration_seconds, metadata

machines            -- reference table
  id, name, description
```

Seed data: `PLC-001` (machine_id = 1), `PLC-002` (machine_id = 2).

---

## PLC Signals

| Signal | Unit | Range |
|---|---|---|
| `running` | bool | 0 / 1 |
| `speed_rpm` | rpm | 700 – 1000 |
| `temperature_c` | celsius | 60 – 80 |
| `parts_count` | count | 0 – 4 per cycle |
| `alarm_active` | bool | ~5% probability |

---

## MVP Capabilities

- [x] Simulated PLC telemetry over HTTP
- [x] Collector polls and persists at 1 Hz
- [x] TimescaleDB hypertables with automatic time partitioning
- [x] Grafana pre-provisioned with live datasource and dashboard
- [x] Docker Compose with health checks and restart policies
- [x] Processor scaffold — reads telemetry, ready for event logic

---

## Roadmap

- [ ] Event detection — downtime transitions, alarm bursts
- [ ] KPI calculation — OEE, availability, performance
- [ ] `processed_events` population from processor
- [ ] Grafana KPI dashboard (OEE panels, event timeline)
- [ ] Multi-machine support (PLC-002 signals)
- [ ] REST API layer for Consuman integration
- [ ] Retention policy — TimescaleDB data compression

---

## Project Structure

```
evolution-iot-demo/
├── apps/
│   ├── plc-simulator/     # HTTP telemetry emitter
│   ├── collector/         # Poll → normalize → persist
│   └── processor/         # Event detection (scaffold)
├── infrastructure/
│   ├── timescaledb/       # init.sql — schema + seed
│   └── grafana/
│       └── provisioning/
│           ├── datasources/
│           └── dashboards/
├── docs/
├── docker-compose.yml
├── .env.example
└── agents.md              # Service responsibility contracts
```
