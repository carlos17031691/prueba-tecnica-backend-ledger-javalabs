#!/usr/bin/env node
import { createHmac, randomUUID } from 'node:crypto';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const API_KEY = process.env.MERCHANT_API_KEY || 'mk_live_1024e44ca85909bb2478f9a8cc7cd18a';
const SECRET = process.env.WEBHOOK_SECRET || '98906661834c5d239fd55598d12f3ac75cd9aa088f3ca38ad3f90e256814c504';

const hdr = () => ({ 'x-api-key': API_KEY, 'content-type': 'application/json' });
const sign = (ts, body) => `v1=${createHmac('sha256', SECRET).update(ts + '.' + body).digest('hex')}`;

const j = async (res) => { try { return await res.json(); } catch { return await res.text(); } };

void (async () => {
  console.log('=== PAYOUT TEST B1 ===');
  
  // saldo inicial
  console.log('\n1) GET /merchants/me/balance');
  console.log(JSON.stringify(await j(await fetch(BASE + '/merchants/me/balance', { headers: hdr() }))));
  
  // acreditar
  const tx = 'txp_' + Date.now();
  const ts = () => String(Math.floor(Date.now()/1000));
  for (const t of ['created','approved']) {
    const ev = { event_id: 'ev_'+tx+'_'+t[0], type: 'payment.'+t, occurred_at: new Date().toISOString(), data: { transaction_id: tx, merchant_id: 'm_001', amount: '1000.00', currency: 'ARS' } };
    const body = JSON.stringify(ev);
    const r = await fetch(BASE + '/webhooks/psp', { method:'POST', headers:{'content-type':'application/json','x-psp-timestamp':ts(),'x-psp-signature':sign(ts(),body)}, body });
    console.log('webhook ' + String(t).replace(/[\r\n]/g,'') + ':', Number(r.status));
  }
  await new Promise(r=>setTimeout(r,3000));
  
  console.log('\n2) saldo tras acreditación');
  console.log(JSON.stringify(await j(await fetch(BASE + '/merchants/me/balance', { headers: hdr() }))));
  
  const key = 'pk_' + randomUUID();
  
  console.log('\n3) sin Idempotency-Key -> 400');
  console.log(Number((await fetch(BASE+'/payouts',{method:'POST',headers:hdr(),body:JSON.stringify({amount:'10.00'})})).status));
  
  console.log('4) key vacía -> 400');
  console.log(Number((await fetch(BASE+'/payouts',{method:'POST',headers:{...hdr(),'idempotency-key':''},body:JSON.stringify({amount:'10.00'})})).status));
  
  console.log('5) saldo insuficiente -> 422');
  console.log(Number((await fetch(BASE+'/payouts',{method:'POST',headers:{...hdr(),'idempotency-key':'x'},body:JSON.stringify({amount:'999999999.00'})})).status));
  
  console.log('\n6) payout 50.00 -> 201');
  let res = await fetch(BASE+'/payouts',{method:'POST',headers:{...hdr(),'idempotency-key':key},body:JSON.stringify({amount:'50.00'})});
  console.log(Number(res.status), JSON.stringify(String(await res.text()).replace(/\r?\n|\r/g,'')));
  
  console.log('\n7) replay mismo body -> 200');
  res = await fetch(BASE+'/payouts',{method:'POST',headers:{...hdr(),'idempotency-key':key},body:JSON.stringify({amount:'50.00'})});
  console.log(Number(res.status));
  
  console.log('8) mismo key body distinto -> 409');
  res = await fetch(BASE+'/payouts',{method:'POST',headers:{...hdr(),'idempotency-key':key},body:JSON.stringify({amount:'51.00'})});
  console.log(Number(res.status));
  
  console.log('\n9) saldo final');
  console.log(JSON.stringify(await j(await fetch(BASE + '/merchants/me/balance', { headers: hdr() }))));
  
  console.log('\n=== OK ===');
})().catch((e) => { console.error(String(e)); process.exit(1); });
