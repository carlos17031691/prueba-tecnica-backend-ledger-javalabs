#!/usr/bin/env node
import { createHmac } from 'node:crypto';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const SECRET = process.env.WEBHOOK_SECRET || 'cambiar-por-un-secreto-largo';
const API_KEY = process.env.MERCHANT_API_KEY || 'mk_test_m001_cambiar';

function firmar(ts, body) {
  return `v1=${createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex')}`;
}

async function postWebhook(evento, extraHeaders = {}) {
  const ts = Math.floor(Date.now() / 1000);
  const rawBody = JSON.stringify(evento);
  const res = await fetch(`${BASE}/webhooks/psp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-psp-timestamp': String(ts),
      'x-psp-signature': firmar(ts, rawBody),
      ...extraHeaders
    },
    body: rawBody
  });
  return { status: res.status, body: await res.text() };
}

async function get(path, headers = {}) {
  const res = await fetch(`${BASE}${path}`, { headers: { 'x-api-key': API_KEY, ...headers } });
  return { status: res.status, body: await res.text() };
}

async function post(path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'x-api-key': API_KEY, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.text() };
}

const resultados = [];

function test(nombre, cond) {
  if (cond) {
    console.log(`✅ ${nombre}`);
    resultados.push({ ok: true, nombre });
  } else {
    console.log(`❌ ${nombre}`);
    resultados.push({ ok: false, nombre });
  }
}

console.log('🔍 AUDITORÍA COMPLETA DEL PROYECTO');
console.log('='.repeat(60));

console.log('\n📋 1. SEGURIDAD - FIRMA HMAC');
const ts = Math.floor(Date.now() / 1000);
const bodyTest = JSON.stringify({event_id:'test1',type:'payment.created',occurred_at:new Date().toISOString(),data:{transaction_id:'t1',merchant_id:'m_001',amount:'10.00',currency:'ARS'}});
const r1 = await fetch(`${BASE}/webhooks/psp`, {method:'POST',headers:{'content-type':'application/json','x-psp-timestamp':String(ts),'x-psp-signature':'v1='+ 'a'.repeat(64)}, body: bodyTest});
test('Firma inválida -> 401', r1.status === 401);

const r2 = await fetch(`${BASE}/webhooks/psp`, {method:'POST',headers:{'content-type':'application/json','x-psp-timestamp':String(ts)}, body: bodyTest});
test('Sin firma -> 401', r2.status === 401);

const r3 = await fetch(`${BASE}/webhooks/psp`, {method:'POST',headers:{'content-type':'application/json','x-psp-timestamp':String(Math.floor(Date.now()/1000)-600),'x-psp-signature':firmar(Math.floor(Date.now()/1000)-600, bodyTest)}, body: bodyTest});
test('Timestamp > 5 min -> 401', r3.status === 401);

const r4 = await fetch(`${BASE}/webhooks/psp`, {method:'POST',headers:{'content-type':'application/json','x-psp-timestamp':String(Math.floor(Date.now()/1000)+600),'x-psp-signature':firmar(Math.floor(Date.now()/1000)+600, bodyTest)}, body: bodyTest});
test('Timestamp futuro > 5 min -> 401', r4.status === 401);

console.log('\n📋 2. VALIDACIÓN DE PAYLOAD');
const ts2 = Math.floor(Date.now()/1000);
const bodyBad = JSON.stringify({event_id:'bad',type:'invalid.type',occurred_at:new Date().toISOString(),data:{transaction_id:'t2',merchant_id:'m_001',amount:'10.00',currency:'ARS'}});
const r5 = await fetch(`${BASE}/webhooks/psp`, {method:'POST',headers:{'content-type':'application/json','x-psp-timestamp':String(ts2),'x-psp-signature':firmar(ts2,bodyBad)}, body: bodyBad});
test('Tipo inválido -> 400', r5.status === 400);

const bodyBad2 = JSON.stringify({event_id:'bad2',type:'payment.created',occurred_at:'invalid',data:{transaction_id:'t3',merchant_id:'m_001',amount:'10.00',currency:'ARS'}});
const r6 = await fetch(`${BASE}/webhooks/psp`, {method:'POST',headers:{'content-type':'application/json','x-psp-timestamp':String(ts2),'x-psp-signature':firmar(ts2,bodyBad2)}, body: bodyBad2});
test('Fecha inválida -> 400', r6.status === 400);

const bodyBad3 = JSON.stringify({event_id:'bad3',type:'payment.created',occurred_at:new Date().toISOString(),data:{transaction_id:'t4',merchant_id:'m_001',amount:'10.0',currency:'ARS'}});
const r7 = await fetch(`${BASE}/webhooks/psp`, {method:'POST',headers:{'content-type':'application/json','x-psp-timestamp':String(ts2),'x-psp-signature':firmar(ts2,bodyBad3)}, body: bodyBad3});
test('Monto formato incorrecto -> 400', r7.status === 400);

console.log('\n📋 3. AUTENTICACIÓN');
const r8 = await fetch(`${BASE}/merchants/me/balance`);
test('Sin API key -> 401', r8.status === 401);

const r9 = await fetch(`${BASE}/merchants/me/balance`, {headers:{'x-api-key':'clave_invalida'}});
test('API key inválida -> 401', r9.status === 401);

const r10 = await get('/transactions/tx_no_existe');
test('Transacción ajena/inexistente -> 404', r10.status === 404);

console.log('\n📋 4. IDEMPOTENCIA');
const txId = `tx_test_${Date.now()}`;
const evtId = `evt_test_${Date.now()}`;
const evt = {event_id: evtId, type:'payment.created', occurred_at: new Date().toISOString(), data:{transaction_id: txId, merchant_id:'m_001', amount:'100.00', currency:'ARS'}};
const r11 = await postWebhook(evt);
const r12 = await postWebhook(evt);
test('Primer webhook 200', r11.status === 200);
test('Duplicado 200', r12.status === 200);
try {
  const j11 = JSON.parse(r11.body);
  const j12 = JSON.parse(r12.body);
  test('Duplicado marcado correctamente', j12.duplicate === true);
} catch(e) { test('Duplicado marcado correctamente', false); }

console.log('\n📋 5. PAYOUTS (B1)');
const r13 = await post('/payouts', {amount:'10.00'}, {});
test('Payout sin Idempotency-Key -> 400', r13.status === 400);

const r14 = await post('/payouts', {amount:'10.00'}, {'idempotency-key':''});
test('Payout con key vacía -> 400', r14.status === 400);

const r15 = await post('/payouts', {amount:'999999999.00'}, {'idempotency-key':`test_${Date.now()}`});
test('Payout sin saldo -> 422', r15.status === 422);

console.log('\n📋 6. CONSULTAS');
const r16 = await get('/merchants/me/balance');
test('Balance accesible', r16.status === 200);

const r17 = await get('/merchants/me/movements?limit=abc');
test('Limit inválido -> 400', r17.status === 400);

const r18 = await get('/merchants/me/movements?limit=0');
test('Limit 0 -> 400', r18.status === 400);

console.log('\n' + '='.repeat(60));
const pasados = resultados.filter(r=>r.ok).length;
const total = resultados.length;
console.log(`\n🎯 RESULTADO: ${pasados}/${total} pruebas pasaron (${Math.round(pasados/total*100)}%)`);
if (pasados === total) {
  console.log('✨ TODAS LAS PRUEBAS DE AUDITORÍA PASARON');
} else {
  console.log('⚠️  Algunas pruebas fallaron');
}
