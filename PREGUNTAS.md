# Preguntas

Respondé cada pregunta debajo de ella, **sin IA**, en primera persona y con tus palabras. Respuestas cortas: entre 3 y 8 líneas cada una. Nombrá los componentes, tablas, archivos o funciones de tu solución; una respuesta genérica que podría servir para cualquier proyecto no alcanza.

Todas estas preguntas se retoman en la sesión en vivo.

## Arquitectura

### A1. Dibujá la arquitectura de tu solución (ASCII o imagen en el repo): componentes, qué llama a qué y dónde se persiste cada cosa. ¿Por qué esa separación?

Respuesta:

PSP / Merchant  ──HTTP──>  API (Fastify en src/app.js)
                                        │ (INSERT idempotente)
                                        ▼
                            PostgreSQL: inbox_events
                                        ▲
                                        │ (FOR UPDATE SKIP LOCKED)
                            Worker (src/worker.js)
                                        │ (1 transacción atómica)
                                        ▼
                        transactions + ledger_movements (append-only)

• Por qué la separación: La API desacopla la recepción rápida para responder 200 al PSP y absorber ráfagas masivas sin saturar la lógica de negocio. El worker procesa de
  fondo garantizando consistencia.

### A2. ¿Procesás el webhook dentro del request o de forma asíncrona? ¿Qué ganás y qué perdés con esa decisión?

Respuesta:

Asíncrono. La API solo valida firma/formato e inserta en inbox_events.
• Qué ganás: Respuesta rápida con carga normal (p95 ~9 ms en recepción) y tolerancia a ráfagas de 7.000 requests concurrentes sin agotar timeouts.
• Qué perdés: Consistencia eventual momentánea (el saldo tarda unos segundos en reflejarse tras recibir el webhook; con el worker al día convergió en ~2 s). Con 7.000 simultáneos la recepción sube a un p50 de ~2,8 s (y hasta ~12 s en una corrida propia) porque el INSERT en inbox_events es síncrono: no cumple "< 500 ms" bajo esa carga.

### A3. ¿Cómo garantizás que un evento tenga exactamente un efecto, de punta a punta (recepción, cola si la hay, procesamiento)? ¿En qué capa vive esa garantía y por qué ahí?

Respuesta:

• Vive en la base de datos, no en memoria.
• En la entrada: Primary Key en inbox_events.event_id con ON CONFLICT DO UPDATE que solo suma duplicados sin reinsertar.
• En el procesamiento: Cada transacción se procesa bajo pg_advisory_xact_lock(hashtext(transaction_id)) y en ledger_movements existe un índice único UNIQUE (transaction_id, kind) y UNIQUE (event_id).

### A4. ¿Cómo modelaste el ledger? ¿Qué tablas hay, cuál es la fuente de verdad del saldo y qué costo tiene derivarlo de movimientos?

Respuesta:

• Tablas: inbox_events, transactions y ledger_movements.
• Fuente de verdad: ledger_movements (inmutable, con triggers que impiden UPDATE, DELETE y TRUNCATE).
• No existe columna balance. El saldo es COALESCE(SUM(amount_cents), 0).
• Costo: Es O(N) movimientos por comercio, pero optimizado con un índice compuesto (merchant_id, id DESC) INCLUDE (amount_cents). Para escalar a millones de filas se usarían snapshots periódicos o
  tablas de balance acumulado.

### A5. Con 7000 eventos concurrentes del mismo comercio, ¿dónde se serializa tu sistema? ¿Es un problema? ¿Cómo lo escalarías?

Respuesta:

• Se serializa a nivel transacción, no a nivel comercio, gracias a pg_advisory_xact_lock(hashtext(transaction_id)). Múltiples transacciones distintas del mismo comercio corren en paralelo sin
  bloquearse.
• Solo en POST /payouts se serializa por comercio (SELECT id FROM merchants FOR UPDATE) para evitar saldos negativos.
• Para escalar: particionamiento de workers por rango de hash de merchant_id o sharding de base de datos.

### A6. ¿Cómo resolviste los eventos fuera de orden? ¿Qué pasa si el evento que falta nunca llega?

Respuesta:

• Implementado con estado deferred en la máquina de estados (src/domain/stateMachine.js). Si llega un approved o reversed de una transacción que aún no tiene su created, o un reversed antes del
  approved, el evento se guarda como deferred.
