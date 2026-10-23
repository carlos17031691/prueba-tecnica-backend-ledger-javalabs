# Preguntas

Respondé cada pregunta debajo de ella, **sin IA**, en primera persona y con tus palabras. Respuestas cortas: entre 3 y 8 líneas cada una. Nombrá los componentes, tablas, archivos o funciones de tu solución; una respuesta genérica que podría servir para cualquier proyecto no alcanza.

Todas estas preguntas se retoman en la sesión en vivo.

## Arquitectura

### A1. Dibujá la arquitectura de tu solución (ASCII o imagen en el repo): componentes, qué llama a qué y dónde se persiste cada cosa. ¿Por qué esa separación?

Respuesta:

### A2. ¿Procesás el webhook dentro del request o de forma asíncrona? ¿Qué ganás y qué perdés con esa decisión?

Respuesta:

### A3. ¿Cómo garantizás que un evento tenga exactamente un efecto, de punta a punta (recepción, cola si la hay, procesamiento)? ¿En qué capa vive esa garantía y por qué ahí?

Respuesta:

### A4. ¿Cómo modelaste el ledger? ¿Qué tablas hay, cuál es la fuente de verdad del saldo y qué costo tiene derivarlo de movimientos?

Respuesta:

### A5. Con 7000 eventos concurrentes del mismo comercio, ¿dónde se serializa tu sistema? ¿Es un problema? ¿Cómo lo escalarías?

Respuesta:

### A6. ¿Cómo resolviste los eventos fuera de orden? ¿Qué pasa si el evento que falta nunca llega?

Respuesta:

### A7. Si el proceso muere a mitad de procesar un evento, ¿en qué estado queda todo y cómo se recupera?

Respuesta:

### A8. ¿Qué cambia si el servicio corre en varias réplicas detrás de un balanceador? ¿Qué parte de tu diseño dejaría de funcionar?

Respuesta:

### A9. Si el tráfico creciera 100 veces, ¿qué se rompe primero y cómo cambiaría la arquitectura?

Respuesta:

### A10. Si este servicio tuviera que pasar una auditoría SOC 2 Type II, ¿qué agregarías a nivel de arquitectura?

Respuesta:

## Construcción

### C1. ¿Qué lenguaje, framework y librerías elegiste y por qué? ¿Qué descartaste?

Respuesta:

### C2. ¿Cómo representás los montos en la base y en el código? Mostrá paso a paso el cálculo de la comisión para un pago de 999,99.

Respuesta:

### C3. ¿Cómo implementaste la verificación de firma? ¿En qué orden validás firma, timestamp e idempotencia, y por qué ese orden?

Respuesta:

### C4. ¿Qué constraint, lock o nivel de aislamiento evita la doble acreditación? Mostrá el SQL o el fragmento de código.

Respuesta:

### C5. ¿Qué números te dio `scripts/carga.mjs` (throughput, p95, segundos hasta que el saldo convergió)? ¿Qué recurso se saturó primero, cómo lo detectaste y qué ajustaste (pool de conexiones, workers, índices)?

Respuesta:

### C6. ¿Cómo probaste la concurrencia en tus tests? ¿Qué te asegura que el test no pasa por casualidad?

Respuesta:

### C7. ¿Cómo implementaste la paginación por cursor? ¿Qué problema concreto evita frente a `offset` en una tabla de movimientos?

Respuesta:

### C8. ¿Cómo evitás que un comercio lea datos de otro?

Respuesta:

### C9. ¿Qué casos del enunciado te parecieron ambiguos o no especificados? ¿Qué decidiste en cada uno?

Respuesta:

### C10. ¿Qué extensiones de la Parte B elegiste y por qué? ¿Qué parte de tu solución no te convence y qué harías con más tiempo?

Respuesta:
