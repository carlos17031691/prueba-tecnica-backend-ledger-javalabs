import { createHmac, timingSafeEqual } from 'node:crypto';

// Verificación de los webhooks del PSP.
//   signature = hex( HMAC_SHA256( WEBHOOK_SECRET, timestamp + "." + rawBody ) )
// El header X-PSP-Signature trae "v1=<hex>". Durante una rotación de secreto trae dos firmas
// separadas por coma y alcanza con que coincida cualquiera.

const FIRMA_V1 = /^v1=([0-9a-f]{64})$/i;
const TIMESTAMP = /^\d{1,12}$/;

export function calcularFirma(secreto, timestamp, rawBody) {
  return createHmac('sha256', secreto).update(`${timestamp}.`).update(rawBody).digest();
}

// Devuelve los digests (Buffer de 32 bytes) de las firmas v1 del header. Ignora versiones desconocidas.
export function parsearHeaderFirma(header) {
  if (typeof header !== 'string' || header.length === 0 || header.length > 1024) return [];
  const firmas = [];
  for (const parte of header.split(',')) {
    const match = FIRMA_V1.exec(parte.trim());
    if (match) firmas.push(Buffer.from(match[1], 'hex'));
  }
  return firmas;
}

// rawBody tiene que ser el Buffer tal cual llegó, antes de parsear el JSON.
// secretos es una lista para poder aceptar el secreto actual y el anterior si en algún momento se rota del lado nuestro.
export function firmaValida({ secretos, timestamp, header, rawBody }) {
  const recibidas = parsearHeaderFirma(header);
  if (recibidas.length === 0) return false;

  let valida = false;
  for (const secreto of secretos) {
    const esperada = calcularFirma(secreto, timestamp, rawBody);
    for (const recibida of recibidas) {
      // timingSafeEqual compara en tiempo constante (ambos buffers miden 32 bytes por el regex).
      // No se corta en el primer acierto, para no filtrar por tiempo cuál de las firmas coincidió.
      if (timingSafeEqual(esperada, recibida)) valida = true;
    }
  }
  return valida;
}

// Anti-replay: el timestamp tiene que estar a lo sumo toleranciaSeg del reloj del servidor (hacia atrás o adelante).
export function timestampValido(timestamp, ahoraSeg, toleranciaSeg) {
  if (typeof timestamp !== 'string' || !TIMESTAMP.test(timestamp)) return false;
  return Math.abs(ahoraSeg - Number(timestamp)) <= toleranciaSeg;
}
