// Runner de migraciones versionadas.
// Aplica en orden los archivos migrations/NNN_nombre.sql que todavía no figuran en schema_migrations.
// Cada archivo corre en su propia transacción y un advisory lock evita que dos procesos migren a la vez.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { cargarEnv } from '../config.js';

const DIR_MIGRACIONES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');
const LOCK_MIGRACIONES = 727_001; // número arbitrario, solo identifica el lock

export async function migrar(databaseUrl, log = console) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_MIGRACIONES]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query('SELECT version FROM schema_migrations');
    const aplicadas = new Set(rows.map((r) => r.version));
    const archivos = (await readdir(DIR_MIGRACIONES)).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();

    for (const archivo of archivos) {
      if (aplicadas.has(archivo)) continue;
      const sql = await readFile(join(DIR_MIGRACIONES, archivo), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [archivo]);
        await client.query('COMMIT');
        log.info(`migración aplicada: ${archivo}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Falló la migración ${archivo}: ${err.message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_MIGRACIONES]).catch(() => {});
    await client.end();
  }
}

// Uso por línea de comandos: node src/db/migrate.js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cargarEnv();
  if (!process.env.DATABASE_URL) {
    console.error('Falta DATABASE_URL');
    process.exit(1);
  }
  migrar(process.env.DATABASE_URL)
    .then(() => console.info('migraciones al día'))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
