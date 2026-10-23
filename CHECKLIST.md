# Checklist

Marcá con `[x]` lo que completaste. Si algo quedó a medias, dejalo sin marcar y agregá una nota corta al lado.

## Parte A — Núcleo (obligatoria)

### Proyecto y arranque
- [X] Lenguaje, framework y base de datos elegidos y justificados en `PREGUNTAS.md`
- [X] `docker compose up` levanta API + DB sin pasos manuales
- [X] Migraciones versionadas (el ORM no genera el esquema al arrancar)
- [X] Seed del comercio `m_001` con comisión 2,5 % y API key
- [X] `.env.example` con todas las variables necesarias

### Webhook `POST /webhooks/psp`
- [X] Firma HMAC-SHA256 calculada sobre el body crudo
- [X] Soporte del prefijo `v1=` y de dos firmas durante una rotación
- [X] Comparación de firma en tiempo constante
- [X] Rechazo por timestamp fuera de la ventana de 5 minutos
- [X] Respuesta en menos de 500 ms

### Idempotencia
- [X] Un mismo `event_id` produce un solo efecto
- [X] Un duplicado responde `200`
- [X] La garantía está en la base de datos, no solo en memoria

### Máquina de estados
- [X] Estados y transiciones válidas implementados
- [X] Transiciones inválidas registradas sin tocar estado ni saldo
- [X] Eventos fuera de orden resueltos sin perder ninguno

### Ledger
- [X] Movimientos inmutables (append-only)
- [X] Saldo derivado de los movimientos
- [X] `approved` acredita el neto
- [X] `reversed` debita el neto acreditado
- [X] Montos con precisión exacta (sin punto flotante)
- [X] Comisión truncada a 2 decimales a favor del comercio
- [X] Eventos en moneda distinta de ARS registrados sin movimiento

### Consultas
- [X] Autenticación por `x-api-key`
- [X] `GET /merchants/me/balance`
- [X] `GET /merchants/me/movements` con paginación por cursor
- [X] `GET /transactions/:id` con historial de eventos
- [X] Un comercio no puede ver datos de otro

### Consistencia
- [X] Estado, movimiento y registro del evento en una sola transacción de DB
- [X] 10 envíos paralelos del mismo evento acreditan una sola vez
- [X] `approved` y `reversed` en paralelo terminan en estado consistente

### Tests
- [X] Unitarios de la máquina de estados
- [X] Unitarios del cálculo de comisión (incluido el caso 999,99)
- [X] Integración contra la base de datos real
- [X] Test de concurrencia con requests en paralelo
- [X] `scripts/enviar-secuencia.mjs` termina con saldo 15.600,00

### Carga asíncrona y concurrente (7000 webhooks simultáneos)
- [X] `scripts/carga.mjs` termina con `Carga completa sin fallas.`
- [X] Sin `5xx`, errores de conexión ni timeouts
- [X] Saldo exacto después de procesar todo
- [X] Eventos de una misma transacción en cualquier orden resueltos bien
- [X] Pool de conexiones a la DB dimensionado y justificado
- [X] Salida de una corrida incluida en `SOLUCION.md`
- [X] Diagrama de arquitectura en `PREGUNTAS.md` (A1)

## Parte B — Extensiones (al menos 2)

### B1. Payouts
- [X] `POST /payouts` con `Idempotency-Key`
- [X] Saldo insuficiente → `422`
- [X] Misma key con body distinto → `409`
- [X] Payouts concurrentes nunca dejan saldo negativo

### B2. Notificación al comercio
- [ ] Tabla outbox escrita en la misma transacción que el cambio de estado
- [ ] Worker que despacha el outbox
- [ ] Webhook firmado hacia el comercio
- [ ] Reintentos con backoff exponencial y límite de intentos

### B3. Conciliación
- [ ] Lectura del CSV en streaming
- [ ] Reporte de faltantes en el sistema
- [ ] Reporte de faltantes en el CSV
- [ ] Reporte de montos distintos

### B4. Observabilidad y operación
- [X] Logs estructurados con `correlation_id`
- [X] `GET /health` que verifica la DB
- [X] Métricas de eventos procesados, duplicados y fallidos
- [X] Reproceso de un evento fallido sin doble acreditación

### B5. Rate limiting y hardening
- [ ] Rate limit por API key
- [ ] API keys almacenadas hasheadas
- [ ] Rotación del secreto del webhook sin downtime

## Documentación (sin IA)
- [ ] `SOLUCION.md`: cómo levantar, cómo testear, organización del código
- [ ] `PREGUNTAS.md` respondido completo
- [ ] `BITACORA.md` con bloques de una hora y tiempo total
- [ ] Declaración de uso de IA en `BITACORA.md`
- [ ] Historial de commits chicos e incrementales
