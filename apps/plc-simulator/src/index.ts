import http from 'http';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

interface Signal {
  name: string;
  value: number;
  unit: string;
}

interface PlcSnapshot {
  machineId: string;
  timestamp: string;
  signals: Signal[];
}

function generateTelemetry(): PlcSnapshot {
  return {
    machineId: 'PLC-001',
    timestamp: new Date().toISOString(),
    signals: [
      { name: 'running',       value: Math.random() > 0.1 ? 1 : 0,                    unit: 'bool'    },
      { name: 'speed_rpm',     value: +(700 + Math.random() * 300).toFixed(2),         unit: 'rpm'     },
      { name: 'temperature_c', value: +(60  + Math.random() * 20).toFixed(2),          unit: 'celsius' },
      { name: 'parts_count',   value: Math.floor(Math.random() * 5),                   unit: 'count'   },
      { name: 'alarm_active',  value: Math.random() > 0.95 ? 1 : 0,                   unit: 'bool'    },
    ],
  };
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'plc-simulator' }));
    return;
  }

  if (req.method === 'GET' && req.url === '/telemetry') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(generateTelemetry()));
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`[plc-simulator] Listening on port ${PORT}`);
});
