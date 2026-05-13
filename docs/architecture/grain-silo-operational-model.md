# Grain Silo Operational Model

**Date:** 2026-05-13  
**Based on:** Live telemetry from TimescaleDB — 10+ minutes of continuous collection  
**Machine:** PLC-001 (31 signals, 7 assets)

---

## Plant Overview

The simulator models a grain silo receiving, drying, and storage plant. Grain flows linearly from intake to dry storage; silos act as buffers between the conveyor chain and the dryer.

```
[TRUCK/INTAKE]
      │
  VOLCABLE-01          ← intake unloader (independent cycles)
      │
  REDLER-01            ← chain conveyor (long continuous runs)
      │
  NORIA-01             ← bucket elevator (CRITICAL PATH)
      │
  DISTRIBUIDORA-01     ← grain distributor (follows NORIA)
      │
  SILO-HUMEDO-01       ← wet grain buffer
      │
  SECADORA-01          ← rotary dryer (own cycles)
      │
  SILO-SECO-01         ← dry grain storage (continuous dispatch drain)
```

---

## Asset Inventory

### VOLCABLE-01 — Grain Unloader

Receives grain from trucks. Runs in short independent cycles that model truck arrival patterns.

| Signal | Unit | Observed Range | Avg | Notes |
|---|---|---|---|---|
| `volcable_01_running` | bool | 0 / 1 | — | Independent cycle: 20–55 min run, 5–30 min stop |
| `volcable_01_alarm_active` | bool | 0 / 1 | 6.5% | Fault alarm only; ~6% observed alarm rate |
| `volcable_01_throughput_tph` | tph | 84–120 | 98.6 | Proportional to load; 0 when stopped |
| `volcable_01_current_a` | amperes | 0–80 | 46.8 | Proportional to load with noise |

**Alarm threshold:** fault alarm only (random, 10–60 s duration).  
**Stop behaviour:** throughput and current drop to 0 immediately on stop.

---

### REDLER-01 — Chain Conveyor

Transports grain from intake pit to elevator. Runs very long continuous shifts; stops only for scheduled maintenance.

| Signal | Unit | Observed Range | Avg | Notes |
|---|---|---|---|---|
| `redler_01_running` | bool | 0 / 1 | — | Long cycle: 3–7 hr run, 30–90 min stop |
| `redler_01_alarm_active` | bool | 0 / 1 | — | Fault alarm OR temp > 65°C OR vibration > 5 mm/s |
| `redler_01_throughput_tph` | tph | 0–115 | 91.7 | Tracks VOLCABLE output (corr = 0.75) |
| `redler_01_current_a` | amperes | 0–100 | 62.1 | Proportional to throughput |
| `redler_01_temperature_c` | celsius | 18–70 | 47.4 | Gearbox/bearing temp; rises with load |
| `redler_01_vibration_mm_s` | mm/s | 0–6 | 3.1 | Chain wear indicator; rises with load |

**Alarm thresholds:** temperature > 65°C (bearing overheat), vibration > 5.0 mm/s (chain misalignment).  
**ISO 10816 reference:** < 2.3 mm/s = good, 2.3–4.5 = acceptable, > 4.5 = alarm.

---

### NORIA-01 — Bucket Elevator (Critical Path)

Lifts grain vertically. The single most critical asset: a NORIA stop immediately halts DISTRIBUIDORA-01 and interrupts silo filling.

| Signal | Unit | Observed Range | Avg | Notes |
|---|---|---|---|---|
| `noria_01_running` | bool | 0 / 1 | — | Mid-length cycle: 1–2.5 hr run, 10–40 min stop |
| `noria_01_alarm_active` | bool | 0 / 1 | — | Fault alarm OR temp > 78°C OR vibration > 6.5 mm/s |
| `noria_01_throughput_tph` | tph | 0–110 | 84.2 | Tracks REDLER output (corr = 0.90) |
| `noria_01_current_a` | amperes | 0–135 | 78.1 | Strong correlation with throughput (corr = 0.76) |
| `noria_01_temperature_c` | celsius | 24–88 | 61.4 | Head bearing temp; rises with load |
| `noria_01_vibration_mm_s` | mm/s | 0–9 | 4.0 | Bucket wear / belt tension indicator |

**Alarm thresholds:** temperature > 78°C, vibration > 6.5 mm/s.  
**Fault probability:** 2× the other mechanical assets — models higher wear rate of bucket elevator heads.

---

### DISTRIBUIDORA-01 — Grain Distributor

Mechanically coupled to NORIA-01 — shares the same shaft drive. Has no independent cycle.

