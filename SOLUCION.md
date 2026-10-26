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
