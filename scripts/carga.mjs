#!/usr/bin/env node
// Prueba de carga del flujo: dispara 7000 webhooks firmados en simultáneo, en orden aleatorio,
// y verifica que el saldo final del comercio sea exacto una vez procesado todo.
// Uso: WEBHOOK_SECRET=... MERCHANT_API_KEY=... node scripts/carga.mjs
// Con 7000 conexiones abiertas puede hacer falta subir el límite de archivos: ulimit -n 20000
import { createHmac, randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const SECRET = process.env.WEBHOOK_SECRET;
const API_KEY = process.env.MERCHANT_API_KEY;
const MERCHANT_ID = process.env.MERCHANT_ID ?? 'm_001';
const COMISION_BPS = Number(process.env.COMISION_BPS ?? 250); // 2,5 % en puntos básicos
const CONCURRENCIA = Number(process.env.CONCURRENCIA ?? 7000);
const ESPERA_MAX_S = Number(process.env.ESPERA_MAX_S ?? 120);
const TIMEOUT_MS = 30_000;

if (!SECRET || !API_KEY) {
  console.error('Faltan WEBHOOK_SECRET y/o MERCHANT_API_KEY');
  process.exit(1);
}

// Prefijo por corrida para que dos corridas seguidas no choquen por idempotencia.
const CORRIDA = randomBytes(4).toString('hex');

const ahora = () => Math.floor(Date.now() / 1000);
const firmar = (ts, body) => createHmac('sha256', SECRET).update(`${ts}.`).update(body).digest('hex');
const aMonto = (centavos) => (centavos / 100).toFixed(2);
const neto = (centavos) => centavos - Math.floor((centavos * COMISION_BPS) / 10_000);

function aCentavos(valor) {
  const [entero, dec = ''] = String(valor).split('.');
  const signo = entero.startsWith('-') ? -1 : 1;
  return signo * (Math.abs(Number(entero)) * 100 + Number(dec.padEnd(2, '0').slice(0, 2)));
}

// El PSP no garantiza un formato fijo de JSON.
function serializar(evento, i) {
  if (i % 3 === 0) return JSON.stringify(evento, null, 2);
  if (i % 3 === 1) return JSON.stringify(evento);
  return JSON.stringify(evento).replace(/":/g, '": ');
}

function evento(tipo, tx, centavos, segundos, sufijo) {
  return {
    event_id: `evt_${CORRIDA}_${tx}_${sufijo}`,
    type: tipo,
    occurred_at: new Date(Date.UTC(2026, 9, 23, 16, 0, segundos)).toISOString().replace('.000', ''),
    data: { transaction_id: `tx_${CORRIDA}_${tx}`, merchant_id: MERCHANT_ID, amount: aMonto(centavos), currency: 'ARS' },
  };
}

// Armado de las 7000 requests:
//   4000  created + approved de 2000 transacciones        → 200, acreditan
//   1000  approved duplicados (mismo event_id)            → 200, sin efecto
//   1500  created + approved + reversed de 500 transacc.  → 200, efecto neto cero
//    300  approved con monto alterado después de firmar   → 401
//    200  created con timestamp de hace 10 minutos        → 401
const requests = [];
const aprobadas = [];
const revertidas = [];
const vencidas = [];
let deltaEsperado = 0;
let n = 0;

const agregar = (ev, esperado, extra = {}) => {
  requests.push({ body: serializar(ev, n++), esperado, ...extra });
};

for (let i = 0; i < 2000; i++) {
  const centavos = 10_000 + ((i * 7919) % 900_000);
  const tx = `a${i}`;
  agregar(evento('payment.created', tx, centavos, 0, 'c'), 200);
  const aprobado = evento('payment.approved', tx, centavos, 30, 'a');
  agregar(aprobado, 200);
  if (i < 1000) agregar(aprobado, 200);
  if (i < 300) {
    const original = serializar(aprobado, 1);
    const alterado = original.replace(`"amount":"${aMonto(centavos)}"`, `"amount":"${aMonto(centavos * 10)}"`);
    requests.push({ body: alterado, firmarCon: original, esperado: 401 });
  }
  aprobadas.push(`tx_${CORRIDA}_${tx}`);
  deltaEsperado += neto(centavos);
}

for (let i = 0; i < 500; i++) {
  const centavos = 5_000 + ((i * 104_729) % 500_000);
  const tx = `r${i}`;
  agregar(evento('payment.created', tx, centavos, 0, 'c'), 200);
  agregar(evento('payment.approved', tx, centavos, 30, 'a'), 200);
  agregar(evento('payment.reversed', tx, centavos, 60, 'r'), 200);
  revertidas.push(`tx_${CORRIDA}_${tx}`);
}

for (let i = 0; i < 200; i++) {
  const tx = `v${i}`;
  agregar(evento('payment.created', tx, 100_000, 0, 'c'), 401, { ts: ahora() - 600 });
  vencidas.push(`tx_${CORRIDA}_${tx}`);
}

// Orden aleatorio: created, approved y reversed de una misma transacción llegan en cualquier orden.
for (let i = requests.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [requests[i], requests[j]] = [requests[j], requests[i]];
}

async function enviar(req) {
  const ts = req.ts ?? ahora();
  const inicio = performance.now();
  try {
    const res = await fetch(`${BASE_URL}/webhooks/psp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PSP-Timestamp': String(ts),
        'X-PSP-Signature': `v1=${firmar(ts, req.firmarCon ?? req.body)}`,
      },
      body: req.body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await res.arrayBuffer();
    return { status: res.status, ms: performance.now() - inicio, esperado: req.esperado };
  } catch (err) {
    const motivo = err.name === 'TimeoutError' ? 'timeout' : (err.cause?.code ?? err.name);
    return { status: `error:${motivo}`, ms: performance.now() - inicio, esperado: req.esperado };
  }
}

async function saldo() {
  const res = await fetch(`${BASE_URL}/merchants/me/balance`, { headers: { 'x-api-key': API_KEY } });
  if (res.status !== 200) throw new Error(`GET /merchants/me/balance respondió ${res.status}`);
  return aCentavos((await res.json()).available);
}

async function estado(tx) {
  const res = await fetch(`${BASE_URL}/transactions/${tx}`, { headers: { 'x-api-key': API_KEY } });
  if (res.status === 404) return 404;
  return (await res.json()).status;
}

const percentil = (ordenados, p) => ordenados[Math.min(ordenados.length - 1, Math.floor((p / 100) * ordenados.length))];
const muestra = (lista, k) => lista.slice().sort(() => Math.random() - 0.5).slice(0, k);

async function main() {
  console.log(`Corrida ${CORRIDA}: ${requests.length} requests a ${BASE_URL}, concurrencia ${CONCURRENCIA}\n`);

  const saldoInicial = await saldo();
  const resultados = [];
  let siguiente = 0;
  const inicio = performance.now();

  const trabajador = async () => {
    while (siguiente < requests.length) {
      const req = requests[siguiente++];
      resultados.push(await enviar(req));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, requests.length) }, trabajador));
  const duracion = (performance.now() - inicio) / 1000;

  const porStatus = {};
  for (const r of resultados) porStatus[r.status] = (porStatus[r.status] ?? 0) + 1;
  const tiempos = resultados.map((r) => r.ms).sort((a, b) => a - b);
  const errores5xx = resultados.filter((r) => typeof r.status === 'number' && r.status >= 500).length;
  const erroresRed = resultados.filter((r) => typeof r.status === 'string').length;
  const inesperados = resultados.filter((r) => r.status !== r.esperado).length;

  console.log('Respuestas por status:', porStatus);
  console.log(`Duración ${duracion.toFixed(1)} s, ${(requests.length / duracion).toFixed(0)} req/s`);
  // La latencia incluye la cola del propio cliente con 7000 conexiones abiertas: se informa, no se exige.
  console.log(
    `Latencia p50 ${percentil(tiempos, 50).toFixed(0)} ms, p95 ${percentil(tiempos, 95).toFixed(0)} ms, ` +
      `p99 ${percentil(tiempos, 99).toFixed(0)} ms, máx ${tiempos.at(-1).toFixed(0)} ms\n`,
  );

  // El procesamiento puede ser asíncrono: se espera a que el saldo converja.
  const esperado = saldoInicial + deltaEsperado;
  let actual = await saldo();
  const inicioEspera = performance.now();
  while (actual !== esperado && (performance.now() - inicioEspera) / 1000 < ESPERA_MAX_S) {
    await new Promise((r) => setTimeout(r, 2000));
    actual = await saldo();
  }
  const convergencia = ((performance.now() - inicioEspera) / 1000).toFixed(1);

  const chequeos = [
    ...muestra(aprobadas, 25).map((tx) => [tx, 'approved']),
    ...muestra(revertidas, 15).map((tx) => [tx, 'reversed']),
    ...muestra(vencidas, 10).map((tx) => [tx, 404]),
  ];
  const estados = await Promise.all(chequeos.map(async ([tx, esp]) => [tx, esp, await estado(tx)]));
  const malEstado = estados.filter(([, esp, real]) => esp !== real);

  const criterios = [
    ['Sin respuestas 5xx', errores5xx === 0, `${errores5xx} con 5xx`],
    ['Sin errores de red ni timeouts', erroresRed === 0, `${erroresRed} errores (si son EMFILE, subir ulimit -n)`],
    ['Cada request con el status esperado (200 o 401)', inesperados === 0, `${inesperados} distintos`],
    [
      `Saldo exacto en menos de ${ESPERA_MAX_S} s`,
      actual === esperado,
      `esperado ${aMonto(esperado)}, actual ${aMonto(actual)}, ${convergencia} s de espera`,
    ],
    ['Muestra de 50 transacciones en el estado esperado', malEstado.length === 0, `${malEstado.length} distintas`],
  ];

  let fallas = 0;
  for (const [nombre, ok, detalle] of criterios) {
    if (!ok) fallas++;
    console.log(`${ok ? 'OK  ' : 'FALLA'} ${nombre.padEnd(52)} ${detalle}`);
  }
  for (const [tx, esp, real] of malEstado.slice(0, 5)) console.log(`      ${tx}: esperado ${esp}, actual ${real}`);

  console.log(fallas === 0 ? '\nCarga completa sin fallas.' : `\n${fallas} criterio(s) con falla.`);
  process.exit(fallas === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
