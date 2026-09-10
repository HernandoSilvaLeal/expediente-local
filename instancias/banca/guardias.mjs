// instancias/banca/guardias.mjs — G6..G8, LAS GUARDIAS DE DOMINIO.
//
// ═══════════════════════════════════════════════════════════════════════════
//   Estas SÍ saben qué es un banco. Por eso viven aquí y no en core/.
// ═══════════════════════════════════════════════════════════════════════════
//
// El núcleo es genérico: le pregunta al esquema qué esperaba. Estas cuatro no:
// llevan dentro reglas de negocio de admisión bancaria en Panamá. Separarlas es
// lo que permite que el mismo `core/` sirva para inventario hospitalario sin
// arrastrar la cédula panameña.
//
// ── ⚠️ SOBRE EL «DÍGITO VERIFICADOR» ───────────────────────────────────────
//
// El plan de este proyecto anunciaba una guardia de **dígito verificador de la
// cédula panameña**, descrita como «aritmética pura». **No se ha implementado, y
// es deliberado.**
//
// Al ir a escribirla no encontramos algoritmo ni fuente oficial: a diferencia de
// otros países, **el Tribunal Electoral de Panamá no publica un dígito de control
// verificable en el número de cédula**. Inventar una aritmética que suene creíble
// habría producido una guardia que:
//
//   · rechaza cédulas válidas de personas reales, y
//   · se anuncia en cámara ante un jurado panameño que sabe que eso no existe.
//
// Se prefiere una guardia más modesta y CIERTA a una impresionante y falsa. Lo
// que sí se valida —y atrapa errores de OCR de verdad— es la ESTRUCTURA: la
// provincia tiene que existir, los prefijos son un conjunto cerrado, y el tomo y
// el asiento tienen rangos. Un OCR que lee un «8» como «0» produce una provincia
// que no existe, y eso se ve.
//
// Si aparece el algoritmo con fuente oficial, se añade aquí y se dice de dónde
// salió. Hasta entonces, en el README y en el video se dice «validación
// estructural», no «dígito verificador».
//
// PROHIBIDO aquí: importar @qvac/sdk.

import { normalizar, numerosDe } from '../../core/anclaje.mjs'
import { rutaGenerica } from '../../core/esquema.mjs'

export const RECHAZO_BANCA = Object.freeze({
  CEDULA_MAL_FORMADA:   'CEDULA_MAL_FORMADA',
  PROVINCIA_INEXISTENTE: 'PROVINCIA_INEXISTENTE',
  DOCUMENTO_VENCIDO:    'DOCUMENTO_VENCIDO',
  FECHA_IMPOSIBLE:      'FECHA_IMPOSIBLE',
  ARITMETICA_INCOHERENTE: 'ARITMETICA_INCOHERENTE'
})

// ═══════════════════════════════════════════════════════════════════════════
//  G6 · LA CÉDULA PANAMEÑA — validación ESTRUCTURAL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Las provincias y comarcas de Panamá, numeradas 1..13.
 *
 * Es un DATO, y va con su nombre a propósito: cuando la guardia rechaza un «15»,
 * puede decir «no existe la provincia 15» en vez de «formato inválido», y eso es
 * la diferencia entre un error que se arregla y uno que se ignora.
 */
export const PROVINCIAS = Object.freeze({
  1: 'Bocas del Toro', 2: 'Coclé', 3: 'Colón', 4: 'Chiriquí', 5: 'Darién',
  6: 'Herrera', 7: 'Los Santos', 8: 'Panamá', 9: 'Veraguas',
  10: 'Guna Yala', 11: 'Emberá-Wounaan', 12: 'Ngäbe-Buglé', 13: 'Panamá Oeste'
})

/**
 * Prefijos que sustituyen al número de provincia. Conjunto CERRADO.
 *
 * Un prefijo que no esté aquí es un error de lectura, no una variante exótica:
 * si algún día aparece uno legítimo que falte, se añade a esta tabla con su
 * significado, y no se relaja la comprobación.
 */
export const PREFIJOS = Object.freeze({
  PE: 'panameño nacido en el extranjero',
  E:  'extranjero residente',
  N:  'naturalizado',
  AV: 'menor de edad'
})

/**
 * ¿Es esta cédula estructuralmente posible?
 *
 * Formatos admitidos:
 *   8-123-456        provincia-tomo-asiento
 *   13-45-6789
 *   PE-123-456       prefijo-tomo-asiento
 *   8-NT-1-234       tomo especial (NT, PI, AV…)
 *
 * @returns {{valida:boolean, motivo?:string, detalle?:string, provincia?:string}}
 */
