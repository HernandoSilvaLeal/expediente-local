// core/dedup.mjs — ¿este expediente ya existe?
//
// ═══════════════════════════════════════════════════════════════════════════
//   Si dos documentos discrepan, NO se elige uno y NO se promedia.
//   Se marca, y decide una persona.
// ═══════════════════════════════════════════════════════════════════════════
//
// Es la guardia G9, y es la que un jurado de banca entiende sin explicación:
// promediar dos fuentes que se contradicen **fabrica un dato que nadie dijo**.
// Elegir «la mejor» es una decisión de riesgo disfrazada de detalle técnico.
//
// ── POR QUÉ NO HAY EMBEDDINGS AQUÍ ─────────────────────────────────────────
//
// Porque casi nunca hacen falta. Un expediente bancario tiene una CLAVE NATURAL
// —la cédula— y comparar dos cédulas normalizadas es exacto, instantáneo y
// explicable. Los embeddings entran solo cuando no hay clave, y entonces viven
// en `ia/`, no aquí.
//
// El corpus tiene medido el peligro de lo contrario: el máximo de similitud
// legítima observado fue **0,3702**. Cualquier umbral absoluto por debajo de eso
// junta expedientes de personas distintas, y por encima no junta nada. Por eso,
// cuando haya que usarlos, será `argmax` contra candidatos — nunca un umbral.
//
// PROHIBIDO aquí: importar @qvac/sdk. Verificado por scripts/verificar-frontera.mjs

import { normalizar } from './anclaje.mjs'
import { rutaGenerica } from './esquema.mjs'

/** Por qué dos expedientes se consideran (o no) el mismo. Enum cerrado. */
export const VEREDICTO = Object.freeze({
  DUPLICADO:      'DUPLICADO',       // misma clave natural, sin contradicciones
  EN_CONFLICTO:   'EN_CONFLICTO',    // misma clave natural, PERO discrepan → G9
  DISTINTO:       'DISTINTO',        // claves distintas
  INDECIDIBLE:    'INDECIDIBLE'      // no hay clave en uno de los dos
})

/**
 * La clave natural de un expediente, según el esquema.
 *
 * El esquema declara `clave_natural`. Si no la declara, se usa el primer campo
 * crítico. Y si tampoco hay críticos, no hay clave: `null`, que es un resultado
 * honesto y no un fallo.
 */
export function claveDe (expediente, esquema) {
  const rutas = esquema?.claveNatural?.length
    ? esquema.claveNatural
    : (esquema?.camposCriticos ?? []).slice(0, 1)

  if (!rutas.length) return null

  const partes = []
  for (const ruta of rutas) {
    const campo = buscarPorRutaGenerica(expediente, ruta)
    // Un campo que no ancló NO sirve de clave. Deduplicar por un dato que el
    // sistema rechazó sería usar como identidad justo lo que no se pudo probar.
    if (!campo || campo.valor === null || campo.valor === undefined) return null
    partes.push(normalizar(String(campo.valor)))
  }
  const clave = partes.join('|')
  return clave.trim() ? clave : null
}

function buscarPorRutaGenerica (expediente, ruta) {
  const campos = expediente?.campos ?? {}
  if (campos[ruta]) return campos[ruta]
  for (const [k, v] of Object.entries(campos)) {
    if (rutaGenerica(k) === ruta) return v
  }
  return null
}

/**
 * Compara dos expedientes ya proyectados.
 *
 * NO fusiona. NO elige. Devuelve un veredicto y, si hay conflicto, la lista
 * exacta de campos que discrepan — que es lo que una persona necesita ver para
 * poder decidir en diez segundos en vez de en diez minutos.
 */
export function comparar (a, b, esquema) {
  const claveA = claveDe(a, esquema)
  const claveB = claveDe(b, esquema)

  if (claveA === null || claveB === null) {
    return veredicto(VEREDICTO.INDECIDIBLE,
      'al menos uno de los dos no tiene clave natural anclada')
  }
  if (claveA !== claveB) {
    return veredicto(VEREDICTO.DISTINTO, 'las claves naturales no coinciden')
  }

  // Misma clave. Ahora la pregunta de verdad: ¿se contradicen en algo?
  const discrepancias = []
  const coincidencias = []

  for (const [ruta, ca] of Object.entries(a.campos ?? {})) {
    const cb = b.campos?.[ruta]
    if (!cb) continue                            // que falte no es contradecir
    if (normalizar(String(ca.valor)) === normalizar(String(cb.valor))) {
      coincidencias.push(ruta)
    } else {
      discrepancias.push(Object.freeze({
        ruta,
        a: ca.valor, citaA: ca.cita, evidenciaA: ca.evidencia,
        b: cb.valor, citaB: cb.cita, evidenciaB: cb.evidencia
      }))
    }
  }

  if (discrepancias.length) {
    return veredicto(VEREDICTO.EN_CONFLICTO,
      `misma clave natural pero ${discrepancias.length} campo(s) se contradicen`,
      { coincidencias, discrepancias })
  }
  return veredicto(VEREDICTO.DUPLICADO,
    'misma clave natural y ninguna contradicción', { coincidencias, discrepancias })
}

function veredicto (que, razon, extra = {}) {
  return Object.freeze({
    veredicto: que,
    razon,
    coincidencias: Object.freeze(extra.coincidencias ?? []),
    discrepancias: Object.freeze((extra.discrepancias ?? []).map(Object.freeze)),
    // Un conflicto NUNCA se resuelve solo. Es política de riesgo, no técnica.
    exigeHumano: que === VEREDICTO.EN_CONFLICTO
  })
}

/**
 * Busca el duplicado de un candidato entre los existentes.
 *
 * Devuelve el PRIMER duplicado o conflicto encontrado, en orden. Es determinista
 * porque recorre en el orden en que se le da la lista, y quien la da la ordena.
 *
 * @returns {{id, veredicto, razon, discrepancias}|null}
 */
export function buscarDuplicado (candidato, existentes, esquema) {
  for (const otro of existentes) {
    if (otro.id === candidato.id) continue
    const r = comparar(candidato, otro, esquema)
    if (r.veredicto === VEREDICTO.DUPLICADO || r.veredicto === VEREDICTO.EN_CONFLICTO) {
      return Object.freeze({ id: otro.id, ...r })
    }
  }
  return null
}

/**
 * Agrupa expedientes por clave natural.
 *
 * Los que no tienen clave van a `sinClave`, y eso es información: son los que
 * un operador tiene que mirar, no basura que se tira.
 */
export function agrupar (expedientes, esquema) {
  const grupos = new Map()
  const sinClave = []

  for (const e of expedientes) {
    const k = claveDe(e, esquema)
    if (k === null) { sinClave.push(e.id); continue }
    if (!grupos.has(k)) grupos.set(k, [])
    grupos.get(k).push(e.id)
  }

  // Ordenado por clave Y por id dentro de cada grupo. Lo segundo se me había
  // olvidado y su test lo cazó: sin ello, dos dispositivos con los mismos
  // expedientes recibidos en distinto orden producían agrupamientos distintos,
  // que es exactamente lo que rompe la convergencia de la malla.
  const salida = {}
  for (const k of [...grupos.keys()].sort()) {
    salida[k] = Object.freeze([...grupos.get(k)].sort())
  }

  return Object.freeze({
    grupos: Object.freeze(salida),
    sinClave: Object.freeze(sinClave.sort()),
    conDuplicados: Object.freeze(
      Object.entries(salida).filter(([, ids]) => ids.length > 1).map(([k]) => k))
  })
}
