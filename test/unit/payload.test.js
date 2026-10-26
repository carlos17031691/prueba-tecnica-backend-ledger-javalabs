import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { hashEvento, validarPayload } from '../../src/webhooks/payload.js';

// Factory para no repetir el mismo payload de 10 líneas en cada caso.
const payload = ({ event_id = 'evt_123', type = 'payment.created', occurred_at = '2026-10-23T14:05:11Z', data = {}, ...extra } = {}) => ({
  event_id,
  type,
  occurred_at,
  ...extra,
  data: {
    transaction_id: 'tx_123',
    merchant_id: 'm_001',
    amount: '100.00',
    currency: 'ARS',
    ...data,
  },
});

const eventoNormalizado = (extra = {}) => ({
  event_id: 'evt_1',
  type: 'payment.approved',
  occurred_at: '2026-10-23T14:05:11Z',
  transaction_id: 'tx_1',
  merchant_id: 'm_001',
  amount_cents: 1500000n,
  currency: 'ARS',
  ...extra,
});

describe('validarPayload', () => {
  test('payload válido ARS retorna evento normalizado', () => {
    const res = validarPayload(
      payload({
        type: 'payment.approved',
        data: { transaction_id: 'tx_456', amount: '15000.00' },
      }),
    );
    assert.equal(res.ok, true);
    assert.equal(res.evento.event_id, 'evt_123');
    assert.equal(res.evento.type, 'payment.approved');
    assert.equal(res.evento.transaction_id, 'tx_456');
    assert.equal(res.evento.merchant_id, 'm_001');
    assert.equal(res.evento.currency, 'ARS');
    assert.equal(res.evento.amount_cents, 1500000n);
    assert.equal(typeof res.evento.occurred_at, 'string');
  });

  test('rechaza additionalProperties', () => {
    const res = validarPayload(payload({ extra: true }));
    assert.equal(res.ok, false);
    assert.ok(Array.isArray(res.errores));
  });

  test('rechaza tipo de evento inválido', () => {
    assert.equal(validarPayload(payload({ type: 'payment.captured' })).ok, false);
  });

  test('rechaza amount con formato incorrecto', () => {
    for (const amount of ['100', '100.0', '100.000', '01.00', '.50', '100,00']) {
      const res = validarPayload(payload({ event_id: `evt_${amount}`, data: { amount } }));
      assert.equal(res.ok, false, `debería rechazar ${amount}`);
    }
  });

  test('rechaza amount 0.00', () => {
    assert.equal(validarPayload(payload({ event_id: 'evt_zero', data: { transaction_id: 'tx_zero', amount: '0.00' } })).ok, false);
  });

  test('rechaza currency con formato incorrecto', () => {
    assert.equal(validarPayload(payload({ event_id: 'evt_cur', data: { transaction_id: 'tx_cur', currency: 'usd' } })).ok, false);
  });

  test('rechaza occurred_at inválido', () => {
    assert.equal(validarPayload(payload({ event_id: 'evt_date', occurred_at: '2026/10/23 14:05:11' })).ok, false);
  });

  test('acepta occurred_at con fracción de segundos', () => {
    assert.equal(validarPayload(payload({ event_id: 'evt_frac', occurred_at: '2026-10-23T14:05:11.123456Z' })).ok, true);
  });
});

describe('hashEvento', () => {
  test('genera hash consistente', () => {
    const evento = eventoNormalizado();
    const h1 = hashEvento(evento);
    assert.equal(h1, hashEvento(evento));
    assert.equal(h1.length, 64);
  });

  test('hash cambia si cambia algún campo', () => {
    const hBase = hashEvento(eventoNormalizado());
    assert.notEqual(hBase, hashEvento(eventoNormalizado({ amount_cents: 1500001n })));
    assert.notEqual(hBase, hashEvento(eventoNormalizado({ type: 'payment.rejected' })));
  });
});
