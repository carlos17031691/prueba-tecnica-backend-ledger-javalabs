# Checklist

Marcá con `[x]` lo que completaste. Si algo quedó a medias, dejalo sin marcar y agregá una nota corta al lado.

## Parte A — Núcleo (obligatoria)

### Proyecto y arranque
- [ ] Lenguaje, framework y base de datos elegidos y justificados en `PREGUNTAS.md`
- [ ] `docker compose up` levanta API + DB sin pasos manuales
- [ ] Migraciones versionadas (el ORM no genera el esquema al arrancar)
- [ ] Seed del comercio `m_001` con comisión 2,5 % y API key
- [ ] `.env.example` con todas las variables necesarias

### Webhook `POST /webhooks/psp`
- [ ] Firma HMAC-SHA256 calculada sobre el body crudo
- [ ] Soporte del prefijo `v1=` y de dos firmas durante una rotación
- [ ] Comparación de firma en tiempo constante
- [ ] Rechazo por timestamp fuera de la ventana de 5 minutos
- [ ] Respuesta en menos de 500 ms

### Idempotencia
- [ ] Un mismo `event_id` produce un solo efecto
- [ ] Un duplicado responde `200`
- [ ] La garantía está en la base de datos, no solo en memoria

### Máquina de estados
- [ ] Estados y transiciones válidas implementados
- [ ] Transiciones inválidas registradas sin tocar estado ni saldo
- [ ] Eventos fuera de orden resueltos sin perder ninguno

### Ledger
- [ ] Movimientos inmutables (append-only)
- [ ] Saldo derivado de los movimientos
- [ ] `approved` acredita el neto
- [ ] `reversed` debita el neto acreditado
- [ ] Montos con precisión exacta (sin punto flotante)
- [ ] Comisión truncada a 2 decimales a favor del comercio
- [ ] Eventos en moneda distinta de ARS registrados sin movimiento

### Consultas
- [ ] Autenticación por `x-api-key`
- [ ] `GET /merchants/me/balance`
- [ ] `GET /merchants/me/movements` con paginación por cursor
- [ ] `GET /transactions/:id` con historial de eventos
- [ ] Un comercio no puede ver datos de otro

### Consistencia
- [ ] Estado, movimiento y registro del evento en una sola transacción de DB
- [ ] 10 envíos paralelos del mismo evento acreditan una sola vez
- [ ] `approved` y `reversed` en paralelo terminan en estado consistente

### Tests
- [ ] Unitarios de la máquina de estados
- [ ] Unitarios del cálculo de comisión (incluido el caso 999,99)
- [ ] Integración contra la base de datos real
- [ ] Test de concurrencia con requests en paralelo
- [ ] `scripts/enviar-secuencia.mjs` termina con saldo 15.600,00

### Carga asíncrona y concurrente (7000 webhooks simultáneos)
- [ ] `scripts/carga.mjs` termina con `Carga completa sin fallas.`
- [ ] Sin `5xx`, errores de conexión ni timeouts
- [ ] Saldo exacto después de procesar todo
- [ ] Eventos de una misma transacción en cualquier orden resueltos bien
- [ ] Pool de conexiones a la DB dimensionado y justificado
- [ ] Salida de una corrida incluida en `SOLUCION.md`
- [ ] Diagrama de arquitectura en `PREGUNTAS.md` (A1)

## Parte B — Extensiones (al menos 2)

### B1. Payouts
- [ ] `POST /payouts` con `Idempotency-Key`
- [ ] Saldo insuficiente → `422`
- [ ] Misma key con body distinto → `409`
- [ ] Payouts concurrentes nunca dejan saldo negativo

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
- [ ] Logs estructurados con `correlation_id`
- [ ] `GET /health` que verifica la DB
- [ ] Métricas de eventos procesados, duplicados y fallidos
- [ ] Reproceso de un evento fallido sin doble acreditación

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
