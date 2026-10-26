# Preguntas y respuestas

## Parte A

**A1. ¿Por qué verificar la firma sobre el body crudo y no sobre el JSON parseado?**
Porque el JSON puede tener distinto espaciado, orden de claves o encoding entre reintentos. La firma se calcula sobre los bytes exactos recibidos (`timestamp + "." + rawBody`) tal como envía el PSP. Si se parseara y reserializara, la firma podría no coincidir aunque el contenido semántico sea el mismo.

**A2. ¿Cómo garantizaste idempotencia a nivel recepción y a nivel procesamiento?**
A nivel recepción: PK `event_id` en `inbox_events` con `ON CONFLICT DO UPDATE` para contar duplicados. A nivel procesamiento: el worker toma eventos con `FOR UPDATE SKIP LOCKED` y cada evento se procesa dentro de una transacción. Además hay índices únicos (`event_id` en `ledger_movements`, `(transaction_id, kind)`) que evitan generar movimientos duplicados. Los movimientos son append-only.

**A3. ¿Qué estrategia usaste para eventos fuera de orden?**
Usé una máquina de estados pura. Si llega un evento antes de que exista la transacción o antes del evento que lo habilita (ej. `reversed` en `pending`), se marca como `diferido`. Un sistema de `reintentarDiferidos` con bucle iterativo de punto fijo reintenta los eventos diferidos cada vez que cambia el estado de la transacción, verificando que sigan diferidos antes de procesarlos.

**A4. ¿Por qué usar movimientos inmutables en lugar de actualizar un campo `balance`?**
Para tener un audit trail completo, trazabilidad y evitar inconsistencias. El saldo se deriva con `SUM(amount_cents)`. Los triggers bloquean `UPDATE/DELETE/TRUNCATE` en `ledger_movements`. Esto garantiza integridad histórica y facilita conciliación.

**A5. ¿Por qué usar cursor en lugar de offset para paginar movimientos?**
Con `offset` grandes pueden haber problemas de performance y resultados inconsistentes si hay inserts concurrentes. Con cursor basado en `id` (BIGSERIAL) y `WHERE id < cursor ORDER BY id DESC` es estable, eficiente con índice y correcto para paginación infinita.

**A6. ¿Cómo garantizaste atomicidad entre cambio de estado, movimiento y registro del evento?**
Todo ocurre dentro de la misma transacción de base de datos. El worker usa `SAVEPOINT` por evento para aislar fallos sin abortar toda la transacción externa. Si algo falla, se hace rollback al savepoint y se maneja el reintento/fallo correctamente.

**A7. ¿Cómo manejaste la concurrencia entre eventos de la misma transacción y entre distintos comercios?**
Para la misma transacción: `pg_advisory_xact_lock(hashtextextended(transaction_id, seed))`. Para operaciones sobre un comercio (reversas y payouts): `SELECT id FROM merchants WHERE id = $1 FOR NO KEY UPDATE` para serializar sin deadlocks con FK KEY SHARE. El worker usa `FOR UPDATE SKIP LOCKED` para múltiples workers.

**A8. ¿Qué medidas tomaste para seguridad?**
Firma con HMAC-SHA256 comparada en tiempo constante, validación estricta con Ajv, anti-replay con ventana temporal, API keys hasheadas con SHA-256, aislamiento por comercio, errores 500 sin filtrar detalles internos, headers sensibles redactados en logs, body limit 64KB.

**A9. ¿Por qué usar migraciones versionadas y no `synchronize` del ORM?**
Para tener control explícito del esquema, reproducibilidad, versionado y evitar cambios inesperados al arrancar. Las migraciones son SQL inmutables ejecutadas por un runner propio.

**A10. ¿Qué decisiones tomaste cuando algo no estaba especificado?**
- Al insertar con `ON CONFLICT` en webhooks, si llega duplicado con contenido distinto se conserva el primero y se responde 200 (para evitar reintentos del PSP).
- En reversas sin crédito previo se actualiza el estado pero no se genera movimiento (edge case defensivo).
- Para payouts, hash canónico solo por `amount` para mayor determinismo.
- Límite de movimientos paginados acotado a 100.
- Truncado de comisiones siempre a favor del comercio (integer division).

## Parte B

**B1. Payouts - ¿Cómo garantizaste idempotencia y saldo no negativo?**
Header `Idempotency-Key` requerido. Advisory lock por clave de idempotencia. Si ya existe con mismo hash se devuelve respuesta original (200), si mismo key con body distinto se devuelve 409. Para ejecutar: `FOR NO KEY UPDATE` sobre merchant, se recalcula saldo con `SUM(amount_cents)`, si insuficiente 422, se crea payout y movimiento en ledger en la misma transacción. Concurrencia serializada evita saldo negativo.

**B4. Observabilidad - ¿Qué implementaste?**
Rutas de observabilidad con health check, métricas básicas y endpoint admin para reprocesar eventos fallidos (ver `src/routes/observability.js`).
