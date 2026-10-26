// Harness compartido por las suites que necesitan app + Postgres real.
// Evita repetir en cada archivo el pool, la app, el comercio sembrado y la firma de webhooks.
import { createHmac } from 'node:crypto';
import { crearApp } from '../src/app.js';
import { crearPool } from '../src/db/pool.js';
import { cargarEnv } from '../src/config.js';

cargarEnv();

export const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ledger';

export function firmar(webhookSecret, ts, body) {
  return `v1=${createHmac('sha256', webhookSecret).update(`${ts}.${body}`).digest('hex')}`;
}

export async function crearHarness({ applicationName, merchantId, merchantName, apiKey, webhookSecret, max = 10 }) {
  const pool = crearPool({ databaseUrl: DATABASE_URL, max, applicationName });
  const app = crearApp({
    config: {
      port: 0,
      host: '127.0.0.1',
      logLevel: 'silent',
      databaseUrl: DATABASE_URL,
      webhookSecret,
      webhookToleranciaSeg: 300,
      adminToken: 'test-admin',
    },
    pool,
    logger: false,
  });
  await app.ready();

  const { hashApiKey } = await import('../src/auth/apiKey.js');
  await pool.query(
    `INSERT INTO merchants (id, name, api_key_hash, commission_bps)
     VALUES ($1, $2, $3, 250)
     ON CONFLICT (id) DO UPDATE
       SET api_key_hash = EXCLUDED.api_key_hash, commission_bps = EXCLUDED.commission_bps`,
    [merchantId, merchantName, hashApiKey(apiKey)],
  );

  async function enviarWebhook(evento) {
    const ts = Math.floor(Date.now() / 1000);
    const rawBody = JSON.stringify(evento);
    return app.inject({
      method: 'POST',
      url: '/webhooks/psp',
      headers: {
        'content-type': 'application/json',
        'x-psp-timestamp': String(ts),
        'x-psp-signature': firmar(webhookSecret, ts, rawBody),
      },
      payload: Buffer.from(rawBody),
    });
  }

  async function cerrar() {
    await app.close();
    await pool.end();
  }

  return { pool, app, enviarWebhook, cerrar };
}
