# Agents

## plc-simulator

Responsibility:

* Simulate industrial PLC signals
* Generate realistic telemetry
* Simulate ON/OFF transitions
* Simulate alarms and counters

Must NOT:

* Process business logic
* Detect events
* Persist historical data

---

## collector

Responsibility:

* Poll PLC data
* Normalize signals
* Add timestamps
* Persist telemetry into TimescaleDB

Must NOT:

* Calculate productivity
* Detect downtime events
* Send data externally

---

## processor

Responsibility:

* Detect state transitions
* Calculate downtime
* Generate processed industrial events
* Produce KPIs

Must NOT:

* Read directly from PLC
* Handle HTTP APIs

---

## api

Responsibility:

* Expose internal APIs
* Future Consuman integration
* Retry logic
* Queue handling

Must NOT:

* Process industrial logic
