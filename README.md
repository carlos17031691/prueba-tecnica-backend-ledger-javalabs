# Prueba técnica Backend Senior — Ledger de pagos

Construir un servicio backend que recibe notificaciones de pago de un proveedor externo (PSP), las aplica de forma segura sobre un ledger de saldos por comercio y expone el saldo resultante.

El PSP se comporta como uno real: reintenta, manda eventos duplicados, a veces fuera de orden, muchos a la vez, y firma cada request.

## Cómo entregar

1. Hacé un **fork** de este repositorio y trabajá en tu fork.
2. Commiteá de a poco a medida que avanzás. No se acepta un único commit con todo el proyecto.
3. Marcá lo que completaste en [`CHECKLIST.md`](CHECKLIST.md).
4. Escribí `SOLUCION.md`: cómo levantar el proyecto, cómo correr los tests, cómo está organizado el código y la salida de una corrida de `scripts/carga.mjs`. No modifiques este README.
5. Respondé [`PREGUNTAS.md`](PREGUNTAS.md) y completá [`BITACORA.md`](BITACORA.md).
6. Cuando termines, mandá el link de tu fork.

## Condiciones

| Bloque | Tiempo | Carácter |
| --- | --- | --- |
| Parte A — Núcleo | 4 h | Obligatoria |
| Parte B — Extensiones | hasta 4 h | Elegir 2 o más |

- **Duración máxima:** 8 horas en total.
- **Plazo de entrega:** 5 días corridos desde que recibís la prueba.
- **Lenguaje y framework:** libres. Lo que importa es la lógica y que la entiendas. La única condición es exponer la API HTTP descrita abajo, porque los scripts de este repo la usan.
- **Base de datos:** relacional con transacciones. PostgreSQL recomendado; otra opción vale si la justificás.
- **Uso de IA:** permitido solo como asistente para el código, declarando en qué partes se usó. La documentación (`SOLUCION.md`, `PREGUNTAS.md` y `BITACORA.md`) se escribe **sin IA**, con palabras propias.
- **Si algo no está especificado:** tomá una decisión razonable y explicala en `PREGUNTAS.md`.
- **Herramientas para los scripts:** Node.js 18 o superior (solo para correr `scripts/`, no hace falta usarlo en tu solución).

Después de la entrega hay una sesión en vivo de 60 minutos: 20 de recorrido del código y 40 para implementar un cambio chico sobre tu propio repositorio, con pantalla compartida y sin IA.

## Parte A — Núcleo (obligatoria, 4 h)

### 1. Recepción del webhook — `POST /webhooks/psp`

