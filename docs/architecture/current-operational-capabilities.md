# Current Operational Capabilities

**Date:** 2026-05-13  
**Based on:** ~3.2 hours of live telemetry, machine PLC-001

---

## Dataset Snapshot

| Metric | Value |
|---|---|
| Observation window | 3.17 hours |
| Total telemetry rows | 51 790 |
| Signals per machine | 5 |
| Distinct machines active | 1 (PLC-001) |
| Events in `processed_events` | 1 002 (334 stop/resume cycles) |

---

## Signal Inventory

| Signal | Unit | Avg | Min | Max | Notes |
|---|---|---|---|---|---|
| `running` | bool | 0.90 | 0 | 1 | 90.2% uptime observed |
| `speed_rpm` | rpm | 849.9 | 700.0 | 1000.0 | independent of running state* |
| `temperature_c` | celsius | 69.9 | 60.0 | 80.0 | independent of running state* |
| `parts_count` | count | 1.98 | 0 | 4 | per 1-second cycle |
| `alarm_active` | bool | 0.05 | 0 | 1 | ~5% alarm rate |

*Correlation between `running` and `speed_rpm`: 0.003 — signals are statistically independent in the simulator. A real PLC would show speed dropping to 0 when stopped. This is the most significant gap between simulation and production.

---

## KPIs Calculable Right Now

### Availability
```sql
SELECT
  ROUND(AVG(value) * 100, 1) AS availability_pct
FROM telemetry_raw
WHERE machine_id = 1
  AND signal_name = 'running'
  AND $__timeFilter(time);
```
**Observed: 90.2%** — directly from `running` signal proportion.

---

### Stop Frequency (stops per hour)
```sql
SELECT
  COUNT(*) / (EXTRACT(EPOCH FROM (MAX(time) - MIN(time))) / 3600) AS stops_per_hour
FROM processed_events
WHERE machine_id = 1
  AND event_type = 'MACHINE_STOPPED'
  AND $__timeFilter(time);
```
**Observed: 106 stops/hour** — high because the simulator generates independent random stops rather than sustained state transitions.

---

### Mean Time To Recover (MTTR)
```sql
SELECT ROUND(AVG(duration_seconds)::numeric, 2) AS mttr_seconds
FROM processed_events
WHERE machine_id = 1
  AND event_type = 'DOWNTIME_DETECTED'
  AND $__timeFilter(time);
```
**Observed: 1.32 seconds** — reflects simulator's 10% stop probability per cycle, not sustained outages.

---

### Mean Time Between Failures (MTBF)
```sql
SELECT
  EXTRACT(EPOCH FROM (MAX(time) - MIN(time))) / COUNT(*) AS mtbf_seconds
FROM processed_events
WHERE machine_id = 1
  AND event_type = 'MACHINE_STOPPED'
  AND $__timeFilter(time);
```
**Observed: 11.96 seconds** — directly derivable from event timestamps.

---

### Total Downtime
```sql
SELECT
  ROUND(SUM(duration_seconds)::numeric / 60, 2) AS total_downtime_minutes
FROM processed_events
WHERE machine_id = 1
  AND event_type = 'DOWNTIME_DETECTED'
  AND $__timeFilter(time);
```
**Observed: 7.36 minutes** across 3.17 hours.

---

### Downtime Distribution
```sql
SELECT
  width_bucket(duration_seconds, 0, 10, 5) AS bucket,
  COUNT(*) AS events
FROM processed_events
WHERE event_type = 'DOWNTIME_DETECTED'
  AND $__timeFilter(time)
GROUP BY bucket ORDER BY bucket;
```
**Observed distribution:** 83% of stops last 1–2 s, 12% last 2–3 s, 4% last 4–6 s, <1% exceed 7 s.

---

### Production Counter (parts in window)
```sql
SELECT COALESCE(SUM(value), 0) AS total_parts
FROM telemetry_raw
WHERE machine_id = 1
  AND signal_name = 'parts_count'
  AND $__timeFilter(time);
```
**Observed: 20 428 parts** across 3.17 hours. Cycle rate: ~1.98 parts/second average.

---

### Alarm Rate
```sql
SELECT ROUND(AVG(value) * 100, 1) AS alarm_rate_pct
FROM telemetry_raw
WHERE machine_id = 1
  AND signal_name = 'alarm_active'
  AND $__timeFilter(time);
```
**Observed: 4.9%** — independent of machine state in the simulator.

---

## Dashboards Buildable from Current Data

