import { firmaValida, timestampValido } from './signature.js';
import { hashEvento, validarPayload } from './payload.js';

// POST /webhooks/psp
// Orden: timestamp -> firma -> JSON -> esquema -> INSERT idempotente en inbox_events -> 200.
// El saldo no se toca acá: lo aplica el worker de forma asíncrona.
export async function rutasWebhooks(app, { config, pool }) {
  // En este contexto el body llega como Buffer crudo: la firma se calcula sobre esos bytes exactos.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => {
    if (Buffer.isBuffer(body) && body.length > 64 * 1024) {
      const err = new Error('Payload too large');
      err.statusCode = 413;
      return done(err);
    }
    done(null, body);
  });

  app.post('/webhooks/psp', async (req, reply) => {
    const timestamp = req.headers['x-psp-timestamp'];
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (rawBody.length > 64 * 1024) {
      return reply.code(413).send({ error: 'payload_too_large' });
    }

    if (!timestampValido(timestamp, Math.floor(Date.now() / 1000), config.webhookToleranciaSeg)) {
      req.log.warn({ motivo: 'timestamp_fuera_de_ventana' }, 'webhook rechazado');
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const firmaOk = firmaValida({
      secretos: [config.webhookSecret],
      timestamp,
      header: req.headers['x-psp-signature'],
      rawBody,
    });
    if (!firmaOk) {
      req.log.warn({ motivo: 'firma_invalida' }, 'webhook rechazado');
      return reply.code(401).send({ error: 'unauthorized' });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return reply.code(400).send({ error: 'invalid_json' });
    }

    const validacion = validarPayload(payload);
    if (!validacion.ok) {
      req.log.warn({ errores: validacion.errores }, 'webhook con payload inválido');
      return reply.code(400).send({ error: 'invalid_payload', details: validacion.errores });
    }

    const evento = validacion.evento;
    const hash = hashEvento(evento);

    // La PK sobre event_id garantiza la idempotencia: un duplicado no inserta otra fila,
    // solo incrementa duplicate_count. (xmax = 0) es true cuando la fila se insertó recién.
    const { rows } = await pool.query(
      `INSERT INTO inbox_events
         (event_id, type, transaction_id, merchant_id, amount_cents, currency, occurred_at,
          payload, payload_hash, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (event_id) DO UPDATE
         SET duplicate_count = inbox_events.duplicate_count + 1
       RETURNING (xmax = 0) AS insertado, payload_hash`,
      [
        evento.event_id,
        evento.type,
        evento.transaction_id,
        evento.merchant_id,
        evento.amount_cents.toString(),
        evento.currency,
        evento.occurred_at,
        payload,
        hash,
        req.id ?? null,
      ],
    );

    const { insertado, payload_hash: hashGuardado } = rows[0];
    if (!insertado) {
      if (hashGuardado !== hash) {
        req.log.warn({ event_id: evento.event_id }, 'event_id duplicado con contenido distinto: se conserva el primero');
      } else {
        req.log.info({ event_id: evento.event_id }, 'evento duplicado');
      }
    }

    return reply.code(200).send({ received: true, duplicate: !insertado });
  });
}
