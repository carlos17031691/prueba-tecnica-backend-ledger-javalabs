import pg from 'pg';

// Pool de conexiones a Postgres. Los BIGINT (centavos) llegan como string y se convierten
// a BigInt de forma explícita donde hace falta: nunca pasan por Number.
export function crearPool({ databaseUrl, max, applicationName }) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max,
    application_name: applicationName,
    // Si el pool está agotado, una request espera conexión en vez de fallar enseguida.
    connectionTimeoutMillis: 20_000,
    idleTimeoutMillis: 30_000,
  });
  return pool;
}

// Ejecuta fn dentro de una transacción. Si fn tira, se hace ROLLBACK y no queda nada a medias.
export async function enTransaccion(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