| Signal | Unit | Observed Range | Avg | Notes |
|---|---|---|---|---|
| `distribuidora_01_running` | bool | 0 / 1 | — | Mirrors `noria_01_running` exactly |
| `distribuidora_01_alarm_active` | bool | 0 / 1 | — | Fault alarm only (independent of NORIA alarm) |
| `distribuidora_01_throughput_tph` | tph | 0–108 | 81.9 | noria.load × 0.99 (corr = 0.94) |
| `distribuidora_01_current_a` | amperes | 0–40 | 20.5 | Proportional to throughput |

**Dependency rule:** `distribuidora_01_running` = `noria_01_running`. Any NORIA stop is a DISTRIBUIDORA stop.

---

### SECADORA-01 — Rotary Dryer

Removes moisture from wet grain. Operates on long independent cycles; chamber temperature is the primary process quality signal.

| Signal | Unit | Observed Range | Avg | Notes |
|---|---|---|---|---|
| `secadora_01_running` | bool | 0 / 1 | — | Long cycle: 2–5 hr run, 30–90 min stop |
| `secadora_01_alarm_active` | bool | 0 / 1 | — | Fault alarm OR temp > 102°C OR humidity > 18% |
| `secadora_01_temperature_c` | celsius | 28–108 | 95.6 | Chamber temp; target 90–98°C |
| `secadora_01_humidity_pct` | percent | 9–22 | 13.0 | Output grain moisture; target 12–14% |
| `secadora_01_current_a` | amperes | 0–165 | 96.2 | Proportional to load |

**Key correlation:** `temperature_c` and `humidity_pct` are strongly inversely correlated (corr = −0.94). Higher chamber temperature → better moisture extraction → lower output humidity.  
**Quality gate:** output humidity > 14% means grain is insufficiently dried and should not enter SILO-SECO.  
**Alarm thresholds:** temperature > 102°C (fire risk), humidity > 18% (insufficient drying).

---

### SILO-HUMEDO-01 — Wet Grain Buffer

Accumulates grain from DISTRIBUIDORA; feeds SECADORA. Acts as a decoupling buffer between the conveyor chain and the dryer.

| Signal | Unit | Observed Range | Avg | Notes |
|---|---|---|---|---|
| `silo_humedo_01_capacity_pct` | percent | 0–100 | 45.5 | Level fills at ~0.6%/min at full throughput |
| `silo_humedo_01_alarm_active` | bool | 0 / 1 | — | Level < 8% (starving dryer) OR > 92% (overflow risk) |
| `silo_humedo_01_fan_running` | bool | 0 / 1 | — | Auto-starts above 20% capacity (prevents moisture buildup) |

**Fill/drain model:**
- Fill rate: `distribuidora.load × 0.010` %/tick
- Drain rate: `secadora.load × 0.008` %/tick
- Observed net rate: +0.099 %/min (DISTRIBUIDORA running faster than SECADORA draining)

**Alarm logic:** below 8% → dryer starvation; above 92% → overflow / grain compaction risk.

---

### SILO-SECO-01 — Dry Grain Storage

Receives dried grain from SECADORA. Drains continuously from dispatch/shipments.

| Signal | Unit | Observed Range | Avg | Notes |
|---|---|---|---|---|
| `silo_seco_01_capacity_pct` | percent | 0–100 | 38.7 | Net fill at +0.150 %/min currently |
| `silo_seco_01_alarm_active` | bool | 0 / 1 | — | Level > 94% (overflow risk) |
| `silo_seco_01_fan_running` | bool | 0 / 1 | — | Auto-starts above 15% (grain quality maintenance) |

**Fill/drain model:**
- Fill rate: `secadora.load × 0.008` %/tick
- Drain rate: 0.003 %/tick constant (shipment dispatch)
- Observed net rate: +0.150 %/min

**Alarm logic:** above 94% capacity → overflow alarm (no drain-side alarm; silo can theoretically empty).

---

## Signal Correlations (Observed)

| Signal Pair | Correlation | Interpretation |
|---|---|---|
| `volcable_01_throughput_tph` ↔ `redler_01_throughput_tph` | +0.75 | Intake-to-conveyor lag visible in signal |
| `redler_01_throughput_tph` ↔ `noria_01_throughput_tph` | +0.90 | Tight mechanical coupling |
| `noria_01_throughput_tph` ↔ `distribuidora_01_throughput_tph` | +0.94 | Nearly rigid coupling (same drive) |
| `noria_01_throughput_tph` ↔ `noria_01_current_a` | +0.76 | Load drives motor current |
| `secadora_01_temperature_c` ↔ `secadora_01_humidity_pct` | −0.94 | Process quality signal: hotter = drier grain |
| `secadora_01_current_a` ↔ `secadora_01_humidity_pct` | +0.57 | Higher load = more grain = higher residual humidity |