1. Verificar la firma HMAC-SHA256 calculada sobre el **body crudo** (ver [especificación del PSP](#especificación-del-proveedor-psp)). Firma inválida → `401`.
2. Rechazar requests con `X-PSP-Timestamp` a más de 5 minutos del reloj del servidor (anti-replay) → `401`.
3. Responder `200` en menos de 500 ms. Si el procesamiento es pesado, persistir el evento y procesarlo después.

### 2. Idempotencia

1. Cada evento trae un `event_id` único. El mismo evento recibido N veces produce exactamente un efecto sobre el saldo.
2. Un duplicado responde `200` (no error), para que el PSP deje de reintentar.

### 3. Máquina de estados de la transacción

1. Estados: `pending`, `approved`, `rejected`, `reversed`.
2. Transiciones válidas: `pending → approved`, `pending → rejected`, `approved → reversed`.
3. Eventos fuera de orden: si llega `payment.reversed` antes que `payment.approved`, el sistema no debe perder ninguno ni dejar el saldo inconsistente. La estrategia es libre y se documenta.
4. Una transición inválida se registra y no modifica estado ni saldo.

### 4. Ledger de saldos

1. El saldo de un comercio se deriva de movimientos **inmutables** (append-only). No se permite un `UPDATE balance = ...` sin un movimiento que lo respalde.
2. `approved` acredita el **neto**: `monto − comisión`. La comisión es un porcentaje configurado por comercio (ej. 2,5 %).
3. `reversed` debita el mismo neto que se acreditó.
4. Montos con precisión exacta: nada de punto flotante para dinero. La comisión se trunca a 2 decimales, siempre a favor del comercio (ej. 2,5 % de 999,99 = 24,99, no 25,00).

### 5. Consultas

Autenticadas con la API key del comercio en el header `x-api-key`.

1. `GET /merchants/me/balance` → saldo disponible y fecha del último movimiento.
2. `GET /merchants/me/movements` → movimientos paginados por **cursor** (no `offset`), más nuevos primero.
3. `GET /transactions/:id` → estado actual e historial de eventos recibidos. Una transacción inexistente o de otro comercio → `404`.

Los scripts leen estos campos, así que el formato mínimo es obligatorio (se pueden agregar más):

```json
// GET /merchants/me/balance
{ "available": "15600.00", "last_movement_at": "2026-10-23T15:00:31Z" }

// GET /transactions/:id
{ "id": "tx_9f3a21", "status": "approved", "events": [ ... ] }
```

### Requisitos no funcionales

- **Concurrencia:** el mismo evento enviado 10 veces en paralelo acredita una sola vez. Dos eventos distintos de la misma transacción en paralelo (`approved` y `reversed`) terminan en un estado consistente. La garantía tiene que estar en la base de datos (constraint, lock o nivel de aislamiento), no solo en memoria.
- **Atomicidad:** cambio de estado, movimiento de ledger y registro del evento ocurren en una única transacción de base de datos. Si algo falla a mitad de camino, no queda nada a medias.
- **Seguridad:** comparación de firma en tiempo constante, validación estricta del payload, secretos solo por variables de entorno y nunca en logs. Un comercio no puede leer datos de otro.
- **Migraciones:** el esquema se crea con migraciones versionadas, no generado automáticamente por el ORM al arrancar.
- **Tests:**
  - Unitarios para la máquina de estados y el cálculo de comisión.
  - De integración contra la base de datos real (Docker o Testcontainers), no contra mocks.
  - Al menos un test de concurrencia que dispare requests en paralelo y verifique el saldo final.
- **Arranque:** `docker compose up` levanta API + DB y deja el servicio usable con el comercio `m_001` sembrado (comisión 2,5 %, API key en `.env.example`).

### Carga asíncrona y concurrente

El servicio tiene que aguantar **7000 webhooks simultáneos**, asíncronos y concurrentes, sin perder ni duplicar plata. [`scripts/carga.mjs`](scripts/carga.mjs) los dispara todos a la vez contra tu `docker compose up`:

```bash
ulimit -n 20000   # 7000 conexiones abiertas a la vez
WEBHOOK_SECRET=... MERCHANT_API_KEY=... node scripts/carga.mjs
```

Las requests salen en orden aleatorio, así que el `created`, el `approved` y el `reversed` de una misma transacción pueden llegar en cualquier orden:

| Cantidad | Qué envía | Respuesta esperada |
| --- | --- | --- |
| 4000 | `created` + `approved` de 2000 transacciones | `200`, acreditan el neto |
| 1000 | `approved` duplicados (mismo `event_id`) | `200`, sin efecto |
| 1500 | `created` + `approved` + `reversed` de 500 transacciones | `200`, efecto neto cero |
| 300 | `approved` con el monto alterado después de firmar | `401` |
| 200 | `created` con timestamp de hace 10 minutos | `401` |

Resultado esperado:

1. Ninguna respuesta `5xx`, error de conexión ni timeout (30 s por request).
2. Cada request recibe exactamente el status de la tabla.
3. El saldo de `m_001` llega al valor exacto antes de 120 s. El procesamiento puede ser asíncrono: el script espera a que el saldo converja.
4. Una muestra de 50 transacciones está en el estado esperado (`approved`, `reversed` o `404`).

El script también informa latencia (p50, p95, p99) y throughput. Cada corrida usa IDs nuevos, así que se puede repetir sin reiniciar la base.

## Parte B — Extensiones (elegir al menos 2, hasta 4 h)

| Extensión | Qué se pide |
| --- | --- |
| **B1. Payouts** | `POST /payouts` con header `Idempotency-Key`. Debita saldo; si no alcanza → `422`. Dos payouts concurrentes nunca dejan saldo negativo. Misma key con body distinto → `409`. |
| **B2. Notificación al comercio** | Cuando cambia el estado de una transacción, enviar un webhook firmado a la URL del comercio con reintentos y backoff exponencial. Usar patrón **outbox**: el evento se escribe en la misma transacción de base de datos que el cambio de estado. |
| **B3. Conciliación** | Endpoint o comando que recibe un CSV de liquidación del PSP (`event_id,transaction_id,amount,status`) y reporta diferencias: faltantes en el sistema, faltantes en el CSV y montos distintos. El archivo puede tener cientos de miles de filas. |
| **B4. Observabilidad y operación** | Logs estructurados con `correlation_id`, `GET /health` que verifique la DB, métricas básicas (eventos procesados, duplicados, fallidos) y un endpoint de admin para reprocesar un evento fallido. |
| **B5. Rate limiting y hardening** | Rate limit por API key, API keys almacenadas hasheadas, rotación del secreto del webhook sin downtime. |

## Especificación del proveedor (PSP)

Cada request del PSP trae dos headers y un body JSON. La firma se calcula sobre el timestamp y el body crudo, byte a byte, antes de parsearlo. El PSP no garantiza orden de claves ni espaciado en el JSON.

| Header | Ejemplo | Descripción |
| --- | --- | --- |
| `X-PSP-Timestamp` | `1761220800` | Epoch en segundos del envío |
| `X-PSP-Signature` | `v1=5f2c…a91e` | HMAC-SHA256 en hex, prefijado con la versión. Durante una rotación de secreto llegan dos firmas separadas por coma; el request es válido si coincide cualquiera |

```
signature = hex( HMAC_SHA256( WEBHOOK_SECRET, timestamp + "." + rawBody ) )
```

Evento de aprobación:

```json
{
  "event_id": "evt_01JB7Q8M2K",
  "type": "payment.approved",
  "occurred_at": "2026-10-23T14:05:11Z",
  "data": {
    "transaction_id": "tx_9f3a21",
    "merchant_id": "m_001",
    "amount": "15000.00",
    "currency": "ARS"
  }
}
```

Tipos de evento: `payment.created` (crea la transacción en `pending`), `payment.approved`, `payment.rejected`, `payment.reversed`. El campo `amount` llega como string decimal con 2 posiciones. Un evento con moneda distinta de `ARS` se registra y responde `200`, pero no genera movimiento.

### Secuencia que el servicio tiene que soportar

Los eventos están en [`fixtures/eventos/`](fixtures/eventos) y [`scripts/enviar-secuencia.mjs`](scripts/enviar-secuencia.mjs) los envía firmados como lo haría el PSP:

```bash
WEBHOOK_SECRET=... MERCHANT_API_KEY=... node scripts/enviar-secuencia.mjs
```

1. `payment.created` de `tx_9f3a21` por 15.000,00.
2. `payment.approved` de `tx_9f3a21`, enviado 3 veces seguidas con el mismo `event_id`.
3. `payment.created` + `payment.reversed` de `tx_b71c04`, con el `approved` llegando 2 segundos después del `reversed`.
4. `payment.created` + `payment.approved` de `tx_c55e10` por 999,99.
5. Eventos en USD para `m_001`.
6. Un request con el monto alterado en el body después de firmar.
7. Un request con timestamp de hace 10 minutos.

Resultado esperado con comisión de 2,5 %: el saldo de `m_001` es **15.600,00** (14.625,00 + 975,00), `tx_b71c04` termina en `reversed` con efecto neto cero, los eventos en USD no mueven saldo, y los pasos 6 y 7 responden `401` sin tocar la base.
