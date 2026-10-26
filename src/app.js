import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { rutasWebhooks } from './webhooks/routes.js';
import { rutasConsultas } from './routes/queries.js';
import { rutasPayouts } from './routes/payouts.js';
import { rutasOperacion } from './routes/observability.js';

// Arma la aplicación Fastify. Se separa de server.js para poder levantarla en los tests.
export function crearApp({ config, pool, logger = true }) {
  const app = Fastify({
    logger: logger ? { level: config.logLevel, redact: ['req.headers["x-api-key"]', 'req.headers["x-psp-signature"]', 'req.headers["x-admin-token"]'] } : false,
    // correlation_id: se respeta el que mande el cliente o se genera uno.
    genReqId: (req) => req.headers['x-correlation-id'] ?? randomUUID(),
    requestIdHeader: false,
    // Los webhooks son chicos; se corta cualquier body desproporcionado.
    bodyLimit: 64 * 1024,
    // Con miles de conexiones simultáneas no conviene cerrar los sockets keep-alive enseguida.
    keepAliveTimeout: 65_000,
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-correlation-id', req.id);
  });

  // Manejador centralizado de errores para evitar filtrar detalles internos de DB en status 500
  app.setErrorHandler((error, req, reply) => {
    if (req.log && typeof req.log.error === 'function') {
      req.log.error(error);
    }
    const status = error.statusCode && error.statusCode >= 400 && error.statusCode < 500
      ? error.statusCode
      : (error.validation ? 400 : 500);

    if (status === 500) {
      return reply.code(500).send({
        error: 'internal_server_error',
        message: 'Error interno del servidor',
      });
    }

    return reply.code(status).send({
      error: error.code || 'bad_request',
      message: error.message,
    });
  });

  app.register(rutasWebhooks, { config, pool });
  app.register(rutasConsultas, { pool });
  app.register(rutasPayouts, { pool });
  app.register(rutasOperacion, { config, pool });
  return app;
}
