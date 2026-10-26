import { calcularComision } from './money.js';
import { decidir } from './stateMachine.js';

// Procesa un evento del inbox sobre la base de datos dentro de una transacción activa.
// Retorna { procesado: boolean, estadoFinal: string, motivo?: string }
export async function procesarEventoEnTx(client, evento, logger = console, esReintentoDiferido = false) {
  // Lock por transacción usando advisory lock para serializar concurrentes sobre la misma tx
  // Usar hashtextextended para reducir colisiones teóricas
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 131542391))', [evento.transaction_id]);

  // 1. Obtener estado actual de la transacción
  const txRes = await client.query(
    'SELECT id, merchant_id, amount_cents, currency, status FROM transactions WHERE id = $1',
    [evento.transaction_id],
  );
  const transaccion = txRes.rows.length > 0 ? txRes.rows[0] : null;

  // 2. Tomar decisión con la máquina de estados pura
  const decision = decidir(transaccion, {
    type: evento.type,
    merchant_id: evento.merchant_id,
    amount_cents: evento.amount_cents,
    currency: evento.currency,
  });

  if (decision.accion === 'invalido') {
    await client.query(
      `UPDATE inbox_events
       SET status = 'invalid', reason = $1, processed_at = clock_timestamp()
       WHERE event_id = $2`,
      [decision.motivo, evento.event_id],
    );
    return { procesado: true, estadoFinal: transaccion?.status ?? null, motivo: decision.motivo };
  }

  if (decision.accion === 'diferir') {
    await client.query(
      `UPDATE inbox_events
       SET status = 'deferred', reason = $1
       WHERE event_id = $2`,
      [decision.motivo, evento.event_id],
    );
    return { procesado: false, estadoFinal: transaccion?.status ?? null, diferido: true, motivo: decision.motivo };
  }

  if (decision.accion === 'crear') {
    // Validar que el comercio exista
    const merchantRes = await client.query('SELECT id FROM merchants WHERE id = $1', [evento.merchant_id]);
    if (merchantRes.rows.length === 0) {
      await client.query(
        `UPDATE inbox_events
         SET status = 'invalid', reason = 'merchant_not_found', processed_at = clock_timestamp()
         WHERE event_id = $1`,
        [evento.event_id],
      );
      return { procesado: true, estadoFinal: null, motivo: 'merchant_not_found' };
    }

    await client.query(
      `INSERT INTO transactions (id, merchant_id, amount_cents, currency, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [evento.transaction_id, evento.merchant_id, evento.amount_cents.toString(), evento.currency, decision.nuevoEstado],
    );

    await client.query(
      `UPDATE inbox_events
       SET status = 'processed', processed_at = clock_timestamp()
       WHERE event_id = $1`,
      [evento.event_id],
    );

    // Intentar resolver diferidos de esta transacción
    if (!esReintentoDiferido) {
      await reintentarDiferidos(client, evento.transaction_id, logger);
    }

    return { procesado: true, estadoFinal: decision.nuevoEstado };
  }

  if (decision.accion === 'transicionar') {
    // Actualizar transacción
    await client.query(
      `UPDATE transactions
       SET status = $1, updated_at = clock_timestamp()
       WHERE id = $2`,
      [decision.nuevoEstado, evento.transaction_id],
    );

    // Si tiene efecto en el ledger (moneda ARS)
    if (decision.efecto === 'acreditar') {
      const merchantRes = await client.query('SELECT commission_bps FROM merchants WHERE id = $1', [evento.merchant_id]);
      const commissionBps = merchantRes.rows[0]?.commission_bps ?? 0;
      const { bruto, comision, neto } = calcularComision(evento.amount_cents, commissionBps);

      await client.query(
        `INSERT INTO ledger_movements
           (merchant_id, kind, transaction_id, event_id, gross_cents, fee_cents, amount_cents)
         VALUES ($1, 'payment_credit', $2, $3, $4, $5, $6)
         ON CONFLICT (event_id) DO NOTHING`,
        [evento.merchant_id, evento.transaction_id, evento.event_id, bruto.toString(), comision.toString(), neto.toString()],
      );
    } else if (decision.efecto === 'debitar') {
      // Serializar con payouts y otras reversas sobre el saldo del comercio.
      // NO KEY UPDATE (y no UPDATE): no choca con el FOR KEY SHARE que toman las FK de los INSERT
      // sobre transactions/ledger_movements, lo que evita deadlocks entre workers.
      await client.query('SELECT id FROM merchants WHERE id = $1 FOR NO KEY UPDATE', [evento.merchant_id]);

      // Reversa: debita exactamente el monto neto que fue acreditado
      const credRes = await client.query(
        `SELECT gross_cents, fee_cents, amount_cents
         FROM ledger_movements
         WHERE transaction_id = $1 AND kind = 'payment_credit'`,
        [evento.transaction_id],
      );

      if (credRes.rows.length > 0) {
        const acreditado = credRes.rows[0];
        const montoDebito = -BigInt(acreditado.amount_cents);

        await client.query(
          `INSERT INTO ledger_movements
             (merchant_id, kind, transaction_id, event_id, gross_cents, fee_cents, amount_cents)
           VALUES ($1, 'payment_reversal', $2, $3, $4, $5, $6)
           ON CONFLICT (event_id) DO NOTHING`,
          [evento.merchant_id, evento.transaction_id, evento.event_id, acreditado.gross_cents, acreditado.fee_cents, montoDebito.toString()],
        );
      }
      // Si no hay crédito previo (edge case), no se genera movimiento de reversa
      // pero el estado de la transacción sí cambia a reversed
    }

    await client.query(
      `UPDATE inbox_events
       SET status = 'processed', processed_at = clock_timestamp()
       WHERE event_id = $1`,
      [evento.event_id],
    );

    // Intentar resolver otros diferidos de esta transacción (ej. si reversed estaba esperando approved)
    if (!esReintentoDiferido) {
      await reintentarDiferidos(client, evento.transaction_id, logger);
    }

    return { procesado: true, estadoFinal: decision.nuevoEstado };
  }

  return { procesado: false };
}

async function reintentarDiferidos(client, transactionId, logger) {
  // Bucle de punto fijo iterativo (sin recursión): mientras haya progreso
  // se siguen reintentando los diferidos pendientes sin frenar ante el primero que siga diferido.
  const maxIteraciones = 50;
  for (let iter = 0; iter < maxIteraciones; iter++) {
    const { rows } = await client.query(
      `SELECT event_id, type, transaction_id, merchant_id, amount_cents, currency
       FROM inbox_events
       WHERE transaction_id = $1 AND status = 'deferred'
       ORDER BY occurred_at ASC, received_at ASC`,
      [transactionId],
    );

    if (rows.length === 0) break;

    let huboProgresoEnIter = false;
    for (const deferred of rows) {
      // Re-verificar que siga diferido antes de procesar para evitar estados obsoletos
      const checkRes = await client.query(
        'SELECT status FROM inbox_events WHERE event_id = $1',
        [deferred.event_id],
      );
      if (checkRes.rows.length === 0 || checkRes.rows[0].status !== 'deferred') {
        continue;
      }

      const res = await procesarEventoEnTx(client, deferred, logger, true);
      if (res.procesado) {
        huboProgresoEnIter = true;
        break;
      }
    }

    if (!huboProgresoEnIter) break;
  }
}
