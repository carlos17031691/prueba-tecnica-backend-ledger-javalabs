// Máquina de estados de una transacción. Función pura: no toca la base.
//
//   pending ──approved──▶ approved ──reversed──▶ reversed
//      └─────rejected──▶ rejected
//
// Dado el estado actual de la transacción (o null si todavía no existe) y un evento, devuelve qué hacer:
//   crear        -> payment.created de una transacción nueva: se crea en pending
//   transicionar -> cambio de estado válido, con el efecto sobre el ledger (acreditar / debitar / ninguno)
//   diferir      -> el evento llegó antes de tiempo (fuera de orden); se guarda y se reintenta
//                   cuando se aplique otro evento de la misma transacción
//   invalido     -> transición imposible; se registra y no modifica estado ni saldo

export const ESTADOS = Object.freeze(['pending', 'approved', 'rejected', 'reversed']);
export const TIPOS_EVENTO = Object.freeze([
  'payment.created',
  'payment.approved',
  'payment.rejected',
  'payment.reversed',
]);

// Única moneda del ledger. Los eventos en otra moneda cambian estado pero no generan movimiento.
export const MONEDA_LEDGER = 'ARS';

const TRANSICIONES = {
  pending: { 'payment.approved': 'approved', 'payment.rejected': 'rejected' },
  approved: { 'payment.reversed': 'reversed' },
  rejected: {},
  reversed: {},
};

// Eventos que pueden volverse válidos más adelante si llega el evento que falta.
// reversed sobre pending: falta el approved.
const ESPERAN = {
  pending: ['payment.reversed'],
};

const EFECTO = {
  approved: 'acreditar',
  reversed: 'debitar',
  rejected: null,
};

export function decidir(transaccion, evento) {
  if (!TIPOS_EVENTO.includes(evento.type)) {
    return { accion: 'invalido', motivo: 'unknown_event_type' };
  }

  if (transaccion === null) {
    if (evento.type === 'payment.created') return { accion: 'crear', nuevoEstado: 'pending' };
    // approved/rejected/reversed antes del created: hay que esperarlo.
    return { accion: 'diferir', motivo: 'transaction_not_created_yet' };
  }

  // Un evento tiene que coincidir con la transacción a la que apunta.
  if (evento.merchant_id !== transaccion.merchant_id) return { accion: 'invalido', motivo: 'merchant_mismatch' };
  if (evento.currency !== transaccion.currency) return { accion: 'invalido', motivo: 'currency_mismatch' };
  if (BigInt(evento.amount_cents) !== BigInt(transaccion.amount_cents)) {
    return { accion: 'invalido', motivo: 'amount_mismatch' };
  }

  if (evento.type === 'payment.created') return { accion: 'invalido', motivo: 'transaction_already_exists' };

  const destino = TRANSICIONES[transaccion.status]?.[evento.type];
  if (destino) {
    const efecto = transaccion.currency === MONEDA_LEDGER ? EFECTO[destino] : null;
    return { accion: 'transicionar', nuevoEstado: destino, efecto };
  }

  if (ESPERAN[transaccion.status]?.includes(evento.type)) {
    return { accion: 'diferir', motivo: `${evento.type}_before_approved` };
  }

  return { accion: 'invalido', motivo: `invalid_transition_${transaccion.status}_to_${evento.type}` };
}
