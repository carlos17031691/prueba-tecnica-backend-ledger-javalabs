// Dinero en centavos como BigInt. Nada de punto flotante en ningún paso.

const FORMATO_MONTO = /^(0|[1-9]\d{0,14})\.\d{2}$/;

// "999.99" -> 99999n. Solo acepta el formato del PSP: string decimal con exactamente 2 posiciones.
export function parsearMonto(texto) {
  if (typeof texto !== 'string' || !FORMATO_MONTO.test(texto)) {
    throw new Error(`Monto inválido: ${texto}`);
  }
  const [entero, decimales] = texto.split('.');
  return BigInt(entero) * 100n + BigInt(decimales);
}

// 99999n -> "999.99", -97500n -> "-975.00"
export function formatearMonto(centavos) {
  const valor = BigInt(centavos);
  const signo = valor < 0n ? '-' : '';
  const absoluto = valor < 0n ? -valor : valor;
  const entero = absoluto / 100n;
  const decimales = (absoluto % 100n).toString().padStart(2, '0');
  return `${signo}${entero}.${decimales}`;
}

// Comisión en puntos básicos (250 = 2,5 %). La división de BigInt trunca hacia cero,
// así que la comisión se redondea siempre para abajo: a favor del comercio.
//   999,99 al 2,5 %: 99999 * 250 / 10000 = 2499,975 -> 2499 centavos = 24,99
export function calcularComision(brutoCentavos, comisionBps) {
  const bruto = BigInt(brutoCentavos);
  const bps = BigInt(comisionBps);
  if (bruto < 0n) throw new Error('El monto bruto no puede ser negativo');
  if (bps < 0n || bps > 10000n) throw new Error('Comisión fuera de rango');
  const comision = (bruto * bps) / 10000n;
  return { bruto, comision, neto: bruto - comision };
}
