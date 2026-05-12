CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- Reference table for machines / PLCs
CREATE TABLE IF NOT EXISTS machines (
  id          SERIAL PRIMARY KEY,
  name        TEXT         NOT NULL UNIQUE,
  description TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Raw telemetry from collector
CREATE TABLE IF NOT EXISTS telemetry_raw (
  time        TIMESTAMPTZ  NOT NULL,
  machine_id  INTEGER      NOT NULL REFERENCES machines(id),
  signal_name TEXT         NOT NULL,
  value       DOUBLE PRECISION NOT NULL,
  unit        TEXT,
  quality     SMALLINT     NOT NULL DEFAULT 192   -- OPC-UA Good quality
);

SELECT create_hypertable('telemetry_raw', 'time');

CREATE INDEX IF NOT EXISTS idx_telemetry_machine_signal
  ON telemetry_raw (machine_id, signal_name, time DESC);

-- Processed events from processor
CREATE TABLE IF NOT EXISTS processed_events (
  id               BIGSERIAL,
  time             TIMESTAMPTZ      NOT NULL,
  machine_id       INTEGER          NOT NULL REFERENCES machines(id),
  event_type       TEXT             NOT NULL,
  duration_seconds DOUBLE PRECISION,
  metadata         JSONB,
  created_at       TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

SELECT create_hypertable('processed_events', 'time');

-- Seed machines
INSERT INTO machines (name, description) VALUES
  ('PLC-001', 'Main production line PLC'),
  ('PLC-002', 'Secondary production line PLC')
ON CONFLICT (name) DO NOTHING;
