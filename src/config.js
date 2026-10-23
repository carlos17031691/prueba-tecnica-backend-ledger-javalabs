// Configuración centralizada. Todo sale de variables de entorno; los secretos nunca se loguean.

function requerida(nombre) {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(`Falta la variable de entorno ${nombre}`);
  }
  return valor;
}

function entero(nombre, porDefecto) {
  const valor = process.env[nombre];
  if (valor === undefined || valor === '') return porDefecto;
  const n = Number.parseInt(valor, 10);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`La variable ${nombre} tiene que ser un entero positivo`);
  }
  return n;
}

export function cargarConfig() {
  return {
    port: entero('PORT', 3000),
    host: process.env.HOST ?? '0.0.0.0',
    logLevel: process.env.LOG_LEVEL ?? 'info',
    databaseUrl: requerida('DATABASE_URL'),
    webhookSecret: requerida('WEBHOOK_SECRET'),
    // Ventana anti-replay del header X-PSP-Timestamp, en segundos.
    webhookToleranciaSeg: entero('WEBHOOK_TOLERANCIA_SEG', 300),
    adminToken: process.env.ADMIN_TOKEN ?? '',
    apiPoolSize: entero('API_DB_POOL_SIZE', 20),
    workerPoolSize: entero('WORKER_DB_POOL_SIZE', 10),
    workerConcurrencia: entero('WORKER_CONCURRENCIA', 8),
    workerMaxIntentos: entero('WORKER_MAX_INTENTOS', 5),
  };
}
