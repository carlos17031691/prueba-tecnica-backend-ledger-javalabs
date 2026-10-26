import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { calcularFirma, parsearHeaderFirma, firmaValida, timestampValido } from '../../src/webhooks/signature.js';

describe('parsearHeaderFirma', () => {
  test('parsea firma v1 simple', () => {
    const firmas = parsearHeaderFirma('v1=' + 'a'.repeat(64));
    assert.equal(firmas.length, 1);
    assert.equal(firmas[0].toString('hex'), 'a'.repeat(64));
  });

  test('parsea múltiples firmas separadas por coma', () => {
    const hex1 = 'a'.repeat(64);
    const hex2 = 'b'.repeat(64);
    const header = `v1=${hex1}, v1=${hex2}`;
    const firmas = parsearHeaderFirma(header);
    assert.equal(firmas.length, 2);
  });

  test('ignora versiones desconocidas', () => {
    const hex1 = 'a'.repeat(64);
    const header = `v2=${hex1}, v1=${'b'.repeat(64)}`;
    const firmas = parsearHeaderFirma(header);
    assert.equal(firmas.length, 1);
  });

  test('ignora header inválido o vacío', () => {
    assert.deepEqual(parsearHeaderFirma(''), []);
    assert.deepEqual(parsearHeaderFirma(null), []);
    assert.deepEqual(parsearHeaderFirma(undefined), []);
  });

  test('ignora firmas con formato incorrecto', () => {
    const header = `v1=abc123, v1=${'d'.repeat(32)}`;
    const firmas = parsearHeaderFirma(header);
    assert.equal(firmas.length, 0);
  });
});

describe('firmaValida', () => {
  test('acepta firma correcta con un secreto', () => {
    const secreto = 'mi-secreto';
    const timestamp = '1761220800';
    const rawBody = Buffer.from('{"test":true}');
    const firma = calcularFirma(secreto, timestamp, rawBody).toString('hex');
    const ok = firmaValida({ secretos: [secreto], timestamp, header: `v1=${firma}`, rawBody });
    assert.equal(ok, true);
  });

  test('acepta con secreto alternativo en rotación', () => {
    const secretoNuevo = 'nuevo-secreto';
    const secretoViejo = 'viejo-secreto';
    const timestamp = '1761220800';
    const rawBody = Buffer.from('{"test":true}');
    const firma = calcularFirma(secretoViejo, timestamp, rawBody).toString('hex');
    const ok = firmaValida({ secretos: [secretoNuevo, secretoViejo], timestamp, header: `v1=${firma}`, rawBody });
    assert.equal(ok, true);
  });

  test('acepta si alguna de las dos firmas del header coincide', () => {
    const secreto = 'secreto';
    const timestamp = '1761220800';
    const rawBody = Buffer.from('{"test":true}');
    const firmaCorrecta = calcularFirma(secreto, timestamp, rawBody).toString('hex');
    const header = `v1=${'0'.repeat(64)}, v1=${firmaCorrecta}`;
    const ok = firmaValida({ secretos: [secreto], timestamp, header, rawBody });
    assert.equal(ok, true);
  });

  test('rechaza firma incorrecta', () => {
    const secreto = 'secreto';
    const timestamp = '1761220800';
    const rawBody = Buffer.from('{"test":true}');
    const ok = firmaValida({ secretos: [secreto], timestamp, header: `v1=${'f'.repeat(64)}`, rawBody });
    assert.equal(ok, false);
  });

  test('rechaza si no hay firmas válidas en header', () => {
    const ok = firmaValida({ secretos: ['secreto'], timestamp: '123', header: 'invalido', rawBody: Buffer.from('x') });
    assert.equal(ok, false);
  });
});

describe('timestampValido', () => {
  test('acepta timestamp dentro de ventana', () => {
    const ahora = Math.floor(Date.now() / 1000);
    assert.equal(timestampValido(String(ahora), ahora, 300), true);
    assert.equal(timestampValido(String(ahora - 100), ahora, 300), true);
    assert.equal(timestampValido(String(ahora + 100), ahora, 300), true);
  });

  test('rechaza timestamp fuera de ventana', () => {
    const ahora = Math.floor(Date.now() / 1000);
    assert.equal(timestampValido(String(ahora - 400), ahora, 300), false);
    assert.equal(timestampValido(String(ahora + 400), ahora, 300), false);
  });

  test('rechaza formato inválido', () => {
    assert.equal(timestampValido('abc', 1000, 300), false);
    assert.equal(timestampValido('', 1000, 300), false);
    assert.equal(timestampValido(null, 1000, 300), false);
  });
});