---

## Operational Dependencies

```
VOLCABLE stop  →  REDLER throughput falls (lag ~8 ticks)
REDLER stop    →  NORIA throughput falls (lag ~10 ticks)
NORIA stop     →  DISTRIBUIDORA STOPS immediately (same drive)
               →  SILO-HUMEDO stops filling
               →  SILO-SECO stops filling (via SECADORA drain)
SECADORA stop  →  SILO-HUMEDO starts accumulating (drain removed)
               →  SILO-SECO stops filling
               →  Risk of SILO-HUMEDO overflow if DISTRIBUIDORA keeps running
```

**Critical dependency:** NORIA-01 is the single point of failure for the entire plant flow. Any NORIA stop halts all downstream assets and interrupts both silo fill paths.

---

## KPI Catalogue

### Executive KPIs (Management Dashboard)

| KPI | Formula | Unit | Source Signals |
|---|---|---|---|
| **Plant Availability** | `AVG(noria_01_running)` over shift | % | `noria_01_running` |
| **Intake Throughput** | `AVG(volcable_01_throughput_tph)` | tph | `volcable_01_throughput_tph` |
| **Drying Quality** | `AVG(secadora_01_humidity_pct)` | % moisture | `secadora_01_humidity_pct` |
| **Dry Storage Level** | `LAST(silo_seco_01_capacity_pct)` | % | `silo_seco_01_capacity_pct` |
| **Active Alarms** | `SUM(all alarm_active signals)` | count | all `*_alarm_active` |
| **Dryer Utilization** | `AVG(secadora_01_running)` | % | `secadora_01_running` |

---

### Operational KPIs (Maintenance / Plant Operators)

| KPI | Formula | Unit | Source |
|---|---|---|---|
| **NORIA Availability** | `AVG(noria_01_running)` | % | `noria_01_running` |
| **NORIA Bearing Temp** | `LAST(noria_01_temperature_c)` | °C | `noria_01_temperature_c` |
| **NORIA Vibration** | `LAST(noria_01_vibration_mm_s)` | mm/s | `noria_01_vibration_mm_s` |
| **REDLER Vibration** | `LAST(redler_01_vibration_mm_s)` | mm/s | `redler_01_vibration_mm_s` |
| **Wet Silo Level** | `LAST(silo_humedo_01_capacity_pct)` | % | `silo_humedo_01_capacity_pct` |
| **Throughput Efficiency** | `distribuidora_tph / volcable_tph` | ratio | throughput signals |
| **Dryer Chamber Temp** | `LAST(secadora_01_temperature_c)` | °C | `secadora_01_temperature_c` |
| **Chain Conveyor Load** | `LAST(redler_01_current_a)` | A | `redler_01_current_a` |
| **Stops per Hour (NORIA)** | `COUNT(MACHINE_STOPPED) / hours` | stops/hr | `processed_events` |
| **MTTR (NORIA)** | `AVG(duration_seconds)` | s | `processed_events` |

---

## Grafana Visualization Recommendations

### Gauges (current value with threshold bands)

| Signal | Recommended Thresholds |
|---|---|
| `noria_01_temperature_c` | Green < 68°C / Yellow 68–78°C / Red > 78°C |
| `noria_01_vibration_mm_s` | Green < 2.3 / Yellow 2.3–6.5 / Red > 6.5 |
| `redler_01_temperature_c` | Green < 55°C / Yellow 55–65°C / Red > 65°C |
| `secadora_01_temperature_c` | Green 90–98°C / Yellow 85–90°C or 98–102°C / Red outside |
| `secadora_01_humidity_pct` | Green 12–14% / Yellow 14–16% / Red > 16% or > 18% |
| `silo_humedo_01_capacity_pct` | Red < 8% / Yellow 8–20% / Green 20–80% / Yellow 80–92% / Red > 92% |
| `silo_seco_01_capacity_pct` | Green < 80% / Yellow 80–94% / Red > 94% |

---

### Time Series (trends over window)