### 1. Machine Status Overview
**Purpose:** Real-time operational state at a glance.

| Panel | Type | Source |
|---|---|---|
| Current running state | Stat (green/red) | `running` latest value |
| Availability % | Gauge | `AVG(running)` over window |
| Current speed | Stat | `speed_rpm` latest value |
| Current temperature | Stat with thresholds | `temperature_c` latest value |
| Active alarm | Stat (red flash) | `alarm_active` latest value |

---

### 2. Downtime Analysis
**Purpose:** Understand stop patterns and recovery times.

| Panel | Type | Source |
|---|---|---|
| Stop events timeline | Event annotations | `processed_events` MACHINE_STOPPED |
| Downtime duration histogram | Bar chart | `DOWNTIME_DETECTED.duration_seconds` |
| MTTR over time | Time series | Rolling `AVG(duration_seconds)` |
| MTBF over time | Time series | Rolling time between MACHINE_STOPPED events |
| Total downtime per hour | Bar chart | `SUM(duration_seconds)` grouped by hour |
| Stops per hour trend | Time series | `COUNT(MACHINE_STOPPED)` grouped by hour |

---

### 3. Production Counter
**Purpose:** Track output volume and throughput trends.

| Panel | Type | Source |
|---|---|---|
| Parts produced (window) | Stat | `SUM(parts_count)` |
| Parts per minute trend | Time series | `SUM(parts_count)` grouped by minute |
| Productive cycles % | Gauge | `AVG(parts_count > 0)` |
| Cumulative production | Time series | Running `SUM(parts_count)` |

---

### 4. Signal Health
**Purpose:** Detect anomalies in analog signals.

| Panel | Type | Source |
|---|---|---|
| Speed RPM over time | Time series | `speed_rpm` |
| Temperature over time | Time series | `temperature_c` |
| Alarm frequency | Time series | `SUM(alarm_active)` per minute |
| Signal quality | Stat | `AVG(quality)` — all signals should be 192 |

---

## Simulator Gaps vs Real PLC Behaviour

These are analysis gaps, not implementation bugs. They affect which KPIs are meaningful today.

| Gap | Impact | Simulator | Real PLC |
|---|---|---|---|
| **Speed during stop** | MTTR and performance KPIs are misleading | `speed_rpm` random even when `running=0` | Speed drops to 0 on stop |
| **Temperature during stop** | Thermal analysis not possible | `temperature_c` random even when `running=0` | Temperature decays on stop |
| **Parts during stop** | Production efficiency overstated | `parts_count` non-zero even when `running=0` | Parts produced only when running |
| **Stop duration** | Stops are too short and too frequent | 10% random per cycle → avg 1.32 s downtime | Sustained stops lasting minutes |
| **Alarm correlation** | Alarm root cause analysis not possible | `alarm_active` independent of all signals | Alarms triggered by threshold breaches |
| **Cumulative counters** | No production shift context | Absolute random per cycle | Resets at shift start, monotonic between resets |

---

## Additional Signals That Would Improve the Demo

Signals that would unlock meaningful industrial KPIs without architectural changes (add to `plc-simulator`, persist via existing `collector`):

| Signal | Unit | Why It Matters |
|---|---|---|
| `speed_setpoint` | rpm | Enables performance ratio: `speed_actual / speed_setpoint` |
| `reject_count` | count | Enables quality rate: `(parts - rejects) / parts` — third OEE component |
| `shift_active` | bool | Scopes all KPIs to planned production time (planned vs unplanned downtime) |
| `motor_current_a` | amperes | Early fault detection; correlates with load and mechanical wear |
| `cycle_time_ms` | ms | Actual cycle time vs ideal cycle time for performance KPI |
| `vibration_mm_s` | mm/s | Predictive maintenance signal |

With `speed_setpoint`, `reject_count`, and `shift_active` alone, full OEE (Availability × Performance × Quality) becomes calculable from existing infrastructure.

---

## OEE Readiness Assessment

| OEE Component | Formula | Status |
|---|---|---|
| **Availability** | `uptime / planned_time` | Calculable — `running` signal exists |
| **Performance** | `actual_speed / ideal_speed` | Not calculable — no `speed_setpoint` signal |
| **Quality** | `good_parts / total_parts` | Not calculable — no `reject_count` signal |
| **OEE** | `A × P × Q` | Partial — Availability only |

Overall OEE cannot be computed yet. Adding two signals (`speed_setpoint`, `reject_count`) closes the gap.
