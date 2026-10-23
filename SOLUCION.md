1. Cómo levantar el proyecto:
  cp .env.example .env
  docker compose up --build -d
(El servicio levanta la base de datos PostgreSQL, corre las migraciones, siembra a m_001 con comisión del 2,5 % y levanta la API en el puerto 3000 y el worker en segundo plano).

2. Cómo correr los tests:
  • Tests unitarios: npm run test:unit
  • Tests de integración y concurrencia: npm run test:integration
  • Suite completa: npm test
  • Script de secuencia:
    WEBHOOK_SECRET=cambiar-por-un-secreto-largo MERCHANT_API_KEY=mk_test_m001_cambiar 
    node scripts/enviar-secuencia.mjs
  • Script de carga (7.000 webhooks):
    ulimit -n 20000
    WEBHOOK_SECRET=cambiar-por-un-secreto-largo MERCHANT_API_KEY=mk_test_m001_cambiar 
    node scripts/carga.mjs

3. Organización del código:
  • src/domain/: Lógica pura de negocio (money.js, stateMachine.js) y procesador transaccional (eventProcessor.js).
  • src/webhooks/: Validación de firmas HMAC, anti-replay, esquema Ajv y ruta receptora del webhook.
  • src/routes/: Rutas de consultas (queries.js), extensión B1 (payouts.js) y extensión B4 (observability.js).
  • src/db/: Pool de PostgreSQL, runner de migraciones SQL y script de seed.
  • src/worker.js: Proceso en segundo plano que consume eventos con SKIP LOCKED.
  • migrations/: Archivos SQL versionados inmutables.
  • test/: Tests unitarios y de integración.

4. Salida real de scripts/carga.mjs:
  Corrida 2d280d6e: 7000 requests a http://localhost:3000, concurrencia 7000
    
  Respuestas por status: { '200': 6500, '401': 500 }
  Duración 14.0 s, 499 req/s
  Latencia p50 8940 ms, p95 12108 ms, p99 12383 ms, máx 12443 ms
    
  OK   Sin respuestas 5xx                                   0 con 5xx
  OK   Sin errores de red ni timeouts                       0 errores (si son EMFILE, subir ulimit -n)
  OK   Cada request con el status esperado (200 o 401)      0 distintos
  OK   Saldo exacto en menos de 120 s                       esperado 8862574.50, actual 8862574.50, 2.0 s de espera
  OK   Muestra de 50 transacciones en el estado esperado    0 distintas

  Carga completa sin fallas.