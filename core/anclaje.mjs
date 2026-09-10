// core/anclaje.mjs — LA REGLA DE ORO.
//
// ═══════════════════════════════════════════════════════════════════════════
//   El modelo no puede alucinar una cita que el software va a buscar
//   con indexOf.
// ═══════════════════════════════════════════════════════════════════════════
//
// El esquema obliga al modelo a devolver, por cada campo, un objeto {valor, cita}.
// Aquí se comprueba que esa cita EXISTE LITERALMENTE en el texto de origen.
// Si no existe, el campo no entra al expediente: queda en DESCONOCIDO.
//
// No es una heurística ni un umbral de confianza inventado. Es `indexOf` sobre
// texto normalizado. Es determinista, es auditable, y se puede enseñar en cámara.
//
// ── POR QUÉ EXISTE ESTE ARCHIVO ────────────────────────────────────────────
//
// Medido en esta máquina el 9-sep-2026, con MedPsy 1.7B y json_schema:
//
//   Entrada: "tres resonadores magnéticos Siemens y un tomógrafo.
//             UNO de los resonadores parece de unos ocho años"
//
//   Salida sin anclaje:
//     · MRI x3 con antiguedad: 8      → la edad se propagó a los TRES
//     · CT x1 con fabricante Siemens  → la marca saltó al tomógrafo
//     · confianza: "Confirmado"       → "parece" es Estimado, no Confirmado
//
//   Tres errores. JSON perfectamente válido. Factualmente falso.
//
// El modelo garantiza la FORMA. Nunca el FONDO.
//
// PROHIBIDO aquí: importar @qvac/sdk. Verificado por scripts/verificar-frontera.mjs

import { EVIDENCIA, nivelEvidencia } from './esquema.mjs'

/** Motivos por los que un campo puede quedar sin anclar. Enum cerrado: el rechazo es un DATO. */
export const MOTIVO = Object.freeze({
  ANCLADO:        'ANCLADO',          // la cita existe en la fuente
  SIN_CITA:       'SIN_CITA',         // el modelo no devolvió cita
  CITA_AUSENTE:   'CITA_AUSENTE',     // la cita NO aparece en la fuente → invención
  VALOR_AUSENTE:  'VALOR_AUSENTE',    // hay cita, pero el valor no está en ella
  VALOR_VACIO:    'VALOR_VACIO'       // no hay valor que anclar
})

/** Marcadores de incertidumbre en español. Un campo anclado a uno de estos es ESTIMADO, no Confirmado. */
export const ATENUADORES = Object.freeze([
  'parece', 'parecen', 'creo', 'como', 'aproximadamente', 'aprox', 'más o menos',
  'mas o menos', 'alrededor', 'cerca de', 'unos', 'unas', 'quizá', 'quiza',
  'quizás', 'quizas', 'tal vez', 'talvez', 'posiblemente', 'probablemente',
  'diría', 'diria', 'no estoy seguro', 'creo que', 'sobre', 'casi'
])

/** Marcadores de certeza. Solo con uno de estos un campo puede llegar a Confirmado. */
export const AFIRMADORES = Object.freeze([
  'exactamente', 'confirmado', 'verificado', 'según el documento', 'segun el documento',
  'dice', 'consta', 'registrado', 'certificado', 'sello', 'firmado'
])

/**
 * Normaliza para comparar: sin tildes, minúsculas, sin puntuación, espacios colapsados.
 *
 * Se normaliza porque el modelo reescribe: donde el documento dice "PÉREZ GONZÁLEZ"
 * el modelo devuelve "Pérez González". Es el mismo dato y debe anclar.
 * Lo que NO se hace es fuzzy matching: eso abriría la puerta a que casi-coincidencias
 * pasen como verdad, que es justo lo que este archivo existe para impedir.
 */
