# Auditoría del proyecto - Ledger de Pagos

Fecha: 2026-10-26

## Resumen
Se realizó análisis estático, revisión de código y pruebas en vivo contra el API corriendo (puerto 3000). Se identificaron hallazgos menores y se aplicaron correcciones de robustez. Todas las pruebas de auditoría pasan (19/19). Tests unitarios pasan (75/75).

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

## Pruebas en vivo
- **Auditoría completa**: 19/19 pasaron
- **Stress avanzado**: 6/6 permutaciones out-of-order OK, 50 duplicados paralelos OK, 100 concurrentes OK
- **Mega stress**: 2000 webhooks concurrentes OK
- **Ultra stress**: 7500 webhooks concurrentes OK (0 errores, 0 5xx)
- **7000 según especificación**: 6500x200 + 500x401, sin 5xx ni errores red

## Tests unitarios
- 75 tests, 18 suites, 100% pass

## Conclusión
Proyecto robusto, cumple requisitos. Todas las recomendaciones aplicadas.
