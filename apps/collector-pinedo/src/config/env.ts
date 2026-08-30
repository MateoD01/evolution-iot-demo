const readInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const env = {
  PLC_HOST: process.env.PLC_HOST ?? 'plc-simulator-pinedo',
  PLC_PORT: readInt(process.env.PLC_PORT, 502),
  UNIT_ID: readInt(process.env.PLC_UNIT_ID, 255),
  POLL_MS: readInt(process.env.POLL_MS, 1000),
  MACHINE_NAME: process.env.MACHINE_NAME ?? 'PLC-PINEDO',
  POSTGRES_HOST: process.env.POSTGRES_HOST ?? 'localhost',
  POSTGRES_PORT: readInt(process.env.POSTGRES_PORT, 5432),
  POSTGRES_DB: process.env.POSTGRES_DB ?? 'iot_demo',
  POSTGRES_USER: process.env.POSTGRES_USER ?? 'iot_user',
  POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD ?? 'iot_password',
};
