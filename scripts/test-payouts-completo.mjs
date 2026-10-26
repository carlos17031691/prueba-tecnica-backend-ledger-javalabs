#!/usr/bin/env node
// Prueba funcional de la extensión B1 (Payouts): idempotencia, conflictos,
// validaciones y protección contra saldo negativo.
// Uso: WEBHOOK_SECRET=... MERCHANT_API_KEY=... node scripts/test-payouts-completo.mjs
import { createHmac, randomUUID } from 'node:crypto';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const API_KEY = process.env.MERCHANT_API_KEY || 'mk_live_1024e44ca85909bb2478f9a8cc7cd18a';
const SECRET = process.env.WEBHOOK_SECRET || '98906661834c5d239fd55598d12f3ac75cd9aa088f3ca38ad3f90e256814c504';

// La salida va a stdout como JSON: escapa saltos de línea y caracteres de control,
// así no se puede inyectar contenido falso en el log y se conserva la información.
const informar = (etiqueta, valor) => {
  process.stdout.write(`${etiqueta}: ${JSON.stringify(valor)}\n`);
};

const cabeceras = () => ({ 'x-api-key': API_KEY, 'content-type': 'application/json' });
const firmar = (ts, body) => `v1=${createHmac('sha256', SECRET).update(ts + '.' + body).digest('hex')}`;
const ahora = () => String(Math.floor(Date.now() / 1000));

async function leerCuerpo(res) {
  const texto = await res.text();
  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
}

async function consultarSaldo() {
  return leerCuerpo(await fetch(`${BASE}/merchants/me/balance`, { headers: cabeceras() }));
}

async function enviarWebhook(tipo, tx) {
  const evento = {
    event_id: `ev_${tx}_${tipo[0]}`,
    type: `payment.${tipo}`,
    occurred_at: new Date().toISOString(),
    data: { transaction_id: tx, merchant_id: 'm_001', amount: '1000.00', currency: 'ARS' },
  };
  const body = JSON.stringify(evento);
  const ts = ahora();
  const res = await fetch(`${BASE}/webhooks/psp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-psp-timestamp': ts, 'x-psp-signature': firmar(ts, body) },
    body,
  });
  return { status: res.status, body: await leerCuerpo(res) };
}

async function pedirPayout(amount, idempotencyKey) {
  const headers = cabeceras();
  if (idempotencyKey !== undefined) headers['idempotency-key'] = idempotencyKey;
  const res = await fetch(`${BASE}/payouts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ amount }),
  });
  return { status: res.status, body: await leerCuerpo(res) };
}

async function main() {
  console.log('=== PAYOUT TEST B1 ===');

  console.log('\n[1] Saldo inicial');
  informar('saldo', await consultarSaldo());

  console.log('\n[2] Acreditando 1000.00 ARS (neto 975.00) vía webhooks firmados');
  const tx = `txp_${Date.now()}`;
  for (const tipo of ['created', 'approved']) {
    informar(`webhook.${tipo}`, await enviarWebhook(tipo, tx));
  }

  console.log('\nEsperando al worker...');
  await new Promise((r) => setTimeout(r, 3000));
  informar('saldo', await consultarSaldo());

  const key = `pk_${randomUUID()}`;

  console.log('\n[3] Sin Idempotency-Key (esperado 400)');
  informar('respuesta', await pedirPayout('10.00'));

  console.log('\n[4] Idempotency-Key vacía (esperado 400)');
  informar('respuesta', await pedirPayout('10.00', ''));

  console.log('\n[5] Saldo insuficiente (esperado 422)');
  informar('respuesta', await pedirPayout('999999999.00', `sin_saldo_${Date.now()}`));

  console.log(`\n[6] Payout de 50.00 con key ${key} (esperado 201)`);
  const creado = await pedirPayout('50.00', key);
  informar('respuesta', creado);

  console.log('\n[7] Replay misma key y mismo body (esperado 200, mismo id)');
  const replay = await pedirPayout('50.00', key);
  informar('respuesta', replay);
  informar('mismo.id', replay.body?.id === creado.body?.id);

  console.log('\n[8] Misma key con body distinto (esperado 409)');
  informar('respuesta', await pedirPayout('51.00', key));

  console.log('\n[9] Saldo final');
  informar('saldo', await consultarSaldo());

  console.log('\n=== OK ===');
}

main().catch((err) => {
  informar('error', String(err));
  process.exit(1);
});
