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

function p(arr, q) {
  const s = [...arr].sort((a,b)=>a-b);
  const pos = (s.length-1)*q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (s[base+1] !== undefined) return s[base] + rest*(s[base+1]-s[base]);
  return s[base];
}

console.log('ULTRA STRESS TEST');
console.log('='.repeat(70));

const batch = [];
const runId = Math.random().toString(36).substr(2,8);

for (let i = 0; i < 3000; i++) {
  const txId = `tx_ultra_${runId}_${i}`;
  batch.push({ event_id: `evt_u_c_${txId}`, type: 'payment.created', occurred_at: new Date().toISOString(), data: { transaction_id: txId, merchant_id: 'm_001', amount: fmt(10000 + (i%5000)), currency: 'ARS' } });
  batch.push({ event_id: `evt_u_a_${txId}`, type: 'payment.approved', occurred_at: new Date().toISOString(), data: { transaction_id: txId, merchant_id: 'm_001', amount: fmt(10000 + (i%5000)), currency: 'ARS' } });
}
for (let i = 0; i < 500; i++) {
  const txId = `tx_ultra_r_${runId}_${i}`;
  batch.push({ event_id: `evt_u_c_${txId}`, type: 'payment.created', occurred_at: new Date().toISOString(), data: { transaction_id: txId, merchant_id: 'm_001', amount: fmt(20000), currency: 'ARS' } });
  batch.push({ event_id: `evt_u_a_${txId}`, type: 'payment.approved', occurred_at: new Date().toISOString(), data: { transaction_id: txId, merchant_id: 'm_001', amount: fmt(20000), currency: 'ARS' } });
  batch.push({ event_id: `evt_u_r_${txId}`, type: 'payment.reversed', occurred_at: new Date().toISOString(), data: { transaction_id: txId, merchant_id: 'm_001', amount: fmt(20000), currency: 'ARS' } });
}

const start = Date.now();
const latencias = [];
const statuses = [];
const results = await Promise.all(batch.map(async ev => {
  const t0 = Date.now();
  const ts = Math.floor(Date.now()/1000);
  const rawBody = JSON.stringify(ev);
  try {
    const res = await fetch(`${BASE}/webhooks/psp`, {
      method: 'POST',
      headers: {'content-type':'application/json','x-psp-timestamp':String(ts),'x-psp-signature':firmar(ts,rawBody)},
      body: rawBody
    });
    latencias.push(Date.now()-t0);
    statuses.push(res.status);
    return res.status;
  } catch(e) {
    latencias.push(Date.now()-t0);
    statuses.push(0);
    return 0;
  }
}));
const elapsed = Date.now() - start;

console.log(`Requests: ${batch.length}, Concurrencia: ${batch.length}`);
console.log(`Duración: ${(elapsed/1000).toFixed(1)}s, ${(batch.length/elapsed*1000).toFixed(1)} req/s`);
console.log(`Respuestas:`, Object.entries(statuses.reduce((a,s)=>{a[s]=(a[s]||0)+1;return a;},{})).map(([k,v])=>`${k}:${v}`).join(' '));
console.log(`Latencia p50: ${p(latencias,0.5).toFixed(0)}ms, p95: ${p(latencias,0.95).toFixed(0)}ms, p99: ${p(latencias,0.99).toFixed(0)}ms, max: ${Math.max(...latencias)}ms`);
console.log(`Errores red/timeouts: ${statuses.filter(s=>s===0).length}`);
console.log(`Sin 5xx: ${statuses.filter(s=>s>=500).length === 0 ? 'OK' : 'FAIL'}`);
console.log('='.repeat(70));
