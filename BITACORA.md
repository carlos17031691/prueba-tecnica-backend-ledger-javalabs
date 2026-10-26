# Bitácora

Completala **sin IA** a medida que trabajás, no al final. Un bloque por cada hora de trabajo: qué hiciste, dónde te trabaste y cómo lo resolviste.

## Bloques

### Bloque 1 - Setup, arquitectura y núcleo
| Fecha | Duración | Actividad |
| :-- | :-- | :-- |
| 23/10/2026 | 1h 00m | Lectura y análisis de requisitos. Setup del proyecto con Node.js, Fastify y Postgres. Diseño de base de datos con ledger inmutable y runner de migraciones SQL. Implementación de cálculo de comisión en BigInt (truncado a favor del comercio) y máquina de estados pura con manejo de eventos fuera de orden (deferred). Verificación de firmas HMAC sobre body crudo con soporte de rotación y anti-replay. Creación de endpoints (/webhooks/psp, /merchants/me/balance, /merchants/me/movements por cursor, /transactions/:id, /payouts y /health). Implementación de worker asíncrono con FOR UPDATE SKIP LOCKED. Empaquetado en Docker Compose y validación con enviar-secuencia.mjs y prueba de carga con 7.000 webhooks simultáneos. |

**Dónde me trabé:** Docker no estaba iniciado al intentar probar. Un .gitignore global ignoraba *.sql, impidiendo commitear la migración de payouts; se agregó !migrations/*.sql al .gitignore del proyecto. El worker demoraba 200 ms en sondeo cuando no había eventos, se ajustó a 20 ms logrando convergencia en 2 s.

### Bloque 2 - Tests de integración y concurrencia
| Fecha | Duración | Actividad |
| :-- | :-- | :-- |
| 23/10/2026 | 20m | Creación de la suite de tests de integración (test/integration/integration.test.js) contra PostgreSQL real. Implementación de pruebas de concurrencia simulando 10 requests paralelas del mismo evento y carreras entre approved y reversed. Verificación de aislamiento entre comercios y paginación por cursor. Corrección del mapeo de puertos de Postgres en Compose para evitar colisiones con instancias locales. Ejecución de la suite completa con 100% de éxito. |

**Dónde me trabé:** Puerto 5432 ocupado por PostgreSQL local; se expuso puerto 54329 para tests. El worker en segundo plano competía por procesar eventos de prueba provocando deadlocks; se aisló la prueba configurando next_attempt_at en el futuro lejano.

### Bloque 3 - Documentación técnica y respuestas
| Fecha | Duración | Actividad |
| :-- | :-- | :-- |
| 23/10/2026 | 40m | Análisis detallado de las respuestas arquitectónicas y de construcción para PREGUNTAS.md. Revisión y actualización de CHECKLIST.md marcando los ítems de la Parte A y extensiones B1 y B4. Consolidación de los datos reales de rendimiento (500 req/s, latencias y tiempos de convergencia) para documentar en SOLUCION.md. Commits incrementales de seguimiento de documentación. |

**Dónde me trabé:** Ningún bloqueo técnico mayor; foco en sintetizar las decisiones de diseño (locks de Postgres, serialización con pg_advisory_xact_lock, inmutabilidad del ledger con triggers y manejo de eventos diferidos) para responder con claridad y concisión.

• Tiempo total: 2 horas.

### Bloque 4 - Análisis de evaluación, correcciones, doble check Parte B, pruebas avanzadas, hardening SonarQube y transparencia
| Fecha | Duración | Actividad |
| :-- | :-- | :-- |
| 26/10/2026 | 1h 00m | Análisis de la evaluación y contraste de todos los hallazgos (worker bloqueado por comercio inexistente, B1 roto, diferidos eternos, reintentos/failed, latencias, historial de commits, checklist inflado) contra mi propio repositorio. Identificación de qué aplica y qué ya estaba correctamente implementado. |
| 26/10/2026 | 1h 00m | Aplicación de correcciones por recomendación de la evaluación: `reintentarDiferidos` refactorizado a iterativo (sin recursión), uso de `hashtextextended` en advisory locks, `ON CONFLICT DO NOTHING` en `ledger_movements`, endurecimiento de validaciones, mejora del `errorHandler`, validación de body size 64KB, hardening en worker/payouts. |
| 26/10/2026 | 30m    | Doble check de la Parte B (B1 Payouts y B4 Observabilidad) levantando el proyecto con `docker compose up` contra el API real. Validación de idempotencia, locks, 409/422/400/201 y protección contra saldo negativo. |
| 26/10/2026 | 30m    | Creación de batería de pruebas propia: auditoría completa (19/19), pruebas de permutaciones out-of-order (6/6), idempotencia con 50 duplicados en paralelo, stress con 2000 y 7500 webhooks concurrentes. Test de 7000 siguiendo la especificación exacta (6500x200 + 500x401) sin 5xx ni errores de red. Validación de latencias, throughput y convergencia. |
| 26/10/2026 | 30m    | Creación de `DECLARACION_DE_TRANSPARENCIA_IA.md` con desglose honesto del uso de IA por actividad. Creación/actualización de `AUDITORIA.md`. Actualización de `SOLUCION.md`. Commit de cambios manteniendo `PREGUNTAS.md` y `BITACORA.md` en su formato original. |
| 26/10/2026 | 40m    | Hardening para pasar SonarCloud Quality Gate: conversión de `scripts/test-payouts-completo.sh` a `.mjs`. Dockerfile con `COPY` selectivo solo de `src/` y `migrations/`, ejecución con usuario `node`, añadido `--ignore-scripts`. `docker-compose.yml` con `POSTGRES_PASSWORD` vía variable de entorno. `src/worker.js` con `void loopWorker(i)`. `scripts/carga.mjs` reemplazando `Math.random()` por `crypto.randomBytes()`. Sanitización de logs con `String()` en `scripts/enviar-secuencia.mjs` y `scripts/test-payouts-completo.mjs`. Corrección de `test/unit/webhooks-signature-extra.test.js` añadiendo assertion faltante. Actualización de `.dockerignore`. Eliminación de scripts de stress redundantes del tracking (`scripts/stress-*.mjs`, `scripts/test-7000-completo.mjs`, `scripts/auditoria-completa.mjs`, `scripts/stress-avanzado.mjs`). |

• Tiempo total: 4h 10m.

### Bloque 5 - Doble check contra la evaluación y cierre de brechas
| Fecha | Duración | Actividad |
| :-- | :-- | :-- |
| 26/10/2026 | 1h 00m | Lectura completa de la evaluación (`evaluacion-carlos-torres.pdf`) y contraste hallazgo por hallazgo contra el código actual. Verificación de lo ya corregido (worker venenoso, B1, diferidos, invalid, errores 500, carrera de idempotencia) y de lo que seguía abierto. Añadidos tests HTTP reales: 10 webhooks firmados en paralelo del mismo evento con verificación del saldo exacto (E2E-006) y reproceso admin de un evento `failed` sin doble acreditación (E2E-007). Logs del worker convertidos a JSON estructurado con `correlation_id`, `event_id`, `worker_id`, `attempts` y `reason`. Ajuste honesto de `CHECKLIST.md`: "< 500 ms" con nota de latencia bajo carga, concurrencia por HTTP, reproceso probado y B5 API keys hasheadas. Restauración de `PREGUNTAS.md` a la versión completa A1–A10 + C1–C10 y finalización de C10 (qué no convence y qué haría con más tiempo). Actualización de `SOLUCION.md` y `AUDITORIA.md` con brechas abiertas y evidencia. `npm test`: 88/88. |

• Tiempo total: 1h 00m.

## Declaración de uso de IA

Completarla es obligatorio.

• Herramientas usadas: Asistente AI (Antigravity y, en el doble check del 26/10, un agente de código).
• En qué archivos o tareas: Generación de código JavaScript (src/), esquemas SQL (migrations/), configuración de Docker (Dockerfile, docker-compose.yml) y tests (test/). Además auditoría, correcciones de robustez, scripts de stress y documentación. En el doble check final: tests E2E-006/E2E-007, logs estructurados del worker y ajustes de documentación.
• Qué generó la IA que tuviste que corregir: La sugerencia inicial intentó usar Java por el nombre del repo ("javalabs"), lo cual corregí para usar JavaScript como permite el README. También se corrigió la regla de exclusión de archivos .sql y la calibración del sondeo en el worker. En la evaluación se detectaron bugs que el código generado no ejecutaba; el doble check del 26/10 verificó cada uno contra el repositorio antes de marcarlo.
• Transparencia detallada: Ver [`DECLARACION_DE_TRANSPARENCIA_IA.md`](DECLARACION_DE_TRANSPARENCIA_IA.md) para el desglose honesto por actividad, nivel de uso y alcance.
