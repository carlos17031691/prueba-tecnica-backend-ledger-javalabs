import { createHash } from 'node:crypto';
import Ajv from 'ajv';
import { TIPOS_EVENTO } from '../domain/stateMachine.js';
import { parsearMonto } from '../domain/money.js';

// Validación estricta del payload del PSP. Se aplica recién después de verificar la firma.
const ID = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,128}$' };

const esquema = {
  type: 'object',
  additionalProperties: false,
  required: ['event_id', 'type', 'occurred_at', 'data'],
  properties: {
    event_id: ID,
    type: { type: 'string', enum: TIPOS_EVENTO },
    occurred_at: {
      type: 'string',
      pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?(Z|[+-]\\d{2}:\\d{2})$',
    },
    data: {
      type: 'object',
      additionalProperties: false,
      required: ['transaction_id', 'merchant_id', 'amount', 'currency'],
      properties: {
        transaction_id: ID,
        merchant_id: ID,
        amount: { type: 'string', pattern: '^(0|[1-9]\\d{0,14})\\.\\d{2}$' },
        currency: { type: 'string', pattern: '^[A-Z]{3}$' },
      },
    },
  },
};

const ajv = new Ajv({ allErrors: true, strict: true });
const validarEsquema = ajv.compile(esquema);

// Devuelve { ok: true, evento } con el evento normalizado o { ok: false, errores }.
export function validarPayload(payload) {
  if (!validarEsquema(payload)) {
    return {
      ok: false,
      errores: validarEsquema.errors.map((e) => `${e.instancePath || '/'} ${e.message}`),
    };
  }

  const occurredAt = new Date(payload.occurred_at);
  if (Number.isNaN(occurredAt.getTime())) {
    return { ok: false, errores: ['/occurred_at no es una fecha válida'] };
  }

  const amountCents = parsearMonto(payload.data.amount);
  if (amountCents <= 0n) {
    return { ok: false, errores: ['/data/amount tiene que ser mayor a cero'] };
  }

  const evento = {
    event_id: payload.event_id,
    type: payload.type,
    occurred_at: occurredAt.toISOString(),
    transaction_id: payload.data.transaction_id,
    merchant_id: payload.data.merchant_id,
    amount_cents: amountCents,
    currency: payload.data.currency,
  };
  return { ok: true, evento };
}

// Hash del contenido normalizado (no del body crudo, que puede cambiar de formato entre reintentos).
// Sirve para detectar un event_id repetido que llega con datos distintos.
export function hashEvento(evento) {
  const canonico = [
    evento.event_id,
    evento.type,
    evento.occurred_at,
    evento.transaction_id,
    evento.merchant_id,
    evento.amount_cents.toString(),
    evento.currency,
  ].join('|');
  return createHash('sha256').update(canonico).digest('hex');
}
