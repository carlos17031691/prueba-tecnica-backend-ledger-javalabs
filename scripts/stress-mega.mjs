import { createHmac } from 'node:crypto';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const SECRET = process.env.WEBHOOK_SECRET || '';
const API_KEY = process.env.MERCHANT_API_KEY || '';

function firmar(ts, body) {
  return `v1=${createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex')}`;
}

function fmt(cents) {
  return `${Math.floor(cents/100)}.${String(cents%100).padStart(2,'0')}`;
}

console.log('MEGA STRESS TEST - MUY AGRESIVO');
console.log('='.repeat(70));

async function enviarWebhook(ev) {
  const ts = Math.floor(Date.now()/1000);
  const rawBody = JSON.stringify(ev);
  const res = await fetch(`${BASE}/webhooks/psp`, {
    method: 'POST',
    headers: {'content-type':'application/json','x-psp-timestamp':String(ts),'x-psp-signature':firmar(ts,rawBody)},
    body: rawBody
  });
  return res.status;
}

const start = Date.now();
const batch = [];
for (let i = 0; i < 1000; i++) {
  const txId = `tx_mega_${Date.now()}_${i}_${Math.random().toString(36).substr(2,5)}`;
  batch.push({ event_id: `evt_m_c_${txId}`, type: 'payment.created', occurred_at: new Date().toISOString(), data: { transaction_id: txId, merchant_id: 'm_001', amount: fmt(5000 + i), currency: 'ARS' } });
  batch.push({ event_id: `evt_m_a_${txId}`, type: 'payment.approved', occurred_at: new Date().toISOString(), data: { transaction_id: txId, merchant_id: 'm_001', amount: fmt(5000 + i), currency: 'ARS' } });
}
const results = await Promise.all(batch.map(ev => enviarWebhook(ev)));
const elapsed = Date.now() - start;
console.log(`2000 webhooks (1000 created+approved): ${results.filter(s=>s===200).length}/2000 OK en ${elapsed}ms (${(2000/elapsed*1000).toFixed(1)} req/s)`);
console.log(`Errores: ${results.filter(s=>s!==200).length}`);
console.log('='.repeat(70));
