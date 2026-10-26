#!/usr/bin/env node
// Envía la secuencia de la especificación al servicio, firmando cada request como lo hace el PSP.
// Uso: WEBHOOK_SECRET=... MERCHANT_API_KEY=... node scripts/enviar-secuencia.mjs
// Requiere Node 18 o superior (fetch nativo).
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const SECRET = process.env.WEBHOOK_SECRET;
const API_KEY = process.env.MERCHANT_API_KEY;

if (!SECRET || !API_KEY) {
  console.error('Faltan WEBHOOK_SECRET y/o MERCHANT_API_KEY');
  process.exit(1);
}

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'eventos');

// Se devuelve el Buffer tal cual está en disco: la firma va sobre esos bytes, sin re-serializar.
const leer = (archivo) => readFileSync(join(DIR, archivo));

const ahora = () => Math.floor(Date.now() / 1000);

const firmar = (secret, ts, body) =>
  createHmac('sha256', secret).update(`${ts}.`).update(body).digest('hex');

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

let fallas = 0;

async function enviar(descripcion, body, esperado, { ts = ahora(), firmarCon = body, rotacion = false } = {}) {
  let firma = `v1=${firmar(SECRET, ts, firmarCon)}`;
  // Durante una rotación el PSP manda primero la firma con el secreto viejo.
  if (rotacion) firma = `v1=${firmar('secreto-anterior-ya-rotado', ts, firmarCon)},${firma}`;

  const res = await fetch(`${BASE_URL}/webhooks/psp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PSP-Timestamp': String(ts),
      'X-PSP-Signature': firma,
    },
    body,
  });

  const ok = res.status === esperado;
  if (!ok) fallas++;
  console.log(`${ok ? 'OK  ' : 'FALLA'} ${descripcion.padEnd(58)} esperado ${esperado}, recibido ${res.status}`);
}

async function main() {
  console.log(`Enviando secuencia a ${String(BASE_URL)}\n`);

  // 1
  await enviar('1. created tx_9f3a21 (15.000,00)', leer('01-created-tx_9f3a21.json'), 200);

  // 2
  const aprobado = leer('02-approved-tx_9f3a21.json');
  for (let i = 1; i <= 3; i++) {
    await enviar(`2. approved tx_9f3a21, envío ${i} de 3 (mismo event_id)`, aprobado, 200);
  }

  // 3
  await enviar('3. created tx_b71c04 (5.000,00)', leer('03-created-tx_b71c04.json'), 200);
  await enviar('3. reversed tx_b71c04 (llega antes que el approved)', leer('04-reversed-tx_b71c04.json'), 200);
  await esperar(2000);
  await enviar('3. approved tx_b71c04 (llega 2 s después)', leer('05-approved-tx_b71c04.json'), 200);

  // 4
  await enviar('4. created tx_c55e10 (999,99)', leer('06-created-tx_c55e10.json'), 200);
  await enviar('4. approved tx_c55e10 (dos firmas por rotación)', leer('07-approved-tx_c55e10.json'), 200, {
    rotacion: true,
  });

  // 5
  await enviar('5. created tx_d0a7e2 en USD', leer('08-created-tx_d0a7e2-usd.json'), 200);
  await enviar('5. approved tx_d0a7e2 en USD', leer('09-approved-tx_d0a7e2-usd.json'), 200);

  // 6: se firma el original y se envía con el monto modificado.
  const original = leer('01-created-tx_9f3a21.json');
  const alterado = Buffer.from(original.toString('utf8').replace('"15000.00"', '"95000.00"'));
  await enviar('6. body alterado después de firmar', alterado, 401, { firmarCon: original });

  // 7
  await enviar('7. timestamp de hace 10 minutos', leer('10-created-tx_e19b33-vencido.json'), 401, {
    ts: ahora() - 600,
  });

  console.log('\nConsultas');

  const saldo = await fetch(`${BASE_URL}/merchants/me/balance`, { headers: { 'x-api-key': API_KEY } });
  const cuerpo = await saldo.text();
  let disponible;
  try {
    disponible = JSON.parse(cuerpo).available;
  } catch {}
  const saldoOk = saldo.status === 200 && String(disponible) === '15600.00';
  if (!saldoOk) fallas++;
  console.log(`${saldoOk ? 'OK  ' : 'FALLA'} ${'saldo de m_001 = 15.600,00'.padEnd(58)} recibido ${saldo.status} ${String(cuerpo)}`);

  const vencida = await fetch(`${BASE_URL}/transactions/tx_e19b33`, { headers: { 'x-api-key': API_KEY } });
  const vencidaOk = vencida.status === 404;
  if (!vencidaOk) fallas++;
  console.log(`${vencidaOk ? 'OK  ' : 'FALLA'} ${'tx_e19b33 no existe (paso 7 rechazado)'.padEnd(58)} esperado 404, recibido ${vencida.status}`);

  const revertida = await fetch(`${BASE_URL}/transactions/tx_b71c04`, { headers: { 'x-api-key': API_KEY } });
  console.log(`INFO ${'estado de tx_b71c04 (esperado: reversed)'.padEnd(58)} ${String(await revertida.text())}`);

  console.log(fallas === 0 ? '\nSecuencia completa sin fallas.' : `\n${fallas} falla(s).`);
  process.exit(fallas === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