export function validarCedula (cedula) {
  const c = String(cedula ?? '').trim().toUpperCase().replace(/\s+/g, '')
  if (!c) return { valida: false, motivo: RECHAZO_BANCA.CEDULA_MAL_FORMADA, detalle: 'está vacía' }

  const partes = c.split('-')
  if (partes.length < 2 || partes.length > 4) {
    return { valida: false, motivo: RECHAZO_BANCA.CEDULA_MAL_FORMADA,
             detalle: `"${cedula}" no tiene la forma provincia-tomo-asiento` }
  }

  const cabeza = partes[0]

  // Rama 1 · prefijo de letras
  if (/^[A-Z]+$/.test(cabeza)) {
    if (!Object.hasOwn(PREFIJOS, cabeza)) {
      return { valida: false, motivo: RECHAZO_BANCA.CEDULA_MAL_FORMADA,
               detalle: `"${cabeza}" no es un prefijo de cédula panameña (${Object.keys(PREFIJOS).join(', ')})` }
    }
  } else {
    // Rama 2 · número de provincia
    if (!/^\d{1,2}$/.test(cabeza)) {
      return { valida: false, motivo: RECHAZO_BANCA.CEDULA_MAL_FORMADA,
               detalle: `"${cabeza}" no es un número de provincia` }
    }
    const n = Number(cabeza)
    if (!Object.hasOwn(PROVINCIAS, n)) {
      // ESTE es el rechazo que atrapa errores de OCR de verdad: leer un 8 como
      // un 0, o un 1 como un 7, produce una provincia que no existe.
      return { valida: false, motivo: RECHAZO_BANCA.PROVINCIA_INEXISTENTE,
               detalle: `no existe la provincia ${n} en Panamá (van de 1 a 13)` }
    }
  }

  // El resto: tomo y asiento, con tomos especiales admitidos en medio.
  const cola = partes.slice(1)
  for (const [i, p] of cola.entries()) {
    const esUltimo = i === cola.length - 1
    if (/^\d{1,6}$/.test(p)) continue
    if (!esUltimo && /^[A-Z]{1,3}$/.test(p)) continue     // tomo especial: NT, PI, AV…
    return { valida: false, motivo: RECHAZO_BANCA.CEDULA_MAL_FORMADA,
             detalle: `"${p}" no es un tomo ni un asiento válido` }
  }

  return {
    valida: true,
    provincia: /^\d+$/.test(cabeza) ? PROVINCIAS[Number(cabeza)] : PREFIJOS[cabeza]
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  G7 · COHERENCIA TEMPORAL
// ═══════════════════════════════════════════════════════════════════════════

const MESES = Object.freeze({
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12
})

/**
 * Interpreta una fecha en español o en formato numérico. Devuelve `null` si no
 * la entiende — y `null` es una respuesta honesta: G7 no rechaza lo que no supo
 * leer, porque rechazar por no entender convierte una guardia en un obstáculo.
 */
export function interpretarFecha (texto) {
  const t = String(texto ?? '').toLowerCase().trim()
  if (!t) return null

  // "12 de marzo de 2026"
  const conNombre = /(\d{1,2})\s*de\s*([a-záéíóú]+)\s*de\s*(\d{4})/.exec(normalizar(t))
  if (conNombre) {
    const mes = MESES[conNombre[2]]
    if (mes) return fechaDe(Number(conNombre[3]), mes, Number(conNombre[1]))
  }
  // "12/03/2026" o "12-03-2026" — día primero, uso latinoamericano
  const numerica = /(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(t)
  if (numerica) return fechaDe(Number(numerica[3]), Number(numerica[2]), Number(numerica[1]))
  // "2026-03-12" — ISO
  const iso = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t)
  if (iso) return fechaDe(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  return null
}

/** Construye la fecha y comprueba que EXISTE: el 31 de febrero no se acepta. */
function fechaDe (anio, mes, dia) {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null
  const d = new Date(Date.UTC(anio, mes - 1, dia))
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    return null                     // 31 de febrero, 30 de febrero, etc.
  }
  return d
}

/**
 * ¿Sigue vigente este documento?
 *
 * `hoy` se INYECTA. Una guardia que llama a `new Date()` por su cuenta produce
 * un resultado distinto mañana con los mismos datos, y entonces el invariante O5
 * —el dataset se regenera idéntico— deja de cumplirse sin que nadie lo note.
 */
export function vigencia (textoFecha, { hoy, diasMaximos = 90 } = {}) {
  if (!hoy) throw new Error('vigencia() necesita `hoy`: la fecha se recibe, no se inventa aquí')

  const f = interpretarFecha(textoFecha)
  if (!f) return { conocida: false, detalle: `no se pudo interpretar la fecha "${textoFecha}"` }

  const dias = Math.floor((hoy - f) / 86400000)

  if (dias < 0) {
    return { conocida: true, vigente: false, dias,
             motivo: RECHAZO_BANCA.FECHA_IMPOSIBLE,
             detalle: `la fecha está ${Math.abs(dias)} días en el FUTURO` }
  }
  if (dias > diasMaximos) {
    return { conocida: true, vigente: false, dias,
             motivo: RECHAZO_BANCA.DOCUMENTO_VENCIDO,
             detalle: `tiene ${dias} días y el máximo para admisión es ${diasMaximos}` }
  }
  return { conocida: true, vigente: true, dias }
}

// ═══════════════════════════════════════════════════════════════════════════
//  G8 · COHERENCIA ARITMÉTICA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ¿Cuadran las cuentas entre documentos?
 *
 * La tolerancia existe porque los documentos reales redondean. Es un dato del
 * esquema, no una constante escondida: distintos productos toleran distinto.
 *
 * NO corrige. Señala. Corregir sería decidir cuál de los dos documentos miente,
 * y eso es exactamente lo que G9 dice que no se hace solo.
 */
export function cuadra (parcial, periodos, total, { toleranciaRelativa = 0.02 } = {}) {
  // Number(null) es 0, y Number('') también. Los dos son finitos, así que una
  // comprobación con Number.isFinite a secas daba por comprobable una cuenta a
  // la que le faltaban datos, y la resolvía con ceros. Es la misma familia de
  // bug que normalizar('$') → cadena vacía: una conversión silenciosa que
  // fabrica un valor válido a partir de nada.
  const crudos = [parcial, periodos, total]
  if (crudos.some(x => x === null || x === undefined || x === '')) {
    return { comprobable: false, detalle: 'faltan números para comprobar la aritmética' }
  }
  const a = Number(parcial), n = Number(periodos), t = Number(total)
  if (![a, n, t].every(Number.isFinite)) {
    return { comprobable: false, detalle: 'alguno de los valores no es un número' }
  }
  const esperado = a * n
  const desvio = Math.abs(esperado - t)
  const relativo = t === 0 ? (esperado === 0 ? 0 : 1) : desvio / Math.abs(t)

  if (relativo > toleranciaRelativa) {
    return {
      comprobable: true, cuadra: false,
      motivo: RECHAZO_BANCA.ARITMETICA_INCOHERENTE,
      detalle: `${a} × ${n} = ${esperado}, y el documento dice ${t} ` +
               `(${(relativo * 100).toFixed(1)} % de desvío, máximo ${(toleranciaRelativa * 100).toFixed(0)} %)`
    }
  }
  return { comprobable: true, cuadra: true, desvio: +desvio.toFixed(2) }
}

// ═══════════════════════════════════════════════════════════════════════════
//  LA TABLA — igual que las de núcleo: un DATO que se puede enumerar
// ═══════════════════════════════════════════════════════════════════════════

export const GUARDIAS_BANCA = Object.freeze([
  Object.freeze({
    id: 'G6', que: 'estructura de la cédula panameña',
    porque: 'un OCR que lee un 8 como un 0 produce una provincia que no existe, y eso se ve',
    aplicar ({ ruta, valor }) {
      if (rutaGenerica(ruta) !== 'titular.cedula') return null
      const r = validarCedula(valor)
      return r.valida ? null : { motivo: r.motivo, detalle: r.detalle }
    }
  }),
  Object.freeze({
    id: 'G7', que: 'vigencia del documento',
    porque: 'un recibo de hace un año no prueba domicilio hoy, y una fecha futura es un error de lectura',
    aplicar ({ ruta, valor, contexto }) {
      if (!/fecha/.test(rutaGenerica(ruta))) return null
      if (!contexto?.hoy) return null              // sin reloj inyectado, G7 se calla
      const r = vigencia(valor, { hoy: contexto.hoy, diasMaximos: contexto.diasMaximos ?? 90 })
      if (!r.conocida || r.vigente) return null
      return { motivo: r.motivo, detalle: r.detalle }
    }
  }),
  Object.freeze({
    id: 'G8', que: 'coherencia aritmética entre documentos',
    porque: 'dos documentos que se contradicen en números no pueden entrar los dos como ciertos',
    aplicar ({ contexto }) {
      const c = contexto?.aritmetica
      if (!c) return null
      const r = cuadra(c.parcial, c.periodos, c.total, c)
      return r.comprobable && !r.cuadra ? { motivo: r.motivo, detalle: r.detalle } : null
    }
  })
  // G9 —conflicto entre fuentes— NO está aquí: vive en core/dedup.mjs, porque
  // comparar dos registros del mismo tipo no es conocimiento de banca. Lo que sí
  // es de banca es qué campo hace de identidad, y eso lo declara el esquema.
])

/** Aplica las guardias de dominio a un campo ya revisado por el núcleo. */
export function revisarDominio (campo, contexto = {}) {
  const rechazos = []
  for (const g of GUARDIAS_BANCA) {
    const r = g.aplicar({ ...campo, contexto })
    if (r) rechazos.push({ guardia: g.id, ...r })
  }
  return Object.freeze(rechazos.map(Object.freeze))
}
