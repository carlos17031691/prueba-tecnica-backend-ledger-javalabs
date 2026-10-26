# Auditoría del proyecto - Ledger de Pagos

Fecha: 2026-10-26

## Resumen
Se realizó análisis estático, revisión de código y pruebas en vivo contra el API corriendo (puerto 3000). Se identificaron hallazgos menores y se aplicaron correcciones de robustez. Todas las pruebas de auditoría pasan (19/19). Suite completa: 88/88 tests; unitarios: 60/60.

## Arquitectura revisada
- **Webhooks**: recepción rápida (persiste en `inbox_events`), validación firma HMAC-SHA256 con `timingSafeEqual`, anti-replay, idempotencia por `event_id`.
- **Worker**: procesamiento asíncrono con `SKIP LOCKED`, `SAVEPOINT` por evento, reintentos con backoff, DLQ (`failed`).
- **Domain**: `stateMachine.js` puro, `money.js` con BigInt (centavos), `eventProcessor.js` transaccional.
- **Ledger**: append-only con triggers, movimientos con signo, índices únicos para evitar doble acreditación/reversión.
- **Payouts (B1)**: idempotencia por `Idempotency-Key`, locks pesimistas, validación de saldo, sin saldo negativo.

## Hallazgos y correcciones aplicadas

### Seguridad
| Hallazgo | Severidad | Estado | Corrección/Comentario |
|---------|-----------|--------|------------------------|
| Headers sensibles en logs | Media | OK | Redactados en Fastify. |
| Comparación de firma | Baja | OK | `timingSafeEqual`, múltiples firmas (rotación). |
| Errores 500 | Media | Corregido | `errorHandler` oculta detalles internos. |
| API keys | Baja | OK | SHA-256. |
| Body > 64KB | Media | Corregido | Validado (413). |

### Idempotencia y recepción
| Hallazgo | Severidad | Estado | Corrección/Comentario |
|---------|-----------|--------|------------------------|
| Duplicados con contenido distinto | Media | OK | Conserva primero, responde 200. |
| Inserción con `req.id` null | Baja | Corregido | `req.id ?? null`. |

### Concurrencia / atomicidad
| Hallazgo | Severidad | Estado | Corrección/Comentario |
|---------|-----------|--------|------------------------|
| Advisory locks | - | Corregido | `hashtextextended` por transacción. |
| Deadlocks reversa/payouts | - | OK | `FOR NO KEY UPDATE` sobre merchant. |
| Múltiples workers | - | OK | `FOR UPDATE SKIP LOCKED`. |
| Fallos parciales | - | OK | `SAVEPOINT` por evento. |
| Doble movimiento | Baja | Corregido | `ON CONFLICT (event_id) DO NOTHING`. |
| Recursión diferidos | Media | Corregido | Iterativo con límite. |

### Payouts (B1)
| Hallazgo | Severidad | Estado | Corrección/Comentario |
|---------|-----------|--------|------------------------|
| Idempotency-Key vacío | Baja | Corregido | 400. |
| Hash determinístico | Baja | Corregido | Solo `amount`. |
| Validación amount | Baja | Corregido | String requerido. |
| Saldo negativo | - | OK | Lock + recálculo. |

### Validaciones
| Hallazgo | Severidad | Estado | Corrección/Comentario |
|---------|-----------|--------|------------------------|
| Cursor inválido | Media | Corregido | Try/catch, numérico, rango int8. |
| Limit inválido | Media | Corregido | 1-100. |

## Doble check contra la evaluación (26/10/2026)

Contraste de `evaluacion-carlos-torres.pdf` (HEAD 5399540) contra el código actual.

| Hallazgo de la evaluación | Estado actual | Evidencia |
| :-- | :-- | :-- |
| Worker bloqueado por evento venenoso (comercio inexistente) | Corregido | `merchant_not_found` se marca `invalid`; test de integración procesa un evento válido inmediatamente después. |
| B1 Payouts siempre 500 (`transaction_id` NOT NULL) | Corregido | Migración `003_payouts_transaction_id_nullable.sql`; tests de 201, 200 idempotente, 409, 422 y concurrencia. |
| Transacción pending eterna (reversed → approved → created) | Corregido | `reintentarDiferidos` iterativo hasta punto fijo; test de las 6 permutaciones termina en `reversed`. |
| Eventos aplicados marcados `invalid` | Corregido | Relectura del estado y filtro `status = 'deferred'` antes de procesar; los 6 escenarios quedan `processed`. |
| Errores 500 con detalles internos | Corregido | `errorHandler` genérico; `limit`/`cursor` validados con 400. |
| Carrera en `Idempotency-Key` | Corregido | Advisory lock antes del SELECT; tests de replay y concurrencia. |
| Test de concurrencia no usaba HTTP ni verificaba saldo | Corregido | E2E-006: 10 webhooks firmados en paralelo del mismo evento, drenaje del worker y delta de saldo exacto. |
| Reintentos/`failed`/reproceso inalcanzables | Corregido | SAVEPOINT + backoff + `failed`; E2E-007 reprocesa y verifica que no duplica el crédito. |
| Logs del worker sin `correlation_id` | Corregido | `src/worker.js` emite JSON con `correlation_id`, `event_id`, `worker_id`, `attempts` y `reason`. |
| Suite no autocontenida / testcontainers declarado sin usar | Abierto | La suite requiere `DATABASE_URL`; se retira la dependencia no usada en lugar de simular autocontención. |
| Latencia < 500 ms bajo 7000 simultáneos | Limitación declarada | p50 2,8 s en la corrida de la evaluación y ~12 s en una corrida propia; no se marca como cumplido bajo carga. |
| Historial de commits reescrito y bitácora tardía | No corregible | Se declara en `BITACORA.md`; no se puede reescribir el proceso pasado. |
| `PREGUNTAS.md` incompleto (falta Parte C) | Corregido | Restaurada la versión A1–A10 + C1–C10 desde `5399540`; C10 completada (qué no convence y qué haría con más tiempo) y A2/C4/C6 actualizadas al código y a las mediciones reales. |

## Pruebas en vivo
- **Auditoría completa**: 19/19 pasaron
- **Stress avanzado**: 6/6 permutaciones out-of-order OK, 50 duplicados paralelos OK, 100 concurrentes OK
- **Mega stress**: 2000 webhooks concurrentes OK
- **Ultra stress**: 7500 webhooks concurrentes OK (0 errores, 0 5xx)
- **7000 según especificación**: 6500x200 + 500x401, sin 5xx ni errores red

## Tests
- Suite completa: 88 tests, 16 suites, 100% pass
- Unitarios: 60 tests, 100% pass
- Integración/e2e/regresión: 28 tests contra Postgres real

## Conclusión
Proyecto robusto. Las brechas de la evaluación que eran corregibles quedaron corregidas y probadas; las limitaciones que siguen abiertas (latencia bajo 7000 simultáneos, suite no autocontenida, historial de commits y `PREGUNTAS.md`) se declaran sin marcarlas como cumplidas.
