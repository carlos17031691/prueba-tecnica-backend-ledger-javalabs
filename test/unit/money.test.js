import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { calcularComision, formatearMonto, parsearMonto } from '../../src/domain/money.js';

describe('parsearMonto', () => {
  test('convierte el string del PSP a centavos BigInt', () => {
    assert.equal(parsearMonto('15000.00'), 1500000n);
    assert.equal(parsearMonto('999.99'), 99999n);
    assert.equal(parsearMonto('0.01'), 1n);
    assert.equal(parsearMonto('0.00'), 0n);
    assert.equal(parsearMonto('1.00'), 100n);
  });

  test('no pierde precisión con montos grandes', () => {
    assert.equal(parsearMonto('123456789012345.67'), 12345678901234567n);
  });

  test('rechaza formatos que no son exactamente 2 decimales', () => {
    for (const malo of ['15000', '15000.0', '15000.000', '1e3', '-10.00', '01.00', ' 1.00', '1,00', '', null, 15000]) {
      assert.throws(() => parsearMonto(malo), /Monto inválido/, `debería rechazar ${malo}`);
    }
  });
});

describe('formatearMonto', () => {
  test('siempre con 2 decimales', () => {
    assert.equal(formatearMonto(1560000n), '15600.00');
    assert.equal(formatearMonto(97500n), '975.00');
    assert.equal(formatearMonto(5n), '0.05');
    assert.equal(formatearMonto(0n), '0.00');
    assert.equal(formatearMonto(0), '0.00');
    assert.equal(formatearMonto(123456789012n), '1234567890.12');
  });

  test('montos negativos', () => {
    assert.equal(formatearMonto(-97500n), '-975.00');
    assert.equal(formatearMonto(-5n), '-0.05');
  });

  test('acepta el string que devuelve Postgres para BIGINT/NUMERIC', () => {
    assert.equal(formatearMonto('1560000'), '15600.00');
  });
});

describe('calcularComision', () => {
  test('2,5 % de 999,99 es 24,99 (se trunca, no se redondea a 25,00)', () => {
    const { comision, neto } = calcularComision(parsearMonto('999.99'), 250);
    assert.equal(formatearMonto(comision), '24.99');
    assert.equal(formatearMonto(neto), '975.00');
  });

  test('2,5 % de 15.000,00 es 375,00 y el neto 14.625,00', () => {
    const { comision, neto } = calcularComision(parsearMonto('15000.00'), 250);
    assert.equal(formatearMonto(comision), '375.00');
    assert.equal(formatearMonto(neto), '14625.00');
  });

  test('montos chicos: la comisión truncada puede ser cero', () => {
    assert.deepEqual(calcularComision(1n, 250), { bruto: 1n, comision: 0n, neto: 1n });
    assert.deepEqual(calcularComision(39n, 250), { bruto: 39n, comision: 0n, neto: 39n });
    assert.deepEqual(calcularComision(40n, 250), { bruto: 40n, comision: 1n, neto: 39n });
  });

  test('bruto = comisión + neto para cualquier monto', () => {
    for (let c = 0n; c < 5000n; c += 7n) {
      const { comision, neto } = calcularComision(c, 250);
      assert.equal(comision + neto, c);
      // Nunca se cobra de más: comision <= bruto * 2,5 %
      assert.ok(comision * 10000n <= c * 250n);
    }
  });

  test('comisión 0 % y 100 %', () => {
    assert.equal(calcularComision(12345n, 0).neto, 12345n);
    assert.equal(calcularComision(12345n, 10000).neto, 0n);
  });

  test('rechaza comisiones fuera de rango', () => {
    assert.throws(() => calcularComision(100n, -1));
    assert.throws(() => calcularComision(100n, 10001));
  });
});
