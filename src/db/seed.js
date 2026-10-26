// Seed del comercio de prueba. Idempotente: se puede correr en cada arranque.
// La API key sale de MERCHANT_API_KEY y se guarda hasheada.
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { hashApiKey } from '../auth/apiKey.js';
import { cargarEnv } from '../config.js';

export async function sembrar({ databaseUrl, merchantId, apiKey, commissionBps }, log = console) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO merchants (id, name, api_key_hash, commission_bps)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
         SET api_key_hash = EXCLUDED.api_key_hash,
             commission_bps = EXCLUDED.commission_bps`,
      [merchantId, `Comercio ${merchantId}`, hashApiKey(apiKey), commissionBps],
    );
    log.info(`comercio ${merchantId} sembrado (comisión ${commissionBps} bps)`);
  } finally {
    await client.end();
  }
}

// Uso por línea de comandos: node src/db/seed.js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cargarEnv();
  const { DATABASE_URL, MERCHANT_API_KEY } = process.env;
  if (!DATABASE_URL || !MERCHANT_API_KEY) {
    console.error('Faltan DATABASE_URL y/o MERCHANT_API_KEY');
    process.exit(1);
  }
  sembrar({
    databaseUrl: DATABASE_URL,
    merchantId: process.env.SEED_MERCHANT_ID ?? 'm_001',
    apiKey: MERCHANT_API_KEY,
    commissionBps: Number.parseInt(process.env.SEED_COMMISSION_BPS ?? '250', 10),
  }).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