• Cuando el worker procesa el evento faltante, ejecuta de inmediato reintentarDiferidos() sobre esa misma transaction_id.
• Si el evento nunca llega: queda en estado deferred en inbox_events, visible en /metrics, sin afectar el saldo ni corromper el estado.

### A7. Si el proceso muere a mitad de procesar un evento, ¿en qué estado queda todo y cómo se recupera?

Respuesta:

• Atomicidad de DB: todo el cambio (actualización de transactions, inserción en ledger_movements y cambio a processed en inbox_events) corre dentro de una sola transacción SQL (BEGIN ... COMMIT).
• Si el proceso muere, Postgres hace ROLLBACK automático liberando el lock.
• El evento sigue con estado received en inbox_events, y cualquier worker libre lo retoma automáticamente mediante FOR UPDATE SKIP LOCKED.

### A8. ¿Qué cambia si el servicio corre en varias réplicas detrás de un balanceador? ¿Qué parte de tu diseño dejaría de funcionar?

Respuesta:

• Nada deja de funcionar. El diseño es stateless: no guarda memoria local.
• La idempotencia, la cola de trabajo (FOR UPDATE SKIP LOCKED) y la exclusión mutua (pg_advisory_xact_lock) residen 100% en PostgreSQL.

### A9. Si el tráfico creciera 100 veces, ¿qué se rompe primero y cómo cambiaría la arquitectura?

Respuesta:

• Se rompería primero el pool de conexiones de Postgres y el throughput de escritura en el disco de la tabla inbox_events.
• Cambios de arquitectura: Reemplazar el inbox en Postgres por un bus de eventos distribuido (Kafka o RabbitMQ) con particionado por merchant_id o transaction_id, e implementar checkpoints/snapshots
  periódicos para el cálculo del saldo en el ledger.

### A10. Si este servicio tuviera que pasar una auditoría SOC 2 Type II, ¿qué agregarías a nivel de arquitectura?

Respuesta:

• Agregar: Cifrado en reposo (TDE) de la base de datos, cifrado de campos sensibles (PII), auditoría inmutable de accesos de lectura/escritura (pgAudit), rotación automática de llaves KMS, pipeline
  de CI/CD con escaneo de vulnerabilidades y separación estricta de roles IAM en base de datos, entre otras.

## Construcción

### C1. ¿Qué lenguaje, framework y librerías elegiste y por qué? ¿Qué descartaste?

Respuesta:

• Node.js 20 con Fastify y PostgreSQL nativo (pg).
• Por qué: Fastify ofrece el mejor rendimiento para I/O asíncrono y acceso nativo al body crudo sin middlewares complejos. pg permite control total sobre SQL, transacciones y advisory locks sin la
  sobrecarga ni la magia de un ORM.
• Descartados: Express (más lento y complejo para raw bodies con streaming) y ORMs como Prisma/TypeORM (ocultan el control de locks transaccionales y aislamiento de concurrencia).

### C2. ¿Cómo representás los montos en la base y en el código? Mostrá paso a paso el cálculo de la comisión para un pago de 999,99.

Respuesta:

• Montos representados en centavos como enteros BIGINT en PostgreSQL y BigInt en JavaScript (nunca Number ni punto flotante).
• Cálculo para 999,99 con comisión 2,5 % (250 puntos básicos):
  1. Bruto: 999.99 → 99.999 centavos.
  2. Comisión: (99999 × 250)/10000 = 2499975/10000 = 2499 centavos (la división entera trunca hacia abajo, dando 24,99).
  3. Neto acreditado: 99999 - 2499 = 97500 centavos = 975,00

### C3. ¿Cómo implementaste la verificación de firma? ¿En qué orden validás firma, timestamp e idempotencia, y por qué ese orden?

Respuesta:

• Se calcula HMAC-SHA256 con el WEBHOOK_SECRET sobre ${timestamp}.${rawBody} y se compara usando crypto.timingSafeEqual para prevenir ataques de temporización.
• Orden: 1° Timestamp (anti-replay 5 min), 2° Firma HMAC, 3° Parsing JSON y validación de esquema, 4° Idempotencia e inserción en DB.
• Por qué: Rechaza requests maliciosas o vencidas inmediatamente en CPU sin gastar memoria en parsear JSON ni hacer consultas a la base de datos.

### C4. ¿Qué constraint, lock o nivel de aislamiento evita la doble acreditación? Mostrá el SQL o el fragmento de código.

Respuesta:

• Código: En src/domain/eventProcessor.js se usa:
  SELECT pg_advisory_xact_lock(hashtextextended($1, 131542391)) con transaction_id.
