# Guía Operacional de Dashboards — Planta de Silos de Grano

**Sistema:** Evolution IoT Demo — Plataforma de telemetría industrial  
**Planta modelada:** Silo de recepción, secado y almacenamiento de grano  
**Actualizado:** 2026-05-14

---
## Índice

1. [Introducción al sistema](#1-introducción-al-sistema)
2. [Activos industriales de la planta](#2-activos-industriales-de-la-planta)
3. [Dashboard: Panel de Operaciones de Planta](#3-dashboard-panel-de-operaciones-de-planta)
4. [Dashboard: Monitoreo Técnico y Mantenimiento](#4-dashboard-monitoreo-técnico-y-mantenimiento)
5. [Interpretación de alarmas](#5-interpretación-de-alarmas)
6. [Interpretación de paradas y tiempos muertos](#6-interpretación-de-paradas-y-tiempos-muertos)
7. [Cascada de caudal: cómo leer el flujo de la planta](#7-cascada-de-caudal-cómo-leer-el-flujo-de-la-planta)
8. [Umbrales de vibración y temperatura](#8-umbrales-de-vibración-y-temperatura)
9. [Monitoreo de silos](#9-monitoreo-de-silos)
10. [Referencia rápida por rol](#10-referencia-rápida-por-rol)

---

## 1. Introducción al sistema

La plataforma captura señales de los equipos de planta en tiempo real (frecuencia: 1 lectura por segundo), las almacena en una base de datos de series temporales y las visualiza en dos dashboards de Grafana. Ambos dashboards se actualizan automáticamente cada 30 segundos.

### Flujo de datos

```
Equipos PLC
    │  señales digitales y analógicas
    ▼
Colector (1 Hz)
    │  INSERT en base de datos
    ▼
TimescaleDB — telemetry_raw
    │
    ├─▶ Procesador de eventos → processed_events
    │      (detección de paradas, reanudaciones, tiempos muertos)
    │
    └─▶ Grafana
           ├─ Panel de Operaciones de Planta   (gerencia / operaciones)
           └─ Monitoreo Técnico y Mantenimiento (mantenimiento / confiabilidad)
```

### Cómo acceder

| Recurso | URL |
|---|---|
| Grafana | `http://localhost:3000` |
| Usuario | `admin` |
| Contraseña | `admin` |

---

## 2. Activos industriales de la planta

La planta sigue un flujo lineal desde la recepción de camiones hasta el almacenamiento de grano seco. Comprender este flujo es esencial para interpretar correctamente los dashboards.

### Diagrama de flujo de la planta

```
[CAMIONES / RECEPCIÓN]
         │
     VOLCABLE-01          ←  Receptor de grano (ciclos independientes)
         │
     REDLER-01            ←  Transportador de cadena (turnos continuos largos)
         │
     NORIA-01             ←  Elevador de cangilones  ★ RUTA CRÍTICA ★
         │
     DISTRIBUIDORA-01     ←  Distribuidor (acoplado mecánicamente a NORIA)
         │
     SILO-HUMEDO-01       ←  Silo de grano húmedo (buffer)
         │
     SECADORA-01          ←  Secadora rotativa (ciclos independientes)
         │
     SILO-SECO-01         ←  Almacenamiento de grano seco (despacho continuo)
```

### Descripción de cada activo

#### VOLCABLE-01 — Receptor de camiones

Recibe el grano de los camiones y lo vuelca al foso de recepción. Opera en ciclos cortos e independientes que modelan el patrón de llegada de camiones.

| Señal | Unidad | Rango normal | Significado |
|---|---|---|---|
| `volcable_01_running` | bool | 0 / 1 | 1 = en marcha, 0 = detenido |
| `volcable_01_throughput_tph` | t/h | 84 – 120 | Caudal de grano que está descargando |
| `volcable_01_current_a` | A | 20 – 80 | Corriente del motor; proporcional a la carga |
| `volcable_01_alarm_active` | bool | 0 / 1 | Alarma de falla activa |

**Ciclo típico:** 20 – 55 min en marcha, 5 – 30 min parado (espera de camión).  
**Efecto en cascada:** cuando VOLCABLE se detiene, el caudal del REDLER comienza a decrecer en los siguientes ticks (lag ~8 segundos).

---

#### REDLER-01 — Transportador de cadena

Transporta el grano desde el foso de recepción hasta la base del elevador. Opera en turnos largos y continuos; se detiene sólo para mantenimiento programado.

| Señal | Unidad | Rango normal | Significado |
|---|---|---|---|
| `redler_01_running` | bool | 0 / 1 | Estado de marcha |
| `redler_01_throughput_tph` | t/h | 0 – 115 | Caudal; sigue al VOLCABLE con correlación 0.75 |
| `redler_01_current_a` | A | 0 – 100 | Corriente del motor |
| `redler_01_temperature_c` | °C | 18 – 65 | Temperatura del reductor / cojinete |
| `redler_01_vibration_mm_s` | mm/s | 0 – 5 | Vibración de la cadena; indicador de desgaste |
| `redler_01_alarm_active` | bool | 0 / 1 | Alarma activa |

**Ciclo típico:** 3 – 7 h en marcha, 30 – 90 min parado.  
**Umbrales de alarma:** temperatura > 65 °C (sobrecalentamiento de cojinete), vibración > 5.0 mm/s (desalineación de cadena).

---

#### NORIA-01 — Elevador de cangilones ★ ACTIVO CRÍTICO ★

Eleva el grano verticalmente. Es el activo más crítico de la planta: **una parada de NORIA detiene inmediatamente la DISTRIBUIDORA y corta el llenado de ambos silos.**

| Señal | Unidad | Rango normal | Significado |
|---|---|---|---|
| `noria_01_running` | bool | 0 / 1 | Estado de marcha |
| `noria_01_throughput_tph` | t/h | 0 – 110 | Caudal; sigue al REDLER con correlación 0.90 |
| `noria_01_current_a` | A | 0 – 135 | Corriente del motor; alta correlación con carga |
| `noria_01_temperature_c` | °C | 24 – 78 | Temperatura del cojinete de cabeza |
| `noria_01_vibration_mm_s` | mm/s | 0 – 6.5 | Desgaste de cangilones / tensión de correa |
| `noria_01_alarm_active` | bool | 0 / 1 | Alarma activa |

**Ciclo típico:** 1 – 2.5 h en marcha, 10 – 40 min parado.  
**Umbrales de alarma:** temperatura > 78 °C, vibración > 6.5 mm/s.  
**Punto único de falla:** cualquier parada de NORIA provoca parada simultánea de DISTRIBUIDORA y cese del llenado de SILO-HUMEDO.

---

#### DISTRIBUIDORA-01 — Distribuidor de grano

Acoplada mecánicamente a NORIA-01 (comparten el mismo eje de accionamiento). No tiene ciclo independiente: su estado de marcha es idéntico al de NORIA en todo momento.

| Señal | Unidad | Rango normal | Significado |
|---|---|---|---|
| `distribuidora_01_running` | bool | 0 / 1 | Siempre igual a `noria_01_running` |
| `distribuidora_01_throughput_tph` | t/h | 0 – 108 | 99% del caudal de NORIA (correlación 0.94) |
| `distribuidora_01_current_a` | A | 0 – 40 | Corriente del motor; proporcional al caudal |
| `distribuidora_01_alarm_active` | bool | 0 / 1 | Alarma de falla propia (independiente de NORIA) |

**Regla operacional:** si DISTRIBUIDORA aparece parada y NORIA en marcha (o viceversa), hay un problema de comunicación o sensor — verificar en campo.

---

#### SECADORA-01 — Secadora rotativa

Extrae la humedad del grano húmedo. Opera en ciclos largos e independientes. La temperatura de cámara es la señal de calidad del proceso de secado.

| Señal | Unidad | Rango normal | Significado |
|---|---|---|---|
| `secadora_01_running` | bool | 0 / 1 | Estado de marcha |
| `secadora_01_temperature_c` | °C | 90 – 98 | Temperatura de cámara; objetivo 90–98 °C |
| `secadora_01_humidity_pct` | % | 12 – 14 | Humedad del grano de salida; objetivo ≤ 14% |
| `secadora_01_current_a` | A | 0 – 165 | Corriente del motor |
| `secadora_01_alarm_active` | bool | 0 / 1 | Alarma activa |

**Ciclo típico:** 2 – 5 h en marcha, 30 – 90 min parado.  
**Correlación clave:** temperatura y humedad tienen correlación inversa de −0.94. A mayor temperatura de cámara → mejor extracción de humedad → menor humedad de salida.  
**Umbrales de alarma:** temperatura > 102 °C (riesgo de incendio), humedad > 18% (grano insuficientemente seco).

---

#### SILO-HUMEDO-01 — Silo de grano húmedo (buffer)

Acumula el grano proveniente de la DISTRIBUIDORA y alimenta a la SECADORA. Actúa como buffer de desacoplamiento entre la cadena transportadora y el proceso de secado.

| Señal | Unidad | Rango normal | Significado |
|---|---|---|---|
| `silo_humedo_01_capacity_pct` | % | 8 – 92 | Nivel de llenado del silo |
| `silo_humedo_01_fan_running` | bool | 0 / 1 | Ventilador de aireación (auto > 20%) |
| `silo_humedo_01_alarm_active` | bool | 0 / 1 | Alarma de nivel crítico |

**Lógica de llenado:**
- Se llena cuando DISTRIBUIDORA está en marcha: +~0.6 % por minuto a caudal pleno.
- Se vacía cuando SECADORA está en marcha: −~0.5 % por minuto.
- Si ambas están paradas, el nivel permanece estático.

---

#### SILO-SECO-01 — Almacenamiento de grano seco

Recibe el grano seco de la SECADORA. Se vacía continuamente por despacho/embarque.

| Señal | Unidad | Rango normal | Significado |
|---|---|---|---|
| `silo_seco_01_capacity_pct` | % | 5 – 94 | Nivel de llenado del silo |
| `silo_seco_01_fan_running` | bool | 0 / 1 | Ventilador de mantenimiento (auto > 15%) |
| `silo_seco_01_alarm_active` | bool | 0 / 1 | Alarma de nivel crítico |

**Lógica de llenado:**
- Se llena cuando SECADORA está en marcha: +~0.5 % por minuto a caudal pleno.
- Drenaje continuo constante por despacho: −0.003 % por tick (~0.18 % por minuto).

---

## 3. Dashboard: Panel de Operaciones de Planta

**Nombre en Grafana:** Panel de Operaciones de Planta  
**Archivo:** `grain-silo-executive.json`  
**Audiencia:** Gerencia, jefes de operaciones, supervisores de turno  
**Actualización:** automática cada 30 segundos

Este dashboard ofrece una visión de alto nivel del estado y rendimiento de la planta. Permite responder en segundos: ¿está la planta produciendo?, ¿hay alarmas activas?, ¿se está secando bien el grano?, ¿cuánto grano hay en depósito?

### Sección 1 — KPIs de planta (fila superior)

Los indicadores más importantes para la toma de decisiones de gerencia.

#### Disponibilidad de planta (%)

**Qué mide:** Porcentaje del tiempo en que la NORIA-01 estuvo en marcha durante la ventana de tiempo seleccionada.

**Por qué NORIA:** Es el cuello de botella de la planta. Si NORIA está parada, no hay producción. Es el proxy más representativo de la disponibilidad real.

**Cómo leer:**
- 95 – 100%: planta en excelentes condiciones operativas
- 85 – 95%: operación normal con paradas de mantenimiento programadas
- 70 – 85%: revisar causa de paradas; posible problema mecánico recurrente
- < 70%: situación crítica; intervención inmediata requerida

---

#### Caudal de recepción promedio (t/h)

**Qué mide:** Promedio del caudal de entrada del VOLCABLE-01 durante la ventana seleccionada.

**Cómo leer:** Refleja el ritmo de llegada de camiones y el rendimiento de la descarga. Un valor bajo puede indicar pocos camiones, o que el VOLCABLE estuvo parado gran parte del tiempo.

---

#### Calidad de secado — Humedad de salida (%)

**Qué mide:** Humedad promedio del grano a la salida de la SECADORA-01.

**Cómo leer:**
- 12 – 14%: zona óptima; grano apto para almacenamiento seguro
- 14 – 16%: zona de alerta; riesgo de deterioro en almacenamiento prolongado
- > 16%: zona de riesgo; grano no debe ingresar a SILO-SECO sin corrección

---

#### Nivel silo seco — Capacidad actual (%)

**Qué mide:** Nivel de llenado actual del SILO-SECO-01.

**Cómo leer:**
- < 20%: stock bajo; revisar programación de despachos
- 20 – 80%: rango operacional normal
- 80 – 94%: nivel alto; controlar ritmo de llenado vs. despacho
- > 94%: alarma de desbordamiento; detener SECADORA si no hay capacidad de despacho

---

#### Alarmas activas (conteo)

**Qué mide:** Número de señales de alarma activas en ese instante en todos los equipos de la planta.

**Cómo leer:**
- 0: sin alarmas; planta operando normalmente
- 1 – 2: condición de alerta; verificar qué equipo está en alarma
- > 2: situación seria; activar protocolo de respuesta a incidentes

---

### Sección 2 — Estado de equipos

Muestra el estado EN MARCHA / DETENIDO de cada activo en tiempo real. Los valores de texto aparecen en español (EN MARCHA / DETENIDO / SIN ALARMAS / ALARMA ACTIVA).

**Cómo leer:** Si la NORIA y la DISTRIBUIDORA aparecen en estados distintos, hay una inconsistencia a verificar en campo. En condiciones normales, ambas deben coincidir siempre.

---

### Sección 3 — Líneas de tiempo de estados

Barras horizontales de color que muestran el historial de marcha/parada de cada equipo durante la ventana de tiempo.

**Cómo leer:**
- Barra verde continua: equipo estuvo en marcha de forma ininterrumpida
- Segmentos rojos/grises: períodos de parada
- Paradas frecuentes y breves en VOLCABLE: normal (ciclos de camiones)
- Paradas en NORIA: impacto crítico; ver duración y frecuencia

---

### Sección 4 — Cascada de caudal (t/h)

Panel de tendencias que superpone el caudal de los cuatro activos de la cadena transportadora: VOLCABLE → REDLER → NORIA → DISTRIBUIDORA.

Ver sección [7. Cascada de caudal](#7-cascada-de-caudal-cómo-leer-el-flujo-de-la-planta) para la interpretación detallada.

---

### Sección 5 — Salud mecánica

Indicadores del estado de los equipos con mayor desgaste.

**Eficiencia de cadena (%):** Relación entre el caudal de la DISTRIBUIDORA y el de la VOLCABLE. Mide cuánto grano que entra por recepción llega efectivamente al proceso de distribución.

- Fórmula: `(distribuidora_tph / volcable_tph) × 100`
- > 90%: cadena funcionando correctamente
- 80 – 90%: hay pérdidas; posible acumulación o derrame en algún punto
- < 80%: revisar transportadores; puede haber una parada parcial no detectada

---

### Sección 6 — Calidad de secado

Panel dual-eje con temperatura de cámara (°C) e humedad de salida (%) de la SECADORA, superpuestos en el mismo gráfico de tiempo.

**Cómo leer:** Las dos curvas deben ser inversamente simétricas: cuando la temperatura sube, la humedad debe bajar. Una divergencia (temperatura alta y humedad también alta) indica un problema en el proceso de secado o falla del sensor de humedad.

---

### Sección 7 — Niveles de silos

Indicadores de llenado de SILO-HUMEDO-01 y SILO-SECO-01 con bandas de color para los rangos críticos.

---

## 4. Dashboard: Monitoreo Técnico y Mantenimiento

**Nombre en Grafana:** Monitoreo Técnico y Mantenimiento  
**Archivo:** `grain-silo-maintenance.json`  
**Audiencia:** Operadores de mantenimiento, ingenieros de confiabilidad, supervisores técnicos  
**Actualización:** automática cada 30 segundos

Este dashboard muestra las señales de salud mecánica de los equipos y el historial de eventos de parada. Permite diagnosticar problemas antes de que se conviertan en fallas, y analizar patrones de mantenimiento correctivo.

### Sección 1 — KPIs de mantenimiento

#### Disponibilidad NORIA (%)

Porcentaje de tiempo en marcha de NORIA-01. Es el indicador de confiabilidad más importante del departamento de mantenimiento.

#### TMPR — Tiempo Medio Para Reparar (segundos)

**Qué mide:** Duración promedio de las paradas de NORIA-01 durante la ventana seleccionada. Equivale al MTTR (Mean Time To Repair).

**Cómo leer:**
- < 300 s (5 min): paradas breves; posiblemente automáticas o eléctricas
- 300 – 1800 s (5 – 30 min): paradas mecánicas típicas con intervención rápida
- > 1800 s (30 min): paradas mayores; pueden indicar falla seria o falta de repuestos

#### TMEF — Tiempo Medio Entre Fallas (segundos)

**Qué mide:** Tiempo promedio que transcurre entre una parada y la siguiente de NORIA-01. Equivale al MTBF (Mean Time Between Failures).

**Cómo leer:** Un TMEF en disminución (paradas más frecuentes) es señal de deterioro mecánico progresivo. Comparar la tendencia semana a semana.

#### Paradas por hora

Frecuencia de eventos MACHINE_STOPPED para NORIA-01. Complementa el TMEF con una vista de densidad de fallas.

---

### Sección 2 — Líneas de tiempo de alarmas

Historial visual de alarmas activas por equipo. Cada fila corresponde a un activo; los segmentos de color muestran cuándo estuvo activa la señal de alarma.

**Cómo leer:**
- Alarmas frecuentes en NORIA: revisar rodamientos de cabeza y tensión de correa
- Alarmas frecuentes en REDLER: revisar temperatura del reductor y alineación de cadena
- Alarmas en SECADORA: verificar temperatura de cámara y sensor de humedad
- Alarmas en silos: revisar nivel; posible condición de desbordamiento o vaciado

---

### Sección 3 — Corrientes de motores (A)

Tendencias de corriente para cada motor de la planta. La corriente eléctrica es un proxy directo de la carga mecánica.

**Cómo leer:**
- Corriente estable proporcional al caudal: operación normal
- Corriente alta con caudal bajo: resistencia mecánica elevada; posible atasco parcial, rozamiento, o desgaste de rodamiento
- Corriente oscilante: inestabilidad en la carga; revisar alimentación del equipo
- Corriente en cero con equipo en marcha: falla eléctrica o de sensor

**Umbrales por equipo:**

| Equipo | Corriente nominal | Límite de alerta |
|---|---|---|
| VOLCABLE-01 | ~47 A | > 72 A |
| REDLER-01 | ~62 A | > 90 A |
| NORIA-01 | ~78 A | > 120 A |
| DISTRIBUIDORA-01 | ~21 A | > 36 A |
| SECADORA-01 | ~96 A | > 150 A |

---

### Sección 4 — Vibración ISO 10816 (mm/s)

Tendencias de vibración de NORIA-01 y REDLER-01. Los paneles incluyen bandas de color que corresponden a las zonas de la norma ISO 10816.

#### Zonas ISO 10816 — Criterio de severidad

| Zona | Rango (mm/s) | Color | Significado | Acción recomendada |
|---|---|---|---|---|
| **A** | 0 – 2.3 | Verde | Máquina nueva / excelente | Ninguna |
| **B** | 2.3 – 4.5 | Amarillo | Operación normal a largo plazo | Monitoreo periódico |
| **C** | 4.5 – 6.5 | Naranja | Operar temporalmente | Programar mantenimiento pronto |
| **D** | > 6.5 | Rojo | Riesgo de daño; detener | Parada inmediata para inspección |

**NORIA-01:** umbral de alarma en 6.5 mm/s (zona D).  
**REDLER-01:** umbral de alarma en 5.0 mm/s (zona C/D).

**Tendencias a observar:**
- Incremento gradual semana a semana: desgaste normal; planificar cambio de rodamientos
- Salto brusco de zona A a C en minutos: evento de impacto; inspeccionar cangilones o cadena
- Vibración alta sólo a caudal máximo: desequilibrio dinámico; balanceo de ejes

---

### Sección 5 — Temperaturas de cojinetes (°C)

Tendencias de temperatura de cojinetes y reductores de NORIA-01 y REDLER-01.

**Cómo leer:**
- Temperatura que sube lentamente durante el turno: normal; el calor se genera por fricción bajo carga
- Temperatura que supera el umbral con caudal bajo: lubricación insuficiente o rodamiento dañado
- Temperatura que baja cuando el equipo está en marcha: sensor defectuoso

**Umbrales por equipo:**

| Equipo | Rango normal | Alerta | Alarma (parada) |
|---|---|---|---|
| NORIA-01 | < 68 °C | 68 – 78 °C | > 78 °C |
| REDLER-01 | < 55 °C | 55 – 65 °C | > 65 °C |

---

### Sección 6 — Registro de eventos

Tabla cronológica de eventos procesados por el sistema, extraída de la tabla `processed_events`. Cada fila corresponde a un evento detectado automáticamente.

#### Tipos de eventos

| Evento | Color | Significado |
|---|---|---|
| `MACHINE_STOPPED` | Rojo | El activo pasó de EN MARCHA a DETENIDO |
| `MACHINE_RESUMED` | Verde | El activo pasó de DETENIDO a EN MARCHA |
| `DOWNTIME_DETECTED` | Naranja | Parada completa registrada con duración en segundos |

**Columna `metadata → assetId`:** identifica el activo al que corresponde el evento (p.ej. `noria_01`, `volcable_01`).

**Columna `duration_seconds`:** sólo presente en eventos `DOWNTIME_DETECTED` y `MACHINE_RESUMED`. Indica cuántos segundos duró la parada desde que se detectó hasta que se reanudó.

---

### Sección 7 — Frecuencia de paradas (barras por 30 min)

Gráfico de barras que agrupa los eventos `MACHINE_STOPPED` de NORIA-01 en ventanas de 30 minutos.

**Cómo leer:**
- 0 – 1 paradas por intervalo: operación estable
- 2 – 4 paradas por intervalo: actividad de mantenimiento o inestabilidad
- > 4 paradas por intervalo: el equipo está ciclando (posible problema eléctrico o de protección)

---

## 5. Interpretación de alarmas

### Origen de las alarmas

Las alarmas se generan por dos tipos de condiciones:

**Tipo 1 — Umbral de proceso (basada en medición):**
La señal analógica supera un límite físico definido para el equipo.

| Equipo | Condición | Consecuencia operacional |
|---|---|---|
| NORIA-01 | Temperatura cojinete > 78 °C | Riesgo de fundición de rodamiento; detener en máximo 10 min |
| NORIA-01 | Vibración > 6.5 mm/s | Riesgo de rotura de correa o cangilón; detener para inspección |
| REDLER-01 | Temperatura reductor > 65 °C | Sobrecalentamiento; verificar lubricación |
| REDLER-01 | Vibración > 5.0 mm/s | Desalineación o desgaste de cadena |
| SECADORA-01 | Temperatura cámara > 102 °C | Riesgo de incendio; parada de emergencia |
| SECADORA-01 | Humedad salida > 18% | Grano no seco; no despachar a SILO-SECO |
| SILO-HUMEDO-01 | Nivel < 8% | Secadora sin alimentación; riesgo de daño por funcionamiento en vacío |
| SILO-HUMEDO-01 | Nivel > 92% | Riesgo de desbordamiento de grano húmedo |
| SILO-SECO-01 | Nivel > 94% | Riesgo de desbordamiento de grano seco |

**Tipo 2 — Alarma de falla de equipo (fault alarm):**
Falla mecánica o eléctrica aleatoria detectada por el PLC. No correlaciona con una señal analógica específica. Duración típica: 10 – 60 segundos (se borra sola si la falla es transitoria).

### Procedimiento ante una alarma

1. **Identificar el activo:** ver la columna `asset` en el registro de eventos o la fila correspondiente en la línea de tiempo de alarmas.
2. **Clasificar la alarma:** ¿es de umbral (analógica fuera de rango) o de falla de equipo?
3. **Evaluar el impacto en cascada:** ¿el activo en alarma es la NORIA? → toda la planta aguas abajo está afectada.
4. **Decidir acción:** parada inmediata, mantenimiento programado, o monitoreo continuo.
5. **Registrar en el sistema de órdenes de trabajo.**

---

## 6. Interpretación de paradas y tiempos muertos

### Cómo el sistema detecta paradas

El procesador lee la señal `*_running` de cada activo cada 5 segundos. Cuando detecta un cambio de valor (1 → 0 o 0 → 1), genera un evento y lo almacena en la base de datos.

### Ciclo completo de un evento de parada

```
[señal running cae a 0]
        │
        ▼
MACHINE_STOPPED  →  registra: activo, hora de inicio de parada
        │
        │  (equipo fuera de servicio)
        │
        ▼
MACHINE_RESUMED  →  registra: activo, hora de reanudación, duración en segundos
        │
        ▼
DOWNTIME_DETECTED  →  confirma: duración total de la parada (mismo valor)
```

### Análisis de duración de paradas

| Duración | Interpretación probable |
|---|---|
| < 30 s | Micro-parada eléctrica o rebote de señal; posiblemente automática |
| 30 s – 5 min | Intervención de operador; ajuste menor, limpieza, atasco pequeño |
| 5 – 30 min | Intervención de mantenimiento: cambio de pieza, lubricación, revisión |
| 30 min – 2 h | Falla significativa: diagnóstico, búsqueda de repuestos, reparación |
| > 2 h | Falla grave o parada programada de mantenimiento mayor |

### Dependencias de parada entre activos

Cuando un activo se detiene, los efectos se propagan aguas abajo con retardos medibles:

| Activo parado | Efecto inmediato | Efecto con retardo |
|---|---|---|
| VOLCABLE-01 | Throughput de REDLER empieza a caer (~8 s) | NORIA/DISTRIBUIDORA caen (~18 s) |
| REDLER-01 | Throughput de NORIA empieza a caer (~10 s) | SILO-HUMEDO deja de llenarse |
| NORIA-01 | DISTRIBUIDORA se detiene al instante | SILO-HUMEDO deja de llenarse |
| SECADORA-01 | SILO-HUMEDO empieza a acumularse | SILO-SECO deja de llenarse |

**Señal de alerta:** si DISTRIBUIDORA aparece en marcha y NORIA parada (o viceversa) durante más de 2 ciclos de lectura (10 s), verificar el sensor o la comunicación PLC.

---

## 7. Cascada de caudal: cómo leer el flujo de la planta

El panel de cascada superpone los caudales (t/h) de los cuatro activos de la cadena transportadora en una sola vista de tiempo.

### Lectura de las curvas

```
Caudal (t/h)
│
│  VOLCABLE ──────────┐   ┌────────────────────────────
│                     │   │
│  REDLER  ─────────────────────────────────  (sigue con lag)
│
│  NORIA   ─────────────────────────────────  (sigue con lag)
│
│  DISTRIBUIDORA ─────────────────────────────  (igual que NORIA)
│
└─────────────────────────────────────────────► tiempo
```

### Patrones normales

- Las cuatro curvas se mueven juntas con un retardo escalonado de ~10 s entre etapas.
- Cuando VOLCABLE se detiene, las otras tres bajan gradualmente durante los siguientes 30 – 60 s.
- DISTRIBUIDORA siempre sigue exactamente a NORIA (misma curva, con leve diferencia de escala).

### Patrones de alerta

| Patrón en la cascada | Interpretación |
|---|---|
| VOLCABLE cae pero REDLER no baja | REDLER tiene inventario acumulado en el transportador; esperar |
| REDLER cae bruscamente sin VOLCABLE caer | Posible atasco en el transportador o parada eléctrica del REDLER |
| NORIA cae y DISTRIBUIDORA no | Inconsistencia de sensor; verificar en campo |
| Todas las curvas en cero excepto VOLCABLE | La cadena está rota aguas arriba del REDLER |

### Correlaciones observadas en datos reales

| Par de señales | Correlación | Significado |
|---|---|---|
| VOLCABLE ↔ REDLER | +0.75 | Seguimiento con lag visible |
| REDLER ↔ NORIA | +0.90 | Acoplamiento mecánico estrecho |
| NORIA ↔ DISTRIBUIDORA | +0.94 | Prácticamente rígido (mismo eje) |

---

## 8. Umbrales de vibración y temperatura

### Referencia visual rápida — Colores en los gauges

Los paneles de tipo gauge en Grafana usan la siguiente codificación de color:

| Color | Estado | Acción |
|---|---|---|
| Verde | Dentro del rango óptimo | Ninguna |
| Amarillo | Zona de atención | Monitorear con mayor frecuencia |
| Naranja | Zona de alerta operacional | Planificar intervención próxima |
| Rojo | Fuera de límite seguro | Intervención inmediata |

### Tabla de umbrales completa

#### Temperatura de cojinetes / reductor

| Equipo | Verde | Amarillo | Rojo (alarma) |
|---|---|---|---|
| NORIA-01 (cojinete cabeza) | < 68 °C | 68 – 78 °C | > 78 °C |
| REDLER-01 (reductor / cojinete) | < 55 °C | 55 – 65 °C | > 65 °C |

#### Temperatura de proceso

| Equipo | Verde | Amarillo | Rojo (alarma) |
|---|---|---|---|
| SECADORA-01 (cámara) | 90 – 98 °C | 85 – 90 °C o 98 – 102 °C | < 85 °C o > 102 °C |

**Nota:** en la SECADORA, tanto el exceso como el defecto de temperatura son problemáticos. Temperatura baja → grano insuficientemente seco. Temperatura alta → riesgo de incendio.

#### Vibración (norma ISO 10816)

| Equipo | Zona A (buena) | Zona B (aceptable) | Zona C (atención) | Zona D (alarma) |
|---|---|---|---|---|
| NORIA-01 | < 2.3 mm/s | 2.3 – 4.5 mm/s | 4.5 – 6.5 mm/s | > 6.5 mm/s |
| REDLER-01 | < 2.3 mm/s | 2.3 – 4.5 mm/s | 4.5 – 5.0 mm/s | > 5.0 mm/s |

#### Humedad de grano (SECADORA-01)

| Verde | Amarillo | Rojo |
|---|---|---|
| 12 – 14% | 14 – 16% | < 12% o > 16% (alarma > 18%) |

---

## 9. Monitoreo de silos

Los silos son los buffers del sistema. Su nivel refleja el balance entre entrada y salida de grano en cada etapa del proceso.

### SILO-HUMEDO-01 — Lógica de operación

```
Nivel silo húmedo
│
│  DESBORDAMIENTO ──────────────────────────── 92% ← ALARMA
│  
│  ZONA DE OPERACIÓN NORMAL ─────────── 20% a 92%
│  
│  VENTILADOR AUTO-ARRANQUE ─────────── 20%
│  
│  ZONA BAJA ─────────────────────────── 8% a 20%
│  
│  SECADORA SIN ALIMENTACIÓN ─────────── 8% ← ALARMA
│
└──────────────────────────────────────────── 0%
```

**Nivel subiendo rápidamente:** DISTRIBUIDORA está en marcha y SECADORA parada → el silo se llena sin drenarse. Si SECADORA no arranca pronto, habrá desbordamiento.

**Nivel bajando hacia 8%:** SECADORA está consumiendo grano más rápido de lo que llega → verificar que NORIA y DISTRIBUIDORA estén en marcha.

**Ventilador de aireación:** arranca automáticamente cuando el nivel supera el 20%. Mantiene el grano húmedo aireado para evitar fermentación. Si el ventilador está detenido con nivel > 20%, verificar el sistema de control.

### SILO-SECO-01 — Lógica de operación

```
Nivel silo seco
│
│  DESBORDAMIENTO ──────────────────────── 94% ← ALARMA
│  
│  ZONA ALTA ────────────────────────── 80% a 94%
│  
│  ZONA DE OPERACIÓN NORMAL ───────── 15% a 80%
│  
│  VENTILADOR AUTO-ARRANQUE ─────────── 15%
│  
│  STOCK BAJO ────────────────────────── < 10%
│
└──────────────────────────────────────────── 0%
```

**El nivel siempre debe estar subiendo ligeramente** cuando la SECADORA está en marcha (el ritmo de entrada supera el drenaje de despacho). Si el nivel cae cuando la SECADORA está activa, revisar el sensor.

**Nivel estancado en 0% con SECADORA en marcha:** posible falla del sensor de nivel o problema en la cañería de transferencia.

### Comparación de niveles como indicador de equilibrio de planta

| Estado de los silos | Interpretación |
|---|---|
| Húmedo subiendo + Seco subiendo | Planta operando a plena capacidad |
| Húmedo subiendo + Seco estático | SECADORA parada; grano húmedo se acumulando |
| Húmedo estático + Seco bajando | Cadena transportadora parada; SECADORA consumiendo reserva |
| Ambos bajando | Parada general de planta; sólo el despacho del seco consume |

---

## 10. Referencia rápida por rol

### Para gerencia y dirección

| Pregunta | Dónde encontrar la respuesta |
|---|---|
| ¿Está la planta produciendo hoy? | Panel de Operaciones → Estado de equipos / Disponibilidad de planta |
| ¿Cuánto grano recibimos esta mañana? | Panel de Operaciones → Caudal de recepción promedio |
| ¿El grano está saliendo bien seco? | Panel de Operaciones → Calidad de secado / Humedad salida |
| ¿Hay alguna alarma activa ahora mismo? | Panel de Operaciones → Contador de alarmas activas |
| ¿Cuánto grano tenemos en stock listo? | Panel de Operaciones → Nivel silo seco |

### Para operadores y supervisores de turno

| Pregunta | Dónde encontrar la respuesta |
|---|---|
| ¿Qué equipos están en marcha ahora? | Panel de Operaciones → Estado de equipos |
| ¿Cuándo paró por última vez la NORIA? | Mantenimiento → Registro de eventos (filtrar `noria_01`) |
| ¿El nivel del silo húmedo está bien? | Panel de Operaciones → Niveles de silos |
| ¿Hay riesgo de desbordamiento del silo seco? | Panel de Operaciones → Nivel silo seco (gauge con bandas) |
| ¿La cascada de caudal está bien balanceada? | Panel de Operaciones → Cascada de caudal |

### Para mantenimiento y confiabilidad

| Pregunta | Dónde encontrar la respuesta |
|---|---|
| ¿Cómo está la vibración de la NORIA ahora? | Mantenimiento → Vibración ISO 10816 |
| ¿La temperatura del reductor del REDLER subió? | Mantenimiento → Temperaturas de cojinetes |
| ¿Cuántas veces paró la NORIA en el último turno? | Mantenimiento → Frecuencia de paradas / Registro de eventos |
| ¿Cuánto tardamos en promedio en reactivar? | Mantenimiento → TMPR (MTTR) |
| ¿El motor de la NORIA está tirando más corriente que antes? | Mantenimiento → Corrientes de motores |
| ¿Hay algún equipo en zona C o D de vibración? | Mantenimiento → Gauges de vibración ISO 10816 |

---

*Guía operacional generada para el sistema Evolution IoT Demo. Para consultas técnicas sobre el sistema de monitoreo, referirse al documento `docs/architecture/grain-silo-operational-model.md`.*