| Panel | Signals | Purpose |
|---|---|---|
| Throughput cascade | `volcable/redler/noria/distribuidora _throughput_tph` | Visualize flow propagation and lag |
| Motor currents | `noria/redler/secadora _current_a` | Load trending and anomaly detection |
| Vibration trend | `noria_01_vibration_mm_s`, `redler_01_vibration_mm_s` | Predictive maintenance baseline |
| Bearing temperatures | `noria/redler _temperature_c` | Thermal trending |
| Dryer process | `secadora_01_temperature_c`, `secadora_01_humidity_pct` | Quality control (dual Y-axis) |
| Silo levels | `silo_humedo_01_capacity_pct`, `silo_seco_01_capacity_pct` | Buffer management |

---

### State Timelines

| Asset | Signal | Purpose |
|---|---|---|
| VOLCABLE-01 | `volcable_01_running` | Truck arrival pattern |
| REDLER-01 | `redler_01_running` | Conveyor uptime |
| NORIA-01 | `noria_01_running` | Critical path availability |
| SECADORA-01 | `secadora_01_running` | Dryer cycle tracking |
| All fans | `silo_humedo_01_fan_running`, `silo_seco_01_fan_running` | Ventilation state |
| Alarms | all `*_alarm_active` | Multi-row alarm timeline |

State timelines from `processed_events` (MACHINE_STOPPED / MACHINE_RESUMED) add duration annotations automatically.

---

### Plant Flow Diagram

A Grafana canvas panel or HTML panel can render the plant diagram with live-coloured nodes:

| Node | Colour logic | Source signals |
|---|---|---|
| VOLCABLE-01 | Green / Grey based on running; Red if alarm | `running`, `alarm_active`, `throughput_tph` |
| REDLER-01 | Same + amber if vibration > 4.5 | same + `vibration_mm_s` |
| NORIA-01 | Same — **bold border** as critical path indicator | same |
| DISTRIBUIDORA-01 | Mirrors NORIA state | `running` |
| SILO-HUMEDO-01 | Fill level bar; Red edges at < 8% or > 92% | `capacity_pct` |
| SECADORA-01 | Green / Yellow by humidity band | `running`, `humidity_pct` |
| SILO-SECO-01 | Fill level bar; Red edge at > 94% | `capacity_pct` |
| Flow arrows | Thickness proportional to throughput | `*_throughput_tph` |

---

## Recommended Dashboard Layout

### Dashboard 1 — Plant Overview (Executive)
Panels: plant availability stat · intake throughput gauge · dryer quality gauge · wet silo level gauge · dry silo level gauge · active alarm count · 24h throughput sparklines

### Dashboard 2 — Conveyor Chain (Operations)
Panels: running state timeline (4 assets) · throughput cascade time series · current_a overlay · NORIA bearing temp gauge · NORIA vibration gauge · REDLER vibration gauge · NORIA stops per hour

### Dashboard 3 — Drying Process (Quality)
Panels: secadora running timeline · chamber temperature gauge · output humidity gauge · temperature vs humidity dual-axis time series · current_a trend · alarm timeline

### Dashboard 4 — Silo Levels (Logistics)
Panels: wet silo level gauge + trend · dry silo level gauge + trend · fan status stats · projected time-to-full/time-to-empty (derived from fill rate) · combined level time series

### Dashboard 5 — Predictive Maintenance
Panels: NORIA vibration trend + alarm threshold band · REDLER vibration trend · bearing temperature trends (both assets) · fault alarm event table from processed_events · alarm frequency time series per asset

---

## Simulator Gaps vs Real Plant

| Gap | Impact | Simulator | Real Plant |
|---|---|---|---|
| **Throughput lag** | Cascade correlation slightly idealised | Lerp alpha ~0.08–0.10 | True transport delay (belt length / speed) |
| **Silo level units** | Level is relative %, not absolute tonnes | % capacity, no geometry | Tonnes, cone angle, bulk density |
| **Dryer humidity** | Inversely correlated with temp, not with grain type or feed rate | Simplified | Feed rate × grain moisture × residence time |
| **DISTRIBUIDORA independence** | Cannot stop without NORIA | Coupled 100% | Can be diverted to bypass |
| **Electricity cost** | Current signals not converted to kWh | Raw amperes | kWh from current + voltage + power factor |
| **Shift boundaries** | No shift reset | Continuous | Parts/throughput reset at shift start |

---

## Data Volume Reference

| Metric | Value |
|---|---|
| Collection start | 2026-05-13 02:57 UTC |
| Signal count | 31 |
| Rows per signal per minute | ~60 (1 Hz collector) |
| TimescaleDB hypertable | `telemetry_raw` |
| Event table | `processed_events` |
| Machine ID | PLC-001 (machine_id = 1) |
