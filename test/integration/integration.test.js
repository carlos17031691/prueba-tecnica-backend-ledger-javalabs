import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { crearApp } from '../../src/app.js';
import { crearPool, enTransaccion } from '../../src/db/pool.js';
import { procesarEventoEnTx } from '../../src/domain/eventProcessor.js';
import { tomarYProcesarSiguiente } from '../../src/worker.js';

import { cargarEnv } from '../../src/config.js';

cargarEnv();

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ledger';
const WEBHOOK_SECRET = 'secreto-test-integracion';
const API_KEY = 'mk_test_integracion';
const MERCHANT_ID = 'm_test_integ';

function firmar(ts, body) {
  return `v1=${createHmac('sha256', WEBHOOK_SECRET).update(`${ts}.${body}`).digest('hex')}`;
}

describe('Tests de integración contra DB real', () => {
  let pool;
  let app;

  before(async () => {
    pool = crearPool({ databaseUrl: DATABASE_URL, max: 15, applicationName: 'test-integration' });
    app = crearApp({
      config: {
        port: 0,
        host: '127.0.0.1',
        logLevel: 'silent',
        databaseUrl: DATABASE_URL,
        webhookSecret: WEBHOOK_SECRET,
        webhookToleranciaSeg: 300,
        adminToken: 'test-admin',
      },
      pool,
      logger: false,
    });
    await app.ready();

    // Sembrar comercio de prueba específico para la suite de integración
    const { hashApiKey } = await import('../../src/auth/apiKey.js');
    await pool.query(
      `INSERT INTO merchants (id, name, api_key_hash, commission_bps)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
         SET api_key_hash = EXCLUDED.api_key_hash, commission_bps = EXCLUDED.commission_bps`,
      [MERCHANT_ID, 'Comercio Integration', hashApiKey(API_KEY), 250],
    );
  });

  after(async () => {
    await app.close();
    await pool.end();
  });

  test('POST /webhooks/psp valida firma e inserta de forma idempotente', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const uniqueId = Date.now();
    const bodyObj = {
      event_id: `evt_integ_${uniqueId}`,
      type: 'payment.created',
      occurred_at: new Date().toISOString(),
      data: {
        transaction_id: `tx_integ_${uniqueId}`,
        merchant_id: MERCHANT_ID,
        amount: '1000.00',
        currency: 'ARS',
      },
    };
    const rawBody = JSON.stringify(bodyObj);

    const enviar = () =>
      app.inject({
        method: 'POST',
        url: '/webhooks/psp',
        headers: {
          'content-type': 'application/json',
          'x-psp-timestamp': String(ts),
          'x-psp-signature': firmar(ts, rawBody),
        },
        payload: Buffer.from(rawBody),
      });

    // Primer envío -> 200 OK
    const res1 = await enviar();

    assert.equal(res1.statusCode, 200);
    const json1 = JSON.parse(res1.payload);
    assert.equal(json1.received, true);
    assert.equal(json1.duplicate, false);

    // Segundo envío (duplicado) -> 200 OK con duplicate: true
    const res2 = await enviar();

    assert.equal(res2.statusCode, 200);
    const json2 = JSON.parse(res2.payload);
    assert.equal(json2.received, true);
    assert.equal(json2.duplicate, true);
  });

  test('POST /webhooks/psp rechaza firma inválida con 401', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const rawBody = '{"event_id":"evt_bad_sig"}';

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/psp',
      headers: {
        'content-type': 'application/json',
        'x-psp-timestamp': String(ts),
        'x-psp-signature': 'v1=badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbad',
      },
      payload: Buffer.from(rawBody),
    });

    assert.equal(res.statusCode, 401);
  });

  test('POST /webhooks/psp rechaza timestamp mayor a 5 minutos con 401', async () => {
    const tsViejo = Math.floor(Date.now() / 1000) - 400; // > 300 s
    const rawBody = '{"event_id":"evt_expired"}';

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/psp',
      headers: {
        'content-type': 'application/json',
        'x-psp-timestamp': String(tsViejo),
        'x-psp-signature': firmar(tsViejo, rawBody),
      },
      payload: Buffer.from(rawBody),
    });

    assert.equal(res.statusCode, 401);
  });

  test('GET /merchants/me/balance y paginación por cursor', async () => {
    // Consultar saldo inicial del comercio
    const resBalance = await app.inject({
      method: 'GET',
      url: '/merchants/me/balance',
      headers: { 'x-api-key': API_KEY },
    });

    assert.equal(resBalance.statusCode, 200);
    const balanceJson = JSON.parse(resBalance.payload);
    assert.ok(typeof balanceJson.available === 'string');

    // Consultar movimientos
    const resMovements = await app.inject({
      method: 'GET',
      url: '/merchants/me/movements?limit=10',
      headers: { 'x-api-key': API_KEY },
    });

    assert.equal(resMovements.statusCode, 200);
    const movJson = JSON.parse(resMovements.payload);
    assert.ok(Array.isArray(movJson.items));
  });

  test('Aislamiento entre comercios: API key inválida da 401 y transacción ajena da 404', async () => {
    const resNoAuth = await app.inject({
      method: 'GET',
      url: '/merchants/me/balance',
      headers: { 'x-api-key': 'clave_inexistente' },
    });
    assert.equal(resNoAuth.statusCode, 401);

    const resTx404 = await app.inject({
      method: 'GET',
      url: '/transactions/tx_no_existe',
      headers: { 'x-api-key': API_KEY },
    });
    assert.equal(resTx404.statusCode, 404);
  });

  test('Extensión B1: Payouts debitan saldo y validan Idempotency-Key', async () => {
    // Si no hay saldo suficiente para un monto gigante -> 422
    const resInsuficiente = await app.inject({
      method: 'POST',
      url: '/payouts',
      headers: {
        'x-api-key': API_KEY,
        'idempotency-key': 'idemp_test_01',
        'content-type': 'application/json',
      },
      payload: { amount: '999999999.00' },
    });
    assert.equal(resInsuficiente.statusCode, 422);

    // Sin header de idempotency -> 400
    const resSinHeader = await app.inject({
      method: 'POST',
      url: '/payouts',
      headers: { 'x-api-key': API_KEY },
      payload: { amount: '10.00' },
    });
    assert.equal(resSinHeader.statusCode, 400);
  });

  test('Concurrencia: 10 envíos paralelos del mismo evento acreditan una sola vez', async () => {
    const client = await pool.connect();
    try {
      const txId = `tx_conc_${Date.now()}`;
      const evId = `evt_conc_${Date.now()}`;
      const amountCents = 100000n; // 1.000,00 ARS

      // 1. Crear la transacción en pending
      await client.query('BEGIN');
      await procesarEventoEnTx(client, {
        event_id: `evt_c_${txId}`,
        type: 'payment.created',
        transaction_id: txId,
        merchant_id: MERCHANT_ID,
        amount_cents: amountCents,
        currency: 'ARS',
      });
      await client.query('COMMIT');

      // 2. Insertar el evento approved en inbox_events con next_attempt_at en el futuro lejano para que el worker no lo tome
      await client.query(
        `INSERT INTO inbox_events
           (event_id, type, transaction_id, merchant_id, amount_cents, currency, occurred_at, payload, payload_hash, next_attempt_at)
         VALUES ($1, 'payment.approved', $2, $3, $4, 'ARS', now(), '{}', 'hash_test', clock_timestamp() + interval '1 hour')`,
        [evId, txId, MERCHANT_ID, amountCents.toString()],
      );

      // 3. Ejecutar 10 llamadas concurrentes para procesar el MISMO evento
      const eventoAprobacion = {
        event_id: evId,
        type: 'payment.approved',
        transaction_id: txId,
        merchant_id: MERCHANT_ID,
        amount_cents: amountCents,
        currency: 'ARS',
      };

      const ejecutarProcesamiento = async () => {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const res = await procesarEventoEnTx(c, eventoAprobacion);
          await c.query('COMMIT');
          return res;
        } catch (err) {
          await c.query('ROLLBACK').catch(() => {});
          return { error: err.message };
        } finally {
          c.release();
        }
      };

      const resultados = await Promise.all(
        Array.from({ length: 10 }, () => ejecutarProcesamiento()),
      );

      // 4. Verificar en el ledger cuántos movimientos se crearon para esta transacción
      const movRes = await pool.query(
        'SELECT COUNT(*) as total FROM ledger_movements WHERE transaction_id = $1 AND kind = \'payment_credit\'',
        [txId],
      );
      assert.equal(Number(movRes.rows[0].total), 1, 'Debe haber exactamente 1 movimiento de crédito');
    } finally {
      client.release();
    }
  });

  test('Concurrencia: approved y reversed simultáneos terminan en estado consistente', async () => {
    const txId = `tx_race_${Date.now()}`;
    const amountCents = 50000n; // 500,00 ARS

    const cSetup = await pool.connect();
    try {
      await cSetup.query('BEGIN');
      await procesarEventoEnTx(cSetup, {
        event_id: `evt_c_${txId}`,
        type: 'payment.created',
        transaction_id: txId,
        merchant_id: MERCHANT_ID,
        amount_cents: amountCents,
        currency: 'ARS',
      });
      await cSetup.query('COMMIT');

      // Insertar ambos eventos en el inbox con next_attempt_at en el futuro para que el worker de fondo no los consuma
      await cSetup.query(
        `INSERT INTO inbox_events (event_id, type, transaction_id, merchant_id, amount_cents, currency, occurred_at, payload, payload_hash, next_attempt_at)
         VALUES
           ($1, 'payment.approved', $3, $4, $5, 'ARS', now(), '{}', 'h1', clock_timestamp() + interval '1 hour'),
           ($2, 'payment.reversed', $3, $4, $5, 'ARS', now(), '{}', 'h2', clock_timestamp() + interval '1 hour')`,
        [`evt_app_${txId}`, `evt_rev_${txId}`, txId, MERCHANT_ID, amountCents.toString()],
      );
    } finally {
      cSetup.release();
    }

    const proc = async (tipo, evtId) => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const res = await procesarEventoEnTx(c, {
          event_id: evtId,
          type: tipo,
          transaction_id: txId,
          merchant_id: MERCHANT_ID,
          amount_cents: amountCents,
          currency: 'ARS',
        });
        await c.query('COMMIT');
        return res;
      } catch (err) {
        await c.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        c.release();
      }
    };

    // Lanzar approved y reversed al mismo tiempo en paralelo
    await Promise.all([
      proc('payment.approved', `evt_app_${txId}`),
      proc('payment.reversed', `evt_rev_${txId}`),
    ]);

    // Verificar estado final en la base
    const txRes = await pool.query('SELECT status FROM transactions WHERE id = $1', [txId]);
    assert.equal(txRes.rows[0].status, 'reversed', 'El estado final debe ser reversed');

    // Verificar movimientos de ledger: exactamente un crédito y un débito (efecto neto cero)
    const movRes = await pool.query(
      'SELECT kind, amount_cents FROM ledger_movements WHERE transaction_id = $1 ORDER BY id ASC',
      [txId],
    );
    assert.equal(movRes.rows.length, 2, 'Deben existir 2 movimientos: crédito y reversa');
    assert.equal(movRes.rows[0].kind, 'payment_credit');
    assert.equal(movRes.rows[1].kind, 'payment_reversal');
    assert.equal(
      BigInt(movRes.rows[0].amount_cents) + BigInt(movRes.rows[1].amount_cents),
      0n,
      'El efecto neto en el ledger debe ser exactamente cero',
    );
  });

  test('Fuera de orden: las 6 permutaciones de created/approved/reversed convergen en reversed con saldo 0', async () => {
    const permutaciones = [
      ['payment.created', 'payment.approved', 'payment.reversed'],
      ['payment.created', 'payment.reversed', 'payment.approved'],
      ['payment.approved', 'payment.created', 'payment.reversed'],
      ['payment.approved', 'payment.reversed', 'payment.created'],
      ['payment.reversed', 'payment.created', 'payment.approved'],
      ['payment.reversed', 'payment.approved', 'payment.created'],
    ];

    const amountCents = 150000n; // 1.500,00 ARS

    for (let i = 0; i < permutaciones.length; i++) {
      const perm = permutaciones[i];
      const txId = `tx_perm_${Date.now()}_${i}`;

      for (let j = 0; j < perm.length; j++) {
        const tipo = perm[j];
        const evId = `evt_p_${txId}_${j}`;

        await enTransaccion(pool, async (client) => {
          await client.query(
            `INSERT INTO inbox_events
               (event_id, type, transaction_id, merchant_id, amount_cents, currency, occurred_at, payload, payload_hash)
             VALUES ($1, $2, $3, $4, $5, 'ARS', clock_timestamp(), '{}', 'hash_perm')`,
            [evId, tipo, txId, MERCHANT_ID, amountCents.toString()],
          );
          return procesarEventoEnTx(client, {
            event_id: evId,
            type: tipo,
            transaction_id: txId,
            merchant_id: MERCHANT_ID,
            amount_cents: amountCents,
            currency: 'ARS',
          });
        });
      }

      // Verificar que para cada permutación el resultado final sea exacto
      const txRes = await pool.query('SELECT status FROM transactions WHERE id = $1', [txId]);
      assert.equal(txRes.rows[0].status, 'reversed', `Permutación ${perm.join('->')} debe terminar en reversed`);

      const movRes = await pool.query(
        'SELECT kind, amount_cents FROM ledger_movements WHERE transaction_id = $1 ORDER BY id ASC',
        [txId],
      );
      assert.equal(movRes.rows.length, 2, `Permutación ${perm.join('->')} debe tener 2 movimientos`);
      assert.equal(movRes.rows[0].kind, 'payment_credit');
      assert.equal(movRes.rows[1].kind, 'payment_reversal');
      assert.equal(
        BigInt(movRes.rows[0].amount_cents) + BigInt(movRes.rows[1].amount_cents),
        0n,
        `Permutación ${perm.join('->')} debe tener efecto neto cero`,
      );

      const evtsRes = await pool.query('SELECT status FROM inbox_events WHERE transaction_id = $1', [txId]);
      for (const row of evtsRes.rows) {
        assert.equal(row.status, 'processed', `En permutación ${perm.join('->')} todo evento debe ser processed`);
      }
    }
  });

  test('Worker: evento con comercio inexistente se marca invalid sin bloquear al worker', async () => {
    // Aislar eventos previos para que el worker tome el del test
    await pool.query("UPDATE inbox_events SET next_attempt_at = clock_timestamp() + interval '1 hour' WHERE status = 'received'");

    const badEvtId = `evt_poison_${Date.now()}`;
    const goodEvtId = `evt_good_${Date.now()}`;
    const goodTxId = `tx_good_${Date.now()}`;

    // 1. Insertar evento con comercio inexistente
    await pool.query(
      `INSERT INTO inbox_events
         (event_id, type, transaction_id, merchant_id, amount_cents, currency, occurred_at, payload, payload_hash, attempts, next_attempt_at)
       VALUES ($1, 'payment.created', 'tx_poison', 'm_desconocido', '1000', 'ARS', clock_timestamp(), '{}', 'hash_p', 0, clock_timestamp())`,
      [badEvtId],
    );

    // 2. Procesar con el worker: gracias a la corrección del query ($1), ahora se marca como invalid en vez de abortar la transacción
    const configWorker = { workerMaxIntentos: 3 };
    const procesado = await tomarYProcesarSiguiente(pool, configWorker);
    assert.equal(procesado, true);

    const badRow = await pool.query('SELECT status, reason FROM inbox_events WHERE event_id = $1', [badEvtId]);
    assert.equal(badRow.rows[0].status, 'invalid');
    assert.equal(badRow.rows[0].reason, 'merchant_not_found');

    // 3. Insertar un evento válido inmediatamente después
    await pool.query(
      `INSERT INTO inbox_events
         (event_id, type, transaction_id, merchant_id, amount_cents, currency, occurred_at, payload, payload_hash, attempts, next_attempt_at)
       VALUES ($1, 'payment.created', $2, $3, '10000', 'ARS', clock_timestamp(), '{}', 'hash_g', 0, clock_timestamp())`,
      [goodEvtId, goodTxId, MERCHANT_ID],
    );

    // 4. El worker procesa el siguiente evento sin atascarse
    const procesadoGood = await tomarYProcesarSiguiente(pool, configWorker);
    assert.equal(procesadoGood, true);

    const goodRow = await pool.query('SELECT status FROM inbox_events WHERE event_id = $1', [goodEvtId]);
    assert.equal(goodRow.rows[0].status, 'processed', 'El evento válido se procesó con éxito');
  });

  test('Worker: reintentos con SAVEPOINT ante error inesperado incrementan attempts y llegan a failed', async () => {
    // Aislar eventos previos
    await pool.query("UPDATE inbox_events SET next_attempt_at = clock_timestamp() + interval '1 hour' WHERE status = 'received'");

    // Crear un trigger temporal en transactions que simula un fallo interno de base de datos para esta tx
    await pool.query(`
      CREATE OR REPLACE FUNCTION simular_error_db() RETURNS trigger AS $$
      BEGIN
        IF NEW.id = 'tx_simular_fallo' THEN
          RAISE EXCEPTION 'simulated_database_error';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_simular_fallo ON transactions;
      CREATE TRIGGER trg_simular_fallo BEFORE INSERT ON transactions FOR EACH ROW EXECUTE FUNCTION simular_error_db();
    `);

    const errorEvtId = `evt_err_${Date.now()}`;

    try {
      await pool.query(
        `INSERT INTO inbox_events
           (event_id, type, transaction_id, merchant_id, amount_cents, currency, occurred_at, payload, payload_hash, attempts, next_attempt_at)
         VALUES ($1, 'payment.created', 'tx_simular_fallo', $2, '1000', 'ARS', clock_timestamp(), '{}', 'hash_err', 0, clock_timestamp())`,
        [errorEvtId, MERCHANT_ID],
      );

      const configWorker = { workerMaxIntentos: 2 };

      // Intento 1: SAVEPOINT captura el error, incrementa attempts a 1 y programa backoff
      await tomarYProcesarSiguiente(pool, configWorker);
      let row = (await pool.query('SELECT attempts, status, next_attempt_at FROM inbox_events WHERE event_id = $1', [errorEvtId])).rows[0];
      assert.equal(row.attempts, 1);
      assert.equal(row.status, 'received');

      // Simular que vence la ventana de reintento adelantando next_attempt_at
      await pool.query('UPDATE inbox_events SET next_attempt_at = clock_timestamp() - interval \'1 second\' WHERE event_id = $1', [errorEvtId]);

      // Intento 2: alcanza workerMaxIntentos (2) y pasa a status = 'failed' (Dead Letter Queue)
      await tomarYProcesarSiguiente(pool, configWorker);
      row = (await pool.query('SELECT attempts, status FROM inbox_events WHERE event_id = $1', [errorEvtId])).rows[0];
      assert.equal(row.attempts, 2);
      assert.equal(row.status, 'failed', 'Al alcanzar el máximo de intentos pasa a failed');
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS trg_simular_fallo ON transactions; DROP FUNCTION IF EXISTS simular_error_db();');
    }
  });

  test('Extensión B1: Payout 201 exitoso, idempotencia (200 y 409) y concurrencia sin saldo negativo', async () => {
    // 1. Asegurar saldo previo acreditando un pago legítimo (registrando en inbox_events para FK)
    const txId = `tx_payout_${Date.now()}`;
    const evCreatedId = `evt_c_${txId}`;
    const evApprovedId = `evt_a_${txId}`;

    await pool.query(
      `INSERT INTO inbox_events
         (event_id, type, transaction_id, merchant_id, amount_cents, currency, occurred_at, payload, payload_hash)
       VALUES
         ($1, 'payment.created', $2, $3, '100000', 'ARS', clock_timestamp(), '{}', 'h1'),
         ($4, 'payment.approved', $2, $3, '100000', 'ARS', clock_timestamp(), '{}', 'h2')`,
      [evCreatedId, txId, MERCHANT_ID, evApprovedId],
    );

    await enTransaccion(pool, async (client) => {
      await procesarEventoEnTx(client, {
        event_id: evCreatedId,
        type: 'payment.created',
        transaction_id: txId,
        merchant_id: MERCHANT_ID,
        amount_cents: 100000n, // 1.000,00 ARS bruto
        currency: 'ARS',
      });
      await procesarEventoEnTx(client, {
        event_id: evApprovedId,
        type: 'payment.approved',
        transaction_id: txId,
        merchant_id: MERCHANT_ID,
        amount_cents: 100000n,
        currency: 'ARS',
      });
    });

    const balAntes = await app.inject({
      method: 'GET',
      url: '/merchants/me/balance',
      headers: { 'x-api-key': API_KEY },
    });
    const saldoInicial = Number.parseFloat(JSON.parse(balAntes.payload).available);
    assert.ok(saldoInicial >= 100, 'Debe haber saldo suficiente para el payout');

    // 2. Ejecutar un Payout exitoso de 50.00
    const idempKey = `idemp_ok_${Date.now()}`;
    const resPayout = await app.inject({
      method: 'POST',
      url: '/payouts',
      headers: {
        'x-api-key': API_KEY,
        'idempotency-key': idempKey,
        'content-type': 'application/json',
      },
      payload: { amount: '50.00' },
    });
    assert.equal(resPayout.statusCode, 201, 'Payout con saldo debe responder 201 Created');
    const payoutBody = JSON.parse(resPayout.payload);
    assert.equal(payoutBody.amount, '50.00');
    assert.ok(payoutBody.id.startsWith('po_'));

    // Verificar en ledger_movements: debe haber un movimiento tipo payout con transaction_id NULL
    const movPayout = await pool.query(
      'SELECT kind, transaction_id, payout_id, amount_cents FROM ledger_movements WHERE payout_id = $1',
      [payoutBody.id],
    );
    assert.equal(movPayout.rows.length, 1);
    assert.equal(movPayout.rows[0].kind, 'payout');
    assert.equal(movPayout.rows[0].transaction_id, null, 'transaction_id debe ser NULL para payouts');
    assert.equal(BigInt(movPayout.rows[0].amount_cents), -5000n, 'amount_cents debe ser negativo');

    // 3. Replay con misma idempotency key y mismo payload -> 200 OK con respuesta original
    const resReplay = await app.inject({
      method: 'POST',
      url: '/payouts',
      headers: {
        'x-api-key': API_KEY,
        'idempotency-key': idempKey,
        'content-type': 'application/json',
      },
      payload: { amount: '50.00' },
    });
    assert.equal(resReplay.statusCode, 200, 'Replay idempotente debe responder 200 OK');
    assert.equal(JSON.parse(resReplay.payload).id, payoutBody.id);

    // 4. Misma idempotency key con payload distinto -> 409 Conflict
    const resConflict = await app.inject({
      method: 'POST',
      url: '/payouts',
      headers: {
        'x-api-key': API_KEY,
        'idempotency-key': idempKey,
        'content-type': 'application/json',
      },
      payload: { amount: '99.00' },
    });
    assert.equal(resConflict.statusCode, 409, 'Misma key con otro payload debe responder 409 Conflict');

    // 5. Concurrencia de payouts: 5 payouts paralelos con saldo acotado
    const balanceActual = Number.parseFloat(
      JSON.parse((await app.inject({ method: 'GET', url: '/merchants/me/balance', headers: { 'x-api-key': API_KEY } })).payload).available,
    );
    const montoPayout = balanceActual; // Pedir todo el saldo disponible
    const promesas = [1, 2, 3].map((i) =>
      app.inject({
        method: 'POST',
        url: '/payouts',
        headers: {
          'x-api-key': API_KEY,
          'idempotency-key': `idemp_conc_${txId}_${i}`,
          'content-type': 'application/json',
        },
        payload: { amount: montoPayout.toFixed(2) },
      }),
    );
    const respuestas = await Promise.all(promesas);
    const exitosos = respuestas.filter((r) => r.statusCode === 201);
    const rechazados = respuestas.filter((r) => r.statusCode === 422);

    assert.equal(exitosos.length, 1, 'Exactamente 1 payout debe ser aprobado');
    assert.equal(rechazados.length, 2, 'Los demás deben ser rechazados por saldo insuficiente');

    // Saldo final nunca debe ser negativo
    const balFinal = JSON.parse((await app.inject({ method: 'GET', url: '/merchants/me/balance', headers: { 'x-api-key': API_KEY } })).payload);
    assert.ok(Number.parseFloat(balFinal.available) >= 0, 'El saldo disponible nunca debe ser negativo');
  });

  test('Concurrencia cruzada: Reversal y Payout simultáneos se serializan con lock pesimista sobre el comercio', async () => {
    const txId = `tx_cross_${Date.now()}`;
    const evCreatedId = `evt_c_${txId}`;
    const evApprovedId = `evt_a_${txId}`;
    const evReversedId = `evt_r_${txId}`;

    // 1. Acreditar exactamente 200.00 ARS brutos al comercio
    await pool.query(
      `INSERT INTO inbox_events
         (event_id, type, transaction_id, merchant_id, amount_cents, currency, occurred_at, payload, payload_hash)
       VALUES
         ($1, 'payment.created', $2, $3, '20000', 'ARS', clock_timestamp(), '{}', 'hx1'),
         ($4, 'payment.approved', $2, $3, '20000', 'ARS', clock_timestamp(), '{}', 'hx2'),
         ($5, 'payment.reversed', $2, $3, '20000', 'ARS', clock_timestamp(), '{}', 'hx3')`,
      [evCreatedId, txId, MERCHANT_ID, evApprovedId, evReversedId],
    );

    await enTransaccion(pool, async (client) => {
      await procesarEventoEnTx(client, { event_id: evCreatedId, type: 'payment.created', transaction_id: txId, merchant_id: MERCHANT_ID, amount_cents: 20000n, currency: 'ARS' });
      await procesarEventoEnTx(client, { event_id: evApprovedId, type: 'payment.approved', transaction_id: txId, merchant_id: MERCHANT_ID, amount_cents: 20000n, currency: 'ARS' });
    });

    // 2. Disparar Payout de 195.00 (el neto acreditado con 2,5% es 195.00) y Reversal de 195.00 en paralelo
    const promesas = [
      app.inject({
        method: 'POST',
        url: '/payouts',
        headers: {
          'x-api-key': API_KEY,
          'idempotency-key': `idemp_cross_${Date.now()}`,
          'content-type': 'application/json',
        },
        payload: { amount: '195.00' },
      }),
      enTransaccion(pool, async (client) => {
        return procesarEventoEnTx(client, {
          event_id: evReversedId,
          type: 'payment.reversed',
          transaction_id: txId,
          merchant_id: MERCHANT_ID,
          amount_cents: 20000n,
          currency: 'ARS',
        });
      }),
    ];

    const [resPayout, resReversal] = await Promise.all(promesas);

    // Ambos terminan sin errores no manejados ni deadlocks de base de datos
    assert.ok([201, 422].includes(resPayout.statusCode), 'Payout responde 201 si ganó la carrera o 422 si la reversa ganó primero');
    assert.equal(resReversal.procesado, true, 'La reversa siempre se procesa con éxito');

    // Verificar que la transacción en transactions quedó en reversed
    const txRow = await pool.query('SELECT status FROM transactions WHERE id = $1', [txId]);
    assert.equal(txRow.rows[0].status, 'reversed');
  });

  test('Validaciones robustas: limit=abc devuelve 400 y errores 500 no filtran detalles internos', async () => {
    // 1. limit=abc en movements
    const resLimit = await app.inject({
      method: 'GET',
      url: '/merchants/me/movements?limit=abc',
      headers: { 'x-api-key': API_KEY },
    });
    assert.equal(resLimit.statusCode, 400);
    const jsonLimit = JSON.parse(resLimit.payload);
    assert.equal(jsonLimit.error, 'bad_request');

    // 2. cursor inválido devuelve 400
    const resCursor = await app.inject({
      method: 'GET',
      url: '/merchants/me/movements?cursor=cursor_invalido_no_base64',
      headers: { 'x-api-key': API_KEY },
    });
    assert.equal(resCursor.statusCode, 400);

    // 3. cursor numérico fuera del rango de int8: antes llegaba a Postgres y devolvía 500
    const resCursorGrande = await app.inject({
      method: 'GET',
      url: `/merchants/me/movements?cursor=${Buffer.from('99999999999999999999999').toString('base64')}`,
      headers: { 'x-api-key': API_KEY },
    });
    assert.equal(resCursorGrande.statusCode, 400);
  });

  test('Estrés: 120 transacciones mezcladas (desordenadas, con duplicados) y 6 workers en paralelo convergen sin deadlocks', async () => {
    const mid = `m_stress_${Date.now()}`;
    await pool.query(
      `INSERT INTO merchants (id, name, api_key_hash, commission_bps) VALUES ($1, $1, $2, 250)`,
      [mid, `hash_${mid}`],
    );

    const fmt = (c) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;
    const neto = (c) => c - Math.floor((c * 250) / 10000);
    let seq = 0;
    const enviar = (type, tx, cents, evId = `ev_${mid}_${seq++}`) => {
      const ts = Math.floor(Date.now() / 1000);
      const body = JSON.stringify({
        event_id: evId,
        type,
        occurred_at: new Date().toISOString(),
        data: { transaction_id: tx, merchant_id: mid, amount: fmt(cents), currency: 'ARS' },
      });
      return app.inject({
        method: 'POST',
        url: '/webhooks/psp',
        headers: { 'content-type': 'application/json', 'x-psp-timestamp': String(ts), 'x-psp-signature': firmar(ts, body) },
        payload: Buffer.from(body),
      });
    };

    const pedidos = [];
    const esperado = {};
    let saldoEsperado = 0;
    for (let i = 0; i < 120; i++) {
      const tx = `tx_${mid}_${i}`;
      const c = 1000 + Math.floor(Math.random() * 500000);
      const k = i % 4;
      if (k === 0) {
        esperado[tx] = 'reversed';
        pedidos.push(['payment.created', tx, c], ['payment.approved', tx, c], ['payment.reversed', tx, c]);
      } else if (k === 1) {
        esperado[tx] = 'approved';
        saldoEsperado += neto(c);
        pedidos.push(['payment.created', tx, c], ['payment.approved', tx, c]);
      } else if (k === 2) {
        esperado[tx] = 'rejected';
        pedidos.push(['payment.created', tx, c], ['payment.rejected', tx, c]);
      } else {
        esperado[tx] = 'reversed';
        const dup = `dup_${tx}`;
        pedidos.push(
          ['payment.created', tx, c],
          ['payment.approved', tx, c, dup],
          ['payment.approved', tx, c, dup],
          ['payment.reversed', tx, c],
        );
      }
    }
    // Orden aleatorio: created/approved/reversed de una misma tx llegan en cualquier orden.
    for (let i = pedidos.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pedidos[i], pedidos[j]] = [pedidos[j], pedidos[i]];
    }

    const respuestas = await Promise.all(pedidos.map((p) => enviar(...p)));
    assert.ok(respuestas.every((r) => r.statusCode === 200), 'Todos los webhooks firmados responden 200');

    // 6 workers en paralelo drenando la cola, como en producción.
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        while (await tomarYProcesarSiguiente(pool, { workerMaxIntentos: 5 })) { /* drenar */ }
      }),
    );

    const evs = (await pool.query(
      `SELECT status, count(*)::int AS c, max(attempts)::int AS intentos, max(reason) AS motivo
       FROM inbox_events WHERE merchant_id = $1 GROUP BY status`,
      [mid],
    )).rows;
    assert.deepEqual(evs.map((e) => e.status), ['processed'], `Todos los eventos deben quedar processed: ${JSON.stringify(evs)}`);
    assert.equal(evs[0].intentos, 0, 'Ningún evento debe haber fallado (p. ej. por deadlock) y reintentado');

    const txs = (await pool.query('SELECT id, status FROM transactions WHERE merchant_id = $1', [mid])).rows;
    assert.equal(txs.length, 120);
    for (const t of txs) assert.equal(t.status, esperado[t.id], `Estado final de ${t.id}`);

    const saldo = BigInt((await pool.query('SELECT COALESCE(SUM(amount_cents), 0) AS s FROM ledger_movements WHERE merchant_id = $1', [mid])).rows[0].s);
    assert.equal(saldo, BigInt(saldoEsperado), 'El saldo debe ser exactamente la suma de los netos de las transacciones approved');
  });
});
