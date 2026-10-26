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

console.log('STRESS TEST AVANZADO');
console.log('='.repeat(60));

const permutaciones = [
  ['created','approved','reversed'],
  ['created','reversed','approved'],
  ['approved','created','reversed'],
  ['approved','reversed','created'],
  ['reversed','created','approved'],
  ['reversed','approved','created'],
];

let ok1 = 0;
for (let i = 0; i < permutaciones.length; i++) {
  const perm = permutaciones[i];
  const txId = `tx_perm_${Date.now()}_${i}`;
  const cents = 10000 + i*100;
  const eventos = perm.map((tipo, idx) => ({
    event_id: `evt_${txId}_${tipo}_${idx}`,
    type: `payment.${tipo}`,
    occurred_at: new Date(Date.now() + idx*1000).toISOString(),
    data: { transaction_id: txId, merchant_id: 'm_001', amount: fmt(cents), currency: 'ARS' }
  }));
  
  const results = await Promise.all(eventos.map(async ev => {
    const ts = Math.floor(Date.now()/1000);
    const rawBody = JSON.stringify(ev);
    const res = await fetch(`${BASE}/webhooks/psp`, {
      method: 'POST',
      headers: {'content-type':'application/json','x-psp-timestamp':String(ts),'x-psp-signature':firmar(ts,rawBody)},
      body: rawBody
    });
    return res.status;
  }));
  
  if (results.every(s => s === 200)) ok1++;
  console.log(`[${i+1}] [${perm.join('->')}] -> ${results.join(',')} ${results.every(s=>s===200)?'OK':'FAIL'}`);
}
console.log(`Permutaciones OK: ${ok1}/${permutaciones.length}`);

const txId2 = `tx_idem_${Date.now()}`;
const evtId2 = `evt_idem_${Date.now()}`;
const ev2 = {
  event_id: evtId2,
  type: 'payment.created',
  occurred_at: new Date().toISOString(),
  data: { transaction_id: txId2, merchant_id: 'm_001', amount: '50.00', currency: 'ARS' }
};
const ts2 = Math.floor(Date.now()/1000);
const rawBody2 = JSON.stringify(ev2);
const sig2 = firmar(ts2, rawBody2);
const r2 = await Promise.all(Array(50).fill().map(() => 
  fetch(`${BASE}/webhooks/psp`, {
    method: 'POST',
    headers: {'content-type':'application/json','x-psp-timestamp':String(ts2),'x-psp-signature':sig2},
    body: rawBody2
  }).then(r => r.status)
));
console.log(`\n50 duplicados paralelos: ${r2.filter(s=>s===200).length}/50 OK`);

const start = Date.now();
const evs3 = Array(100).fill().map((_,i) => {
  const txId = `tx_perf_${Date.now()}_${i}`;
  return {
    event_id: `evt_perf_${Date.now()}_${i}`,
    type: 'payment.created',
    occurred_at: new Date().toISOString(),
    data: { transaction_id: txId, merchant_id: 'm_001', amount: '10.00', currency: 'ARS' }
  };
});
const r3 = await Promise.all(evs3.map(ev => {
  const ts = Math.floor(Date.now()/1000);
  const rawBody = JSON.stringify(ev);
  return fetch(`${BASE}/webhooks/psp`, {
    method: 'POST',
    headers: {'content-type':'application/json','x-psp-timestamp':String(ts),'x-psp-signature':firmar(ts,rawBody)},
    body: rawBody
  }).then(r => r.status);
}));
const elapsed = Date.now() - start;
console.log(`\n100 webhooks concurrentes: ${r3.filter(s=>s===200).length}/100 OK en ${elapsed}ms (${(100/elapsed*1000).toFixed(1)} req/s)`);

console.log('\n' + '='.repeat(60));
console.log('COMPLETADO');
