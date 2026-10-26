import { createHmac } from 'node:crypto';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const SECRET = process.env.WEBHOOK_SECRET || '';
const API_KEY = process.env.MERCHANT_API_KEY || '';

function firmar(ts, body, secret = SECRET) {
  return `v1=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`;
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

console.log('TEST 7000 COMPLETO - SIGUIENDO ESPECIFICACIÓN');
console.log('='.repeat(70));

const batch = [];
const now = Date.now();
const tsActual = Math.floor(Date.now()/1000);

// 4000: created + approved de 2000 transacciones
for (let i = 0; i < 2000; i++) {
  const txId = `tx_spec_${now}_a_${i}`;
  batch.push({ kind: 'valid', tipo: 'created', ev: { event_id: `evt_${txId}_c`, type: 'payment.created', occurred_at: new Date().toISOString(), data: { transaction_id: txId, merchant_id: 'm_001', amount: fmt(15000 + i), currency: 'ARS' } } });
  batch.push({ kind: 'valid', tipo: 'approved', ev: { event_id: `evt_${txId}_a`, type: 'payment.approved', occurred_at: new Date().toISOString(), data: { transaction_id: txId, merchant_id: 'm_001', amount: fmt(15000 + i), currency: 'ARS' } } });
}

// 1000: approved duplicados (mismo event_id)
const dupEvId = `evt_dup_spec_${now}`;
const dupEv = { event_id: dupEvId, type: 'payment.approved', occurred_at: new Date().toISOString(), data: { transaction_id: `tx_dup_${now}`, merchant_id: 'm_001', amount: '100.00', currency: 'ARS' } };
for (let i = 0; i < 1000; i++) batch.push({ kind: 'dup', ev: dupEv });

// 1500: created + approved + reversed de 500 transacciones
for (let i = 0; i < 500; i++) {
  const txId = `tx_spec_${now}_b_${i}`;
  batch.push({ kind: 'valid', ev: { event_id: `evt_${txId}_c`, type: 'payment.created', occurred_at: new Date().toISOString(), data: { transaction_id: txId, merchant_id: 'm_001', amount: fmt(20000), currency: 'ARS' } } });
  batch.push({ kind: 'valid', ev: { event_id: `evt_${txId}_a`, type: 'payment.approved', occurred_at: new Date().toISOString(), data: { transaction_id: txId, merchant_id: 'm_001', amount: fmt(20000), currency: 'ARS' } } });
  batch.push({ kind: 'valid', ev: { event_id: `evt_${txId}_r`, type: 'payment.reversed', occurred_at: new Date().toISOString(), data: { transaction_id: txId, merchant_id: 'm_001', amount: fmt(20000), currency: 'ARS' } } });
}

// 300: approved con el monto alterado después de firmar
for (let i = 0; i < 300; i++) {
  const evOriginal = { event_id: `evt_tamper_${now}_${i}`, type: 'payment.approved', occurred_at: new Date().toISOString(), data: { transaction_id: `tx_tamper_${now}_${i}`, merchant_id: 'm_001', amount: '100.00', currency: 'ARS' } };
  const rawOriginal = JSON.stringify(evOriginal);
  batch.push({ kind: 'tamper', rawOriginal, evTampered: { ...evOriginal, data: { ...evOriginal.data, amount: '999.99' } } });
}

// 200: created con timestamp de hace 10 minutos
for (let i = 0; i < 200; i++) {
  const ev = { event_id: `evt_old_${now}_${i}`, type: 'payment.created', occurred_at: new Date().toISOString(), data: { transaction_id: `tx_old_${now}_${i}`, merchant_id: 'm_001', amount: '50.00', currency: 'ARS' } };
  batch.push({ kind: 'oldts', ev, ts: Math.floor(Date.now()/1000) - 600 });
}

for (let i = batch.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [batch[i], batch[j]] = [batch[j], batch[i]];
}

console.log(`Total: ${batch.length} requests`);
const start = Date.now();
const latencias = [];
const porStatus = {};
let idx = 0;
const concurrency = 7000;
const chunkSize = 7000;
const results = [];
for (let c = 0; c < Math.ceil(batch.length/chunkSize); c++) {
  const chunk = batch.slice(c*chunkSize, (c+1)*chunkSize);
  const resChunk = await Promise.all(chunk.map(async item => {
    const t0 = Date.now();
    try {
      if (item.kind === 'tamper') {
        const ts = tsActual;
        const rawTampered = JSON.stringify(item.evTampered);
        const sig = firmar(ts, item.rawOriginal);
        const res = await fetch(`${BASE}/webhooks/psp`, {
          method: 'POST',
          headers: {'content-type':'application/json','x-psp-timestamp':String(ts),'x-psp-signature':sig},
          body: rawTampered
        });
        latencias.push(Date.now()-t0);
        porStatus[res.status] = (porStatus[res.status]||0)+1;
        return res.status;
      } else if (item.kind === 'oldts') {
        const ts = item.ts;
        const rawBody = JSON.stringify(item.ev);
        const sig = firmar(ts, rawBody);
        const res = await fetch(`${BASE}/webhooks/psp`, {
          method: 'POST',
          headers: {'content-type':'application/json','x-psp-timestamp':String(ts),'x-psp-signature':sig},
          body: rawBody
        });
        latencias.push(Date.now()-t0);
        porStatus[res.status] = (porStatus[res.status]||0)+1;
        return res.status;
      } else {
        const ts = tsActual;
        const rawBody = JSON.stringify(item.ev);
        const sig = firmar(ts, rawBody);
        const res = await fetch(`${BASE}/webhooks/psp`, {
          method: 'POST',
          headers: {'content-type':'application/json','x-psp-timestamp':String(ts),'x-psp-signature':sig},
          body: rawBody
        });
        latencias.push(Date.now()-t0);
        porStatus[res.status] = (porStatus[res.status]||0)+1;
        return res.status;
      }
    } catch(e) {
      latencias.push(Date.now()-t0);
      porStatus[0] = (porStatus[0]||0)+1;
      return 0;
    }
  }));
  results.push(...resChunk);
}
const elapsed = Date.now() - start;

console.log(`\nConcurrencia ${batch.length}`);
console.log(`Respuestas por status:`, porStatus);
console.log(`Duración ${(elapsed/1000).toFixed(1)}s, ${(batch.length/elapsed*1000).toFixed(0)} req/s`);
console.log(`Latencia p50 ${p(latencias,0.5).toFixed(0)} ms, p95 ${p(latencias,0.95).toFixed(0)} ms, p99 ${p(latencias,0.99).toFixed(0)} ms`);
console.log(`Sin 5xx: ${(porStatus[500]||0)+(porStatus[502]||0)+(porStatus[503]||0) === 0 ? 'OK' : 'FAIL'}`);
console.log(`Sin errores red: ${(porStatus[0]||0) === 0 ? 'OK' : 'FAIL'}`);
console.log('='.repeat(70));