export function normalizar (s) {
  if (typeof s !== 'string') return ''
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')        // marcas diacríticas
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')      // fuera puntuación, dentro letras y números
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * ¿Está esta cita, literalmente, en la fuente?
 *
 * ── EL FALLO MÁS GRAVE QUE HA TENIDO ESTE PROYECTO ─────────────────────────
 *
 * Esta función era `f.includes(c)`, y `includes` no exige frontera. Medido:
 *
 *   fuente:    «El salario mensual es de 4500 balboas»
 *   propuesta: { valor: 500, cita: "500 balboas" }
 *   resultado: ANCLADO ✅  ← «500 balboas» es sufijo de «4500 balboas»
 *
 * Un monto que la fuente NUNCA dijo entraba al expediente firmado, pasaba
 * G1..G5 y las de dominio —G4 incluida, porque la palabra «balboas» viaja
 * DENTRO de la subcadena—, y el expediente llegaba a COMPLETO con la columna
 * de guardias vacía. Con un afirmador cerca («la carta dice un salario de
 * 1500 balboas») salía además como **Confirmado**, el grado máximo.
 *
 * Y en la cédula, que es la CLAVE NATURAL: el modelo trunca un dígito,
 * «8-123-456» ancla contra «8-123-45678», G6 la valida estructuralmente, y
 * dedup crea un SEGUNDO expediente de la misma persona.
 *
 * Es exactamente la alucinación que este archivo existe para impedir. La
 * ironía es que el patrón ya estaba resuelto trece líneas más allá, en G4 de
 * `core/guardias.mjs`: «Se compara por PALABRA COMPLETA, no por substring».
 * Se corrigió allí, donde se midió, y no aquí, donde nadie lo probó.
 *
 * Ahora la cita tiene que aparecer con FRONTERA a los dos lados. Como
 * `normalizar()` deja solo letras, números y espacios simples, la frontera es
 * el espacio o el borde de la cadena — no hace falta una expresión regular
 * construida a partir de la cita, que además habría que escapar.
 *
 * @returns {boolean}
 */
export function citaEstaEnFuente (cita, fuente) {
  const c = normalizar(cita)
  const f = normalizar(fuente)
  if (!c || !f) return false

  // Se recorren TODAS las apariciones, no solo la primera: una cita puede salir
  // a mitad de palabra en un sitio y bien delimitada en otro, y en ese caso la
  // fuente sí la dice.
  for (let desde = 0; ; desde++) {
    const i = f.indexOf(c, desde)
    if (i === -1) return false
    const abre = i === 0 || f[i - 1] === ' '
    const cierra = i + c.length === f.length || f[i + c.length] === ' '
    if (abre && cierra) return true
    desde = i
  }
}

/**
 * ¿Está el valor dentro de su propia cita?
 *
 * Atrapa el caso sutil: el modelo devuelve una cita REAL pero un valor que no
 * sale de ella. Ejemplo medido: cita "y un tomógrafo", valor "Siemens".
 * La cita existe; el valor no está en ella. Es una invención con coartada.
 *
 * Los números se comparan por su forma escrita y por su dígito: "tres" y "3"
 * anclan al mismo texto.
 */
export function valorEstaEnCita (valor, cita) {
  const c = normalizar(cita)
  if (!c) return false

  if (typeof valor === 'number') {
    // 1 · Su forma escrita: "tres" ancla al 3
    const enLetra = NUMERO_A_PALABRA[valor]
    if (enLetra !== undefined && c.includes(enLetra)) return true

    // 2 · Comparación NUMÉRICA contra los números de la cita original.
    //     No sirve comparar texto: normalizar() quita la puntuación, así que
    //     "45.30" se vuelve "45 30", y String(45.30) en JS es "45.3".
    //     Dos representaciones distintas del mismo número. Se comparan como números.
    return numerosDe(cita).some(n => Math.abs(n - valor) < 1e-9)
  }

  const v = normalizar(valor)
  if (!v) return false
  return c.includes(v)
}

/** Extrae los números de un texto, aceptando punto o coma como separador decimal. */
export function numerosDe (texto) {
  if (typeof texto !== 'string') return []
  const encontrados = texto.match(/\d+(?:[.,]\d+)?/g) ?? []
  return encontrados
    .map(s => Number(s.replace(',', '.')))
    .filter(n => Number.isFinite(n))
}

const NUMERO_A_PALABRA = Object.freeze({
  0: 'cero', 1: 'un', 2: 'dos', 3: 'tres', 4: 'cuatro', 5: 'cinco',
  6: 'seis', 7: 'siete', 8: 'ocho', 9: 'nueve', 10: 'diez',
  11: 'once', 12: 'doce', 13: 'trece', 14: 'catorce', 15: 'quince',
  20: 'veinte', 30: 'treinta', 50: 'cincuenta', 100: 'cien'
})

/**
 * EL ANCLAJE. La función que decide si un campo entra al expediente.
 *
 * @param {{valor:any, cita:string}} campo   lo que devolvió el modelo
 * @param {string} fuente                    el texto de origen, literal
 * @returns {{anclado:boolean, motivo:string, valor:any, cita:string, evidencia:string}}
 */
export function anclar (campo, fuente) {
  const vacio = (motivo) => Object.freeze({
    anclado: false, motivo, valor: null, cita: '', evidencia: 'Desconocido'
  })

  if (!campo || typeof campo !== 'object') return vacio(MOTIVO.VALOR_VACIO)

  const { valor, cita } = campo

  if (valor === null || valor === undefined || valor === '') return vacio(MOTIVO.VALOR_VACIO)
  if (!cita || !String(cita).trim())                          return vacio(MOTIVO.SIN_CITA)
  if (!citaEstaEnFuente(cita, fuente))                        return vacio(MOTIVO.CITA_AUSENTE)
  if (!valorEstaEnCita(valor, cita))                          return vacio(MOTIVO.VALOR_AUSENTE)

  return Object.freeze({
    anclado: true,
    motivo: MOTIVO.ANCLADO,
    valor,
    cita: String(cita),
    evidencia: gradoDeEvidencia(cita, fuente)
  })
}

/**
 * Qué grado de evidencia merece un campo anclado, según CÓMO lo dijo la fuente.
 *
 * Esta es la respuesta a la tensión que el corpus dejó abierta: el enunciado del
 * reto pide un "puntaje de confianza", y el curso oficial prohíbe "umbrales de
 * confianza que te inventaste". No hay contradicción, porque esto NO es el modelo
 * autoevaluándose: es una regla determinista sobre el lenguaje de la fuente.
 *
 *   "parece de unos ocho años"     → Estimado
 *   "según el documento, ocho"     → Confirmado
 *   "ocho años"                    → Reportado
 */
export function gradoDeEvidencia (cita, fuente) {
  const ventana = normalizar(contexto(cita, fuente))

  if (ATENUADORES.some(a => ventana.includes(normalizar(a)))) return 'Estimado'
  if (AFIRMADORES.some(a => ventana.includes(normalizar(a)))) return 'Confirmado'
  return 'Reportado'
}

/** Devuelve la cita más 40 caracteres a cada lado, para leer cómo se dijo. */
function contexto (cita, fuente, margen = 40) {
  const f = String(fuente)
  const i = normalizar(f).indexOf(normalizar(cita))
  if (i === -1) return cita
  // El índice es sobre el texto normalizado; se aproxima sobre el original.
  const desde = Math.max(0, i - margen)
  const hasta = Math.min(f.length, i + normalizar(cita).length + margen)
  return f.slice(desde, hasta)
}

/**
 * Promueve un grado de evidencia. NUNCA baja en silencio.
 *
 * Invariante O3 del corpus: el nivel de evidencia no sube sin una observación
 * nueva que lo respalde. Invariante O4: no baja sin registrar la contradicción.
 * Por eso esto solo sube — bajar exige un evento de CONTRADICCION explícito.
 */
export function promover (actual, nuevo) {
  return nivelEvidencia(nuevo) > nivelEvidencia(actual) ? nuevo : actual
}

/** Los cuatro grados, reexportados por comodidad de quien importe este módulo. */
export { EVIDENCIA, nivelEvidencia }
