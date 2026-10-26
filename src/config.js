import fs from 'node:fs';
import path from 'node:path';

// Carga las variables de .env al process.env si el archivo existe
export function cargarEnv() {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return;
    const contenido = fs.readFileSync(envPath, 'utf8');
    for (const linea of contenido.split(/\r?\n/)) {
      const trimmed = linea.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const indiceIgual = trimmed.indexOf('=');
      if (indiceIgual > 0) {
        const clave = trimmed.slice(0, indiceIgual).trim();
        let valor = trimmed.slice(indiceIgual + 1).trim();
        if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
          valor = valor.slice(1, -1);
        }
        if (process.env[clave] === undefined) {
          process.env[clave] = valor;
        }
      }
    }
  } catch {}
}

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
  cargarEnv();
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
