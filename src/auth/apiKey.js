import { createHash } from 'node:crypto';

// Las API keys se guardan como SHA-256. Al autenticar se hashea la key recibida y se busca por hash,
// así la key en claro nunca está en la base.
export function hashApiKey(apiKey) {
  return createHash('sha256').update(apiKey, 'utf8').digest('hex');
}