• Base de datos: Constraint UNIQUE en ledger_movements (transaction_id, kind) y inbox_events (event_id PK).

### C5. ¿Qué números te dio `scripts/carga.mjs` (throughput, p95, segundos hasta que el saldo convergió)? ¿Qué recurso se saturó primero, cómo lo detectaste y qué ajustaste (pool de conexiones, workers, índices)?

Respuesta:

• Throughput: ~500 req/s (14,0 s para las 7.000 requests).
• Latencias: p50: 8.940 ms, p95: 12.108 ms, p99: 12.383 ms, máx: 12.443 ms.
• Convergencia del saldo: 2,0 segundos de espera.
• Recurso: La cola de sockets del sistema operativo. Se ajustó backlog: 8192 en Fastify y net.core.somaxconn: 8192 en Docker Compose.

### C6. ¿Cómo probaste la concurrencia en tus tests? ¿Qué te asegura que el test no pasa por casualidad?

Respuesta:

• En test/e2e/e2e.test.js (E2E-006) se mandan 10 requests HTTP firmadas en paralelo con el mismo event_id, pasando por webhook, inbox y worker. Se verifica que las 10 respondan 200, que solo una inserción sea original (las otras 9 dan duplicate=true), que se drene la cola y que el saldo final tenga el delta exacto con un único movimiento de crédito.
• En test/integration/integration.test.js también se dispara approved y reversed concurrentemente sobre la misma tx comprobando que el estado final fue reversed y el efecto neto en el ledger fue cero.
• Lo que asegura que no pasa por casualidad: la garantía está en la PK de inbox_events, el advisory lock por transaction_id y los UNIQUE de ledger_movements; el test mira el resultado en la base y el saldo por API, no solo el código de respuesta.

### C7. ¿Cómo implementaste la paginación por cursor? ¿Qué problema concreto evita frente a `offset` en una tabla de movimientos?

Respuesta:

• Implementado con id < $cursor ORDER BY id DESC LIMIT $limit donde el cursor es el ID del último movimiento codificado en Base64.
• Problema que evita frente a offset: Evita la degradación de rendimiento en tablas masivas (O(N) scans en offsets altos) y evita duplicados o saltos de registros cuando ingresan nuevos movimientos
  concurrentes durante la lectura.

### C8. ¿Cómo evitás que un comercio lea datos de otro?

Respuesta:

• Autenticación obligatoria mediante header x-api-key (hasheada en DB). En todos los queries de consulta (/merchants/me/..., /transactions/:id) se inyecta siempre la cláusula WHERE merchant_id =
  $auth_merchant_id. Si una transacción pertenece a otro comercio, la consulta retorna 404 Not Found.

### C9. ¿Qué casos del enunciado te parecieron ambiguos o no especificados? ¿Qué decidiste en cada uno?

Respuesta:

• Eventos fuera de orden donde approved/reversed llega antes de created: se difieren (deferred) hasta que llegue el created.
• Moneda distinta de ARS (ej. USD): se registra el evento y la transacción cambia de estado, pero no genera movimiento contable.
• Evento con mismo event_id pero cuerpo alterado: gana el primero, se responde 200 y se loguea un warning.

### C10. ¿Qué extensiones de la Parte B elegiste y por qué? ¿Qué parte de tu solución no te convence y qué harías con más tiempo?

Respuesta:

• Elegí B1 (Payouts) porque obliga a resolver idempotencia, locks y saldo no negativo sobre el mismo ledger. Implementación: bloqueo FOR UPDATE sobre el comercio, validación de Idempotency-Key (409 ante payloads distintos) y débito atómico (422 si saldo insuficiente).
• Elegí B4 (Observabilidad) porque sin health, métricas y reproceso no se puede operar un worker asíncrono. Implementación: /health con ping a DB, /metrics con contadores, endpoint de admin para reprocesar eventos failed y correlation_id en headers, en los logs de la API y en los logs JSON del worker.
• Qué no me convence: la latencia bajo 7.000 simultáneos (p50 ~2,8 s), el saldo calculado con SUM O(N), la suite dependiente de una DB externa y la falta de rate limiting y rotación de secreto sin downtime.
• Con más tiempo: insert por lotes o cola en memoria con flush para bajar la latencia, snapshots de saldo, suite autocontenida con testcontainers, rate limiting por API key, rotación de secreto sin downtime y completar B2/B3.