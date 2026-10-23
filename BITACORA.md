# Bitácora

Completala **sin IA** a medida que trabajás, no al final. Un bloque por cada hora de trabajo: qué hiciste, dónde te trabaste y cómo lo resolviste.

## Bloques

Bloque | Fecha y hora            | Qué hice                                                        | Dónde me trabé
--------|-------------------------|-----------------------------------------------------------------|-----------------------------------------------------------------
    1   | 2026-10-2311:25 a 12:25 | Lectura y análisis de requisitos. Setup del proyecto con        | 1. Docker no estaba iniciado en el sistema al intentar probar
        |                         | Node.js, Fastify y Postgres. Diseño de base de datos con ledger | migraciones; se levantó el daemon localmente.2. Un .gitignore
        |                         | inmutable y runner de migraciones SQL. Implementación de        | global ignoraba *.sql, impidiendo commitear la migración de
        |                         | cálculo de comisión en BigInt (truncado a favor del comercio) y | payouts; se agregó !migrations/*.sql al .gitignore del
        |                         | máquina de estados pura con manejo de eventos fuera de orden    | proyecto.3. El worker demoraba 200 ms en sondeo cuando no había
        |                         | (deferred). Verificación de firmas HMAC sobre body crudo con    | eventos, lo que generaba un retraso mínimo en la secuencia; se
        |                         | soporte de rotación y anti-replay. Creación de endpoints        | ajustó a 20 ms, logrando que el saldo converja en 2 s en la
        |                         | (/webhooks/psp, /merchants/me/balance, /merchants/me/movements  | prueba de 7000 eventos.
        |                         | por cursor, /transactions/:id, /payouts y /health / /metrics).  |
        |                         | Implementación de worker asíncrono con FOR UPDATE SKIP LOCKED.  |
        |                         | Empaquetado en Docker Compose y validación con enviar-          |
        |                         | secuencia.mjs y prueba de carga con 7.000 webhooks simultáneos. |
--------|-------------------------|-----------------------------------------------------------------|-----------------------------------------------------------------
    2   | 2026-10-2312:25 a 12:45 | Creación de la suite de tests de integración                    | 1. El puerto 5432 estaba ocupado por un servicio local de
        |                         | (test/integration/integration.test.js) contra PostgreSQL real.  | PostgreSQL en la máquina host, impidiendo a los tests conectar
        |                         | Implementación de pruebas de concurrencia simulando 10 requests | a la DB del contenedor; se expuso el puerto 54329 para la
        |                         | paralelas del mismo evento y carreras entre approved y          | conexión directa desde los tests.2. Durante el test de
        |                         | reversed. Verificación de aislamiento entre comercios y         | concurrencia de approved y reversed en paralelo, el worker en
        |                         | paginación por cursor. Corrección del mapeo de puertos de       | segundo plano de Docker Compose intentaba competir por procesar
        |                         | Postgres en Compose para evitar colisiones con instancias       | los mismos eventos de prueba provocando un deadlock
        |                         | locales. Ejecución de la suite completa de 55 tests con 100% de | transaccional; se aisló la prueba configurando next_attempt_at
        |                         | éxito.                                                          | en el futuro lejano para que solo el test controle la
        |                         |                                                                 | ejecución.


• Tiempo total: 1 hora 20 minutos.

## Declaración de uso de IA

Completarla es obligatorio.

• Herramientas usadas: Asistente AI (Antigravity).
• En qué archivos o tareas: Generación de código JavaScript (src/), esquemas SQL (migrations/), configuración de Docker (Dockerfile, docker-compose.yml) y tests (test/).
• Qué generó la IA que tuviste que corregir: La sugerencia inicial intentó usar Java por el nombre del repo ("javalabs"), lo cual corregí para usar JavaScript como permite el README. También se corrigió
  la regla de exclusión de archivos .sql y la calibración del sondeo en el worker.
