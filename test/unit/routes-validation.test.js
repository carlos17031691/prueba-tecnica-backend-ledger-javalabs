import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { formatearMonto, parsearMonto } from '../../src/domain/money.js';

describe('formatearMonto edge cases', () => {
  test('formatea cero', () => {
    assert.equal(formatearMonto(0n), '0.00');
    assert.equal(formatearMonto(0), '0.00');
  });

  test('formatea montos grandes', () => {
    assert.equal(formatearMonto(123456789012n), '1234567890.12');
  });

  test('formatea negativo', () => {
    assert.equal(formatearMonto(-5000n), '-50.00');
  });
});

describe('parsearMonto validaciones', () => {
  test('rechaza formatos inválidos', () => {
    const invalidos = ['', 'abc', '10', '10.0', '10.000', '01.00', '.99', '1,00', '10.'];
    for (const v of invalidos) {
      assert.throws(() => parsearMonto(v));
    }
  });

  test('parsea correctamente', () => {
    assert.equal(parsearMonto('0.00'), 0n);
    assert.equal(parsearMonto('999.99'), 99999n);
    assert.equal(parsearMonto('1.00'), 100n);
  });
});
