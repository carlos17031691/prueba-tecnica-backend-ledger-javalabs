#!/usr/bin/env node
import { createHmac, randomBytes } from 'node:crypto';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const API_KEY = process.env.MERCHANT_API_KEY ?? 'mk_live_1024e44ca85909bb2478f9a8cc7cd18a';
const SECRET = process.env.WEBHOOK_SECRET ?? '98906661834c5d239fd55598d12f3ac75cd9aa088f3ca38ad3f90e256814c504';

function firmar(ts, body) {
  return `v1=${createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex')}`;
}

async function getBalance() {
  const res = await fetch(`${BASE}/merchants/me/balance`, {
    headers: { 'x-api-key': API_KEY },
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function enviarWebhook(ev) {
  const ts = Math.floor(Date.now() / 1000);
  const rawBody = JSON.stringify(ev);
  const res = await fetch(`${BASE}/webhooks/psp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-psp-timestamp': String(ts),
      'x-psp-signature': firmar(ts, rawBody),
    },
    body: rawBody,
  });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

async function main() {
  console.log('=========================================');
  console.log('TEST COMPLETO DE PAYOUTS (B1)');
  console.log('=========================================');

  console.log('\n[1] Consultando saldo inicial...');
  console.log(JSON.stringify(await getBalance(), null, 2));

  console.log('\n[2] Acreditando saldo con pago 1000.00 ARS (neto 975.00)...');
  const txId = `tx_payout_demo_${Date.now()}`;
  const evC = {
    event_id: `evt_${txId}_c`,
    type: 'payment.created',
    occurred_at: new Date().toISOString(),
    data: {
      transaction_id: txId,
      merchant_id: 'm_001',
      amount: '1000.00',
      currency: 'ARS',
    },
  };
  const evA = {
    event_id: `evt_${txId}_a`,
    type: 'payment.approved',
    occurred_at: new Date().toISOString(),
    data: {
      transaction_id: txId,
      merchant_id: 'm_001',
      amount: '1000.00',
      currency: 'ARS',
    },
  };

  console.log('created:', (await enviarWebhook(evC)).status);
  console.log('approved:', (await enviarWebhook(evA)).status);

  console.log('\nEsperando que el worker procese...');
  await new Promise((r) => setTimeout(r, 4000));
  console.log(JSON.stringify(await getBalance(), null, 2));

  const key = `payout_${Date.now()}_${randomBytes(4).toString('hex')}`;

  console.log('\n[3] POST /payouts sin Idempotency-Key (debe ser 400)...');
  let res = await fetch(`${BASE}/payouts`, {
    method: 'POST',
    headers: { 'x-api-key': API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ amount: '10.00' }),
  });
  console.log(res.status, await res.text());

  console.log('\n[4] POST /payouts con key vacía (debe ser 400)...');
  res = await fetch(`${BASE}/payouts`, {
    method: 'POST',
    headers: { 'x-api-key': API_KEY, 'content-type': 'application/json', 'idempotency-key': '' },
    body: JSON.stringify({ amount: '10.00' }),
  });
  console.log(res.status, await res.text());

  console.log('\n[5] POST /payouts sin saldo suficiente (debe ser 422)...');
  res = await fetch(`${BASE}/payouts`, {
    method: 'POST',
    headers: { 'x-api-key': API_KEY, 'content-type': 'application/json', 'idempotency-key': `no_saldo_${Date.now()}` },
    body: JSON.stringify({ amount: '999999999.00' }),
  });
  console.log(res.status, await res.text());

  console.log(`\n[6] POST /payouts exitoso 50.00 con key ${key} (debe ser 201)...`);
  res = await fetch(`${BASE}/payouts`, {
    method: 'POST',
    headers: { 'x-api-key': API_KEY, 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify({ amount: '50.00' }),
  });
  console.log(res.status);
  console.log(await res.text());

  console.log('\n[7] Replay mismo key + mismo body (debe ser 200, mismo ID)...');
  res = await fetch(`${BASE}/payouts`, {
    method: 'POST',
    headers: { 'x-api-key': API_KEY, 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify({ amount: '50.00' }),
  });
  console.log(res.status);
  console.log(await res.text());

  console.log('\n[8] Mismo key + body distinto (debe ser 409)...');
  res = await fetch(`${BASE}/payouts`, {
    method: 'POST',
    headers: { 'x-api-key': API_KEY, 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify({ amount: '99.00' }),
  });
  console.log(res.status);
  console.log(await res.text());

  console.log('\n[9] Saldo final...');
  console.log(JSON.stringify(await getBalance(), null, 2));

  console.log('\n=========================================');
  console.log('TEST COMPLETADO');
  console.log('=========================================');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
