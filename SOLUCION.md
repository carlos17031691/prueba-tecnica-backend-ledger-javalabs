1. Cómo levantar el proyecto:
   cp .env.example .env
   docker compose up --build -d

2. Cómo correr los tests:
   • Tests unitarios: npm run test:unit
   • Tests de integración y concurrencia: npm run test:integration
   • Suite completa: npm test
   • Script de secuencia: WEBHOOK_SECRET=... MERCHANT_API_KEY=... node scripts/enviar-secuencia.mjs
   • Script de carga (7.000): ulimit -n 20000 && WEBHOOK_SECRET=... MERCHANT_API_KEY=... node scripts/carga.mjs

3. Organización del código:
   • src/domain/: money.js, stateMachine.js, eventProcessor.js
   • src/webhooks/: signature.js, payload.js, routes.js
   • src/routes/: queries.js, payouts.js, observability.js
   • src/worker.js: procesamiento asíncrono con SKIP LOCKED y SAVEPOINTs
   • migrations/: SQL versionadas
   • test/: unitarios, integración, regresión, e2e
   • scripts/: auditoría y stress tests

4. Mejoras aplicadas:
   • reintentarDiferidos iterativo sin recursión
   • Advisory locks con hashtextextended
   • ON CONFLICT en ledger_movements
   • Validaciones estrictas
   • Error handler seguro
   • Body limit 64KB

5. Pruebas de stress ejecutadas:
   • 7500 webhooks concurrentes: 7500/7500 OK, 0 5xx, 0 errores
   • Test 7000 según especificación: 6500x200 + 500x401
   • Todas las permutaciones out-of-order: OK
   • Idempotencia con 50 duplicados paralelos: OK
   • Latencia: sin carga p95 ~9 ms; con 7000 simultáneos el p50 medido estuvo entre 2,8 s y ~12 s según la corrida. No se cumple "< 500 ms" bajo esa carga: el cuello es el INSERT síncrono en `inbox_events`, no la validación de firma.

6. Suite de tests (88 tests):
   • `npm test` usa la DB indicada por `DATABASE_URL`; la suite no es autocontenida (no se usa testcontainers).
   • e2e incluye concurrencia por HTTP (10 webhooks firmados en paralelo del mismo evento + saldo exacto) y reproceso admin de un evento `failed` sin doble acreditación.
   • El worker emite logs JSON con `correlation_id`, `event_id`, `worker_id`, `attempts` y `reason`.

7. Doble check contra la evaluación (26/10/2026):
   • Corregidos: worker bloqueado por evento venenoso, B1 payout 500, transacción pending eterna, eventos aplicados marcados `invalid`, 500 con detalles internos y carrera de `Idempotency-Key`.
   • Verificados con tests: payouts 201/200/409/422 y concurrencia, reintentos con SAVEPOINT hasta `failed`, reproceso admin, 6 permutaciones out-of-order, 10 webhooks HTTP en paralelo.
   • Abiertos y declarados sin marcar como cumplidos: latencia < 500 ms bajo 7000 simultáneos, snapshots de saldo, rate limiting, rotación de secreto sin downtime, historial de commits y `PREGUNTAS.md` completo.
