import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { decidir } from '../../src/domain/stateMachine.js';

const tx = (status, extra = {}) => ({
  status,
  merchant_id: 'm_001',
  amount_cents: '1500000',
  currency: 'ARS',
  ...extra,
});

const ev = (type, extra = {}) => ({
  type,
  merchant_id: 'm_001',
  amount_cents: 1500000n,
  currency: 'ARS',
  ...extra,
});

describe('transiciones válidas', () => {
  test('created sobre transacción inexistente la crea en pending', () => {
    assert.deepEqual(decidir(null, ev('payment.created')), { accion: 'crear', nuevoEstado: 'pending' });
  });

  test('pending → approved acredita', () => {
    assert.deepEqual(decidir(tx('pending'), ev('payment.approved')), {
      accion: 'transicionar',
      nuevoEstado: 'approved',
      efecto: 'acreditar',
    });
  });

  test('pending → rejected no mueve saldo', () => {
    assert.deepEqual(decidir(tx('pending'), ev('payment.rejected')), {
      accion: 'transicionar',
      nuevoEstado: 'rejected',
      efecto: null,
    });
  });

  test('approved → reversed debita', () => {
    assert.deepEqual(decidir(tx('approved'), ev('payment.reversed')), {
      accion: 'transicionar',
      nuevoEstado: 'reversed',
      efecto: 'debitar',
    });
  });
});

describe('eventos fuera de orden se difieren', () => {
  for (const tipo of ['payment.approved', 'payment.rejected', 'payment.reversed']) {
    test(`${tipo} antes del created`, () => {
      assert.equal(decidir(null, ev(tipo)).accion, 'diferir');
    });
  }

  test('reversed sobre pending espera al approved', () => {
    assert.equal(decidir(tx('pending'), ev('payment.reversed')).accion, 'diferir');
  });
});

describe('transiciones inválidas', () => {
  const casos = [
    ['pending', 'payment.created'],
    ['approved', 'payment.created'],
    ['approved', 'payment.approved'],
    ['approved', 'payment.rejected'],
    ['rejected', 'payment.approved'],
    ['rejected', 'payment.rejected'],
    ['rejected', 'payment.reversed'],
    ['reversed', 'payment.approved'],
    ['reversed', 'payment.rejected'],
    ['reversed', 'payment.reversed'],
  ];
  for (const [estado, tipo] of casos) {
    test(`${estado} + ${tipo}`, () => {
      const decision = decidir(tx(estado), ev(tipo));
      assert.equal(decision.accion, 'invalido');
      assert.ok(decision.motivo);
    });
  }

  test('tipo de evento desconocido', () => {
    assert.deepEqual(decidir(tx('pending'), ev('payment.refunded')), {
      accion: 'invalido',
      motivo: 'unknown_event_type',
    });
  });
});

describe('consistencia del evento con la transacción', () => {
  test('monto distinto al del created', () => {
    const decision = decidir(tx('pending'), ev('payment.approved', { amount_cents: 9500000n }));
    assert.deepEqual(decision, { accion: 'invalido', motivo: 'amount_mismatch' });
  });

  test('otro comercio', () => {
    const decision = decidir(tx('pending'), ev('payment.approved', { merchant_id: 'm_002' }));
    assert.deepEqual(decision, { accion: 'invalido', motivo: 'merchant_mismatch' });
  });

  test('otra moneda', () => {
    const decision = decidir(tx('pending'), ev('payment.approved', { currency: 'USD' }));
    assert.deepEqual(decision, { accion: 'invalido', motivo: 'currency_mismatch' });
  });
});

describe('moneda distinta de ARS', () => {
  test('cambia de estado pero no genera movimiento', () => {
    const usd = { currency: 'USD' };
    assert.deepEqual(decidir(tx('pending', usd), ev('payment.approved', usd)), {
      accion: 'transicionar',
      nuevoEstado: 'approved',
      efecto: null,
    });
    assert.deepEqual(decidir(tx('approved', usd), ev('payment.reversed', usd)), {
      accion: 'transicionar',
      nuevoEstado: 'reversed',
      efecto: null,
    });
  });
});
