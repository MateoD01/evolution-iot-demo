# Session Summary — 2026-05-12

**Project:** Evolution IoT Demo  
**Goal:** Industrial telemetry MVP for PLC integration with Consuman / UAA  
**Session duration:** ~1 full development day

---

## Completed Milestones

1. Full telemetry pipeline operational end-to-end (PLC → DB → Grafana)
2. Grain silo plant simulator rewritten with correlated physical assets
3. Operational analysis document created from live telemetry
4. Executive dashboard built and localized to Spanish
5. Maintenance dashboard built with ISO 10816 vibration zones

---

## Implemented Architecture

```
PLC Simulator (Node.js/TypeScript)  →  /telemetry HTTP endpoint
        ↓ polled at 1 Hz
Collector Service                   →  INSERT into telemetry_raw
        ↓
TimescaleDB (hypertable)            →  telemetry_raw, processed_events
        ↓ polled continuously
Processor Service                   →  event detection → processed_events
        ↓
Grafana 13                          →  2 provisioned dashboards
```

**Services (all healthy):**

| Container | Uptime |
|---|---|
| iot-timescaledb | 5 h (healthy) |
| iot-collector | 5 h |
| iot-processor | 3 h |
| iot-grafana | 4 h |
| iot-plc-simulator | 1 h (restarted after rewrite) |

---

## Telemetry Pipeline Status

| Metric | Value |
|---|---|
| Total rows in `telemetry_raw` | 203 893 |
| Distinct signals | 36 |
| Events in `processed_events` | 1 128 (376 per type) |
| Collection start | 2026-05-12 |
| Collection rate | ~1 Hz per signal |

---

## Industrial Assets Modeled

Grain silo plant with 7 physical assets and correlated physics:

| Asset ID | Type | Signals | Notes |
|---|---|---|---|
| VOLCABLE-01 | Intake conveyor | running, throughput_tph, current_a, alarm_active | Drives chain start |
| REDLER-01 | Horizontal conveyor | running, throughput_tph, current_a, temperature_c, vibration_mm_s, alarm_active | Tracks VOLCABLE load (corr 0.75) |
| NORIA-01 | Bucket elevator | running, throughput_tph, current_a, temperature_c, vibration_mm_s, alarm_active | Critical path; tracks REDLER (corr 0.90) |
| DISTRIBUIDORA-01 | Distributor | running, throughput_tph, current_a, alarm_active | Mechanically locked to NORIA (corr 0.94) |
| SECADORA-01 | Grain dryer | running, temperature_c, humidity_pct, current_a, alarm_active | Temp ↔ humidity corr −0.94 |
| SILO-HUMEDO-01 | Wet grain silo | capacity_pct, fan_running, alarm_active | Auto-fan above 20% |
| SILO-SECO-01 | Dry grain silo | capacity_pct, fan_running, alarm_active | Constant drain (shipment) |

**Legacy signals still present** (from original generic simulator): `running`, `speed_rpm`, `temperature_c`, `alarm_active`, `parts_count` — mapped to machine_id=1, not rendered in grain silo dashboards.

**Key correlations confirmed from live data:**
- NORIA→DISTRIBUIDORA throughput: 0.94
- SECADORA temperature↔humidity: −0.94
- VOLCABLE→REDLER load: 0.75

---

## Dashboards Created

### 1. Panel de Operaciones de Planta (`grain-silo-executive`)
- **Audience:** Management, operations leadership
- **Panels:** 24 data panels + row headers
- **Sections:** KPIs, equipment state, state timelines, cascade flow, mechanical health, dryer quality, silo levels
- **Key features:** Chain efficiency gauge, cascading throughput trend (4 series), dual-axis dryer panel, silo fill gauges, value mappings in Spanish (EN MARCHA / DETENIDO / SIN ALARMAS)

### 2. Monitoreo Técnico y Mantenimiento (`grain-silo-maintenance`)
- **Audience:** Maintenance operators, reliability engineers
- **Panels:** 16 data panels + row headers
- **Sections:** Maintenance KPIs, alarm timelines, motor currents, ISO 10816 vibration, bearing temps, event log, stop frequency
- **Key features:** LCD horizontal bar gauges with per-asset current thresholds, ISO 10816 zone shading (A/B/C/D), color-coded event table (PARADA / REINICIO / TIEMPO PARADO), 30-min stop frequency bar chart

**Both dashboards:** Spanish UI labels, English signal names and SQL, `timescaledb` datasource UID, auto-refresh 30 s.

