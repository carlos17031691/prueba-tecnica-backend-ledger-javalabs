import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { hashEvento, validarPayload } from '../../src/webhooks/payload.js';

describe('validarPayload', () => {
  test('payload válido ARS retorna evento normalizado', () => {
    const payload = {
      event_id: 'evt_123',
      type: 'payment.approved',
      occurred_at: '2026-10-23T14:05:11Z',
      data: {
        transaction_id: 'tx_123',
        merchant_id: 'm_001',
        amount: '15000.00',
        currency: 'ARS',
      },
    };
    const res = validarPayload(payload);
    assert.equal(res.ok, true);
    assert.equal(res.evento.event_id, 'evt_123');
    assert.equal(res.evento.type, 'payment.approved');
    assert.equal(res.evento.transaction_id, 'tx_123');
    assert.equal(res.evento.merchant_id, 'm_001');
    assert.equal(res.evento.currency, 'ARS');
    assert.equal(res.evento.amount_cents, 1500000n);
    assert.equal(typeof res.evento.occurred_at, 'string');
  });

  test('rechaza additionalProperties', () => {
    const payload = {
      event_id: 'evt_123',
      type: 'payment.created',
      occurred_at: '2026-10-23T14:05:11Z',
      extra: true,
      data: {
        transaction_id: 'tx_123',
        merchant_id: 'm_001',
        amount: '100.00',
        currency: 'ARS',
      },
    };
    const res = validarPayload(payload);
    assert.equal(res.ok, false);
    assert.ok(Array.isArray(res.errores));
  });

  test('rechaza tipo de evento inválido', () => {
    const payload = {
      event_id: 'evt_123',
      type: 'payment.captured',
      occurred_at: '2026-10-23T14:05:11Z',
      data: {
        transaction_id: 'tx_123',
        merchant_id: 'm_001',
        amount: '100.00',
        currency: 'ARS',
      },
    };
    const res = validarPayload(payload);
    assert.equal(res.ok, false);
  });

  test('rechaza amount con formato incorrecto', () => {
    const casos = ['100', '100.0', '100.000', '01.00', '.50', '100,00'];
    for (const amount of casos) {
      const payload = {
        event_id: `evt_${amount}`,
        type: 'payment.created',
        occurred_at: '2026-10-23T14:05:11Z',
        data: {
          transaction_id: 'tx_123',
          merchant_id: 'm_001',
          amount,
          currency: 'ARS',
        },
      };
      const res = validarPayload(payload);
      assert.equal(res.ok, false, `debería rechazar ${amount}`);
    }
  });

  test('rechaza amount 0.00', () => {
    const payload = {
      event_id: 'evt_zero',
      type: 'payment.created',
      occurred_at: '2026-10-23T14:05:11Z',
      data: {
        transaction_id: 'tx_zero',
        merchant_id: 'm_001',
        amount: '0.00',
        currency: 'ARS',
      },
    };
    const res = validarPayload(payload);
    assert.equal(res.ok, false);
  });

  test('rechaza currency con formato incorrecto', () => {
    const payload = {
      event_id: 'evt_cur',
      type: 'payment.created',
      occurred_at: '2026-10-23T14:05:11Z',
      data: {
        transaction_id: 'tx_cur',
        merchant_id: 'm_001',
        amount: '100.00',
        currency: 'usd',
      },
    };
    const res = validarPayload(payload);
    assert.equal(res.ok, false);
  });

  test('rechaza occurred_at inválido', () => {
    const payload = {
      event_id: 'evt_date',
      type: 'payment.created',
      occurred_at: '2026/10/23 14:05:11',
      data: {
        transaction_id: 'tx_date',
        merchant_id: 'm_001',
        amount: '100.00',
        currency: 'ARS',
      },
    };
    const res = validarPayload(payload);
    assert.equal(res.ok, false);
  });

  test('acepta occurred_at con fracción de segundos', () => {
    const payload = {
      event_id: 'evt_frac',
      type: 'payment.created',
      occurred_at: '2026-10-23T14:05:11.123456Z',
      data: {
        transaction_id: 'tx_frac',
        merchant_id: 'm_001',
        amount: '100.00',
        currency: 'ARS',
      },
    };
    const res = validarPayload(payload);
    assert.equal(res.ok, true);
  });
});

describe('hashEvento', () => {
  test('genera hash consistente', () => {
    const evento = {
      event_id: 'evt_1',
      type: 'payment.approved',
      occurred_at: '2026-10-23T14:05:11Z',
      transaction_id: 'tx_1',
      merchant_id: 'm_001',
      amount_cents: 1500000n,
      currency: 'ARS',
    };
    const h1 = hashEvento(evento);
    const h2 = hashEvento(evento);
    assert.equal(h1, h2);
    assert.equal(h1.length, 64);
  });

  test('hash cambia si cambia algún campo', () => {
    const base = {
      event_id: 'evt_1',
      type: 'payment.approved',
      occurred_at: '2026-10-23T14:05:11Z',
      transaction_id: 'tx_1',
      merchant_id: 'm_001',
      amount_cents: 1500000n,
      currency: 'ARS',
    };
    const hBase = hashEvento(base);
    assert.notEqual(hBase, hashEvento({ ...base, amount_cents: 1500001n }));
    assert.notEqual(hBase, hashEvento({ ...base, type: 'payment.rejected' }));
  });
});
