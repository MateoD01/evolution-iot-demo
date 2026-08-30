# Collector Pinedo

Collector Modbus TCP para la planta de silos Pinedo. Lee registros del PLC Schneider M340 y persiste las lecturas en PostgreSQL en la tabla `telemetry_raw`.

## Objetivo

- Conectarse al PLC por Modbus TCP
- Leer solo tags no `readOnly`
- Agrupar tags contiguos en bloques para optimizar lecturas FC03
- Decodificar registros de 16 y 32 bits con orden `swapped`
- Guardar las lecturas como telemetry cruda para que el processor las procese sin cambios

## Estructura

```text
src/
├── config/
│   ├── database.ts
│   └── env.ts
├── infrastructure/
│   └── plc/
│       └── modbusClient.ts
├── repositories/
│   ├── machineRepository.ts
│   └── telemetryRepository.ts
├── services/
│   ├── collectorService.ts
│   └── tagPollingService.ts
├── types/
│   └── collector.ts
├── index.ts
├── tags.pinedo.json
└──
```

## Variables de entorno

```bash
PLC_HOST=plc-simulator-pinedo
PLC_PORT=502
PLC_UNIT_ID=255
POLL_MS=1000
MACHINE_NAME=PLC-PINEDO

POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=iot_demo
POSTGRES_USER=iot_user
POSTGRES_PASSWORD=iot_password
```

## Comandos

```bash
npm install
npm run build
npm run dev
```

## Producción

Para producción, se suele apuntar a la IP real del PLC:

```bash
PLC_HOST=172.16.16.180
PLC_PORT=502
```

## Observación importante

El collector solo lee tags no editables por SCADA (`readOnly === false`), y no escribe comandos ni registros de control. Esto mantiene la operación segura y compatible con el processor central.
