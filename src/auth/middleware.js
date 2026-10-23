import { hashApiKey } from './apiKey.js';

// Middleware reusable para autenticar comercios por header x-api-key
export function crearAutenticadorComercio(pool) {
  return async function autenticarComercio(req, reply) {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Falta header x-api-key' });
    }

    const hash = hashApiKey(apiKey);
    const { rows } = await pool.query(
      'SELECT id, name, commission_bps FROM merchants WHERE api_key_hash = $1',
      [hash],
    );

    if (rows.length === 0) {
      return reply.code(401).send({ error: 'unauthorized', message: 'API key inválida' });
    }

    req.merchant = rows[0];
  };
}
