import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, test } from 'node:test';
import { firmaValida, parsearHeaderFirma, timestampValido } from '../../src/webhooks/signature.js';

const SECRETO = 'secreto-de-prueba';
const firmar = (secreto, ts, body) => createHmac('sha256', secreto).update(`${ts}.${body}`).digest('hex');

describe('firmaValida', () => {
  const ts = '1761220800';
  const body = Buffer.from('{"event_id":"evt_1","type":"payment.created"}');

  test('acepta la firma v1 correcta sobre el body crudo', () => {
    const header = `v1=${firmar(SECRETO, ts, body)}`;
    assert.equal(firmaValida({ secretos: [SECRETO], timestamp: ts, header, rawBody: body }), true);
  });

  test('rechaza si el body cambió después de firmar', () => {
    const header = `v1=${firmar(SECRETO, ts, body)}`;
    const alterado = Buffer.from(body.toString().replace('evt_1', 'evt_2'));
    assert.equal(firmaValida({ secretos: [SECRETO], timestamp: ts, header, rawBody: alterado }), false);
  });

  test('el mismo JSON con otro espaciado tiene otra firma: se firma el body crudo, no el objeto', () => {
    const header = `v1=${firmar(SECRETO, ts, body)}`;
    const reformateado = Buffer.from(JSON.stringify(JSON.parse(body), null, 2));
    assert.equal(firmaValida({ secretos: [SECRETO], timestamp: ts, header, rawBody: reformateado }), false);
  });

  test('rechaza si cambia el timestamp firmado', () => {
    const header = `v1=${firmar(SECRETO, ts, body)}`;
    assert.equal(firmaValida({ secretos: [SECRETO], timestamp: '1761220801', header, rawBody: body }), false);
  });

  test('rechaza otro secreto', () => {
    const header = `v1=${firmar('otro', ts, body)}`;
    assert.equal(firmaValida({ secretos: [SECRETO], timestamp: ts, header, rawBody: body }), false);
  });

  test('rotación: dos firmas separadas por coma, vale si coincide cualquiera', () => {
    const vieja = `v1=${firmar('secreto-viejo', ts, body)}`;
    const nueva = `v1=${firmar(SECRETO, ts, body)}`;
    assert.equal(firmaValida({ secretos: [SECRETO], timestamp: ts, header: `${vieja},${nueva}`, rawBody: body }), true);
    assert.equal(firmaValida({ secretos: [SECRETO], timestamp: ts, header: `${nueva}, ${vieja}`, rawBody: body }), true);
  });

  test('rechaza firma sin prefijo v1= o con otra versión', () => {
    const hex = firmar(SECRETO, ts, body);
    for (const header of [hex, `v0=${hex}`, `v2=${hex}`, '', undefined]) {
      assert.equal(firmaValida({ secretos: [SECRETO], timestamp: ts, header, rawBody: body }), false);
    }
  });

  test('rechaza firmas truncadas o con caracteres no hex sin tirar excepción', () => {
    const hex = firmar(SECRETO, ts, body);
    for (const header of [`v1=${hex.slice(0, 63)}`, `v1=${hex}00`, `v1=${hex.slice(0, 63)}z`]) {
      assert.equal(firmaValida({ secretos: [SECRETO], timestamp: ts, header, rawBody: body }), false);
    }
  });
});

describe('parsearHeaderFirma', () => {
  test('extrae solo las firmas v1 bien formadas', () => {
    const a = 'a'.repeat(64);
    const b = 'b'.repeat(64);
    assert.equal(parsearHeaderFirma(`v1=${a},v9=${b},v1=${b}`).length, 2);
  });
});

describe('timestampValido', () => {
  const ahora = 1_761_220_800;

  test('acepta dentro de la ventana de 5 minutos', () => {
    assert.equal(timestampValido(String(ahora), ahora, 300), true);
    assert.equal(timestampValido(String(ahora - 300), ahora, 300), true);
    assert.equal(timestampValido(String(ahora + 300), ahora, 300), true);
  });

  test('rechaza fuera de la ventana', () => {
    assert.equal(timestampValido(String(ahora - 301), ahora, 300), false);
    assert.equal(timestampValido(String(ahora - 600), ahora, 300), false);
    assert.equal(timestampValido(String(ahora + 301), ahora, 300), false);
  });

  test('rechaza formatos inválidos', () => {
    for (const ts of [undefined, '', 'abc', '1761220800.5', '-1761220800', '1e9', ' 1761220800']) {
      assert.equal(timestampValido(ts, ahora, 300), false);
    }
  });
});