---

## Event Detection Capabilities

Processor detects 3 event types, stored in `processed_events`:

| Event | Trigger | Count |
|---|---|---|
| `MACHINE_STOPPED` | `running` transitions 1→0 | 376 |
| `MACHINE_RESUMED` | `running` transitions 0→1 | 376 |
| `DOWNTIME_DETECTED` | Stop duration recorded on resume | 376 |

`DOWNTIME_DETECTED` includes `duration_seconds`, enabling MTTR calculation.

---

## Current Operational KPIs

Calculable from existing data:

| KPI | Formula | Notes |
|---|---|---|
| Availability | `AVG(running) * 100` | Per asset |
| MTTR | `AVG(duration_seconds)` on DOWNTIME_DETECTED | In seconds |
| Stop frequency | `COUNT(MACHINE_STOPPED)` per 30 min | Bar chart |
| Chain efficiency | `distribuidora_tph / volcable_tph * 100` | % throughput retained |
| Throughput | `throughput_tph` per asset | Real-time + trend |
| Silo level | `capacity_pct` | Real-time + trend |
| Dryer humidity | `secadora_01_humidity_pct` | Quality proxy |
| Motor load | `current_a` per asset | Health indicator |
| Vibration | `vibration_mm_s` per asset | ISO 10816 zones |

**Not yet calculable:** Full OEE (missing `speed_setpoint` for Performance, `reject_count` for Quality).

---

## Known Limitations

### Simulator vs Real PLC

| Gap | Impact |
|---|---|
| `speed_rpm` / `temperature_c` / `parts_count` are legacy generic signals | Not connected to grain silo assets; clutter signal table |
| Cycle timings are randomized per asset | Real PLCs have operator-driven or process-driven transitions |
| `alarm_active` is probabilistic | Real alarms triggered by threshold breaches |
| Silo levels are model-driven | No real sensor feedback loop |
| No `shift_active` signal | Cannot scope KPIs to planned production time |

### Missing OEE Signals

| Signal | Unlocks |
|---|---|
| `speed_setpoint` per asset | Performance ratio (actual/ideal speed) |
| `reject_count` | Quality rate (good parts / total) |
| `shift_active` | Planned vs unplanned downtime split |

### Infrastructure

- Single machine (`machine_id = 1`, `PLC-001`) — schema supports multiple but only one simulated
- No authentication on Grafana or TimescaleDB (MVP scope)
- No alerting configured (Grafana alert rules not provisioned)

---

## Next Recommended Steps

### Priority 1 — Simulator quality
- Remove legacy generic signals (`running`, `speed_rpm`, `temperature_c`, `alarm_active`, `parts_count`) from the simulator output; they pollute the signal table without mapping to any grain silo asset
- Make alarm signals threshold-driven (e.g., alarm fires when `temperature_c > 78` or `vibration_mm_s > 4.5`)
- Extend VOLCABLE stop durations to simulate realistic intake gaps (currently may be too short)

### Priority 2 — OEE completion
- Add `volcable_01_speed_setpoint` and `noria_01_speed_setpoint` signals to simulator
- Add `secadora_01_reject_count` (grain rejected by humidity sensor)
- Add `shift_active` boolean signal (e.g., 8-hour shift schedule)
- Build OEE panel in executive dashboard: `A × P × Q`

### Priority 3 — Second machine
- Add `PLC-002` (a second silo line) to simulator and collector
- Verify `machine_id` FK constraint and add machine_id=2 to `machines` table if needed
- Add cross-machine comparison panels to executive dashboard

### Priority 4 — Alerting
- Provision Grafana alert rules for: temperature > threshold, vibration zone C/D, silo overflow (>95%), silo empty (<5%)
- Configure notification channel (webhook or email)

### Priority 5 — Documentation
- Update `docs/architecture/grain-silo-operational-model.md` after removing legacy signals
- Add architecture diagram (ASCII or Mermaid) to `docs/`

---

## File Index (session artifacts)

```
apps/plc-simulator/src/index.ts                                  — grain silo simulator (7 assets, 31 grain signals)
infrastructure/grafana/provisioning/dashboards/grain-silo-executive.json   — executive dashboard
infrastructure/grafana/provisioning/dashboards/grain-silo-maintenance.json — maintenance dashboard
docs/architecture/grain-silo-operational-model.md                — signal inventory, KPIs, correlations
docs/architecture/current-operational-capabilities.md            — original generic PLC analysis
docs/session-summary-2026-05-12.md                              — this file
```
