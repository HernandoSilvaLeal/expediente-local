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
  return apareceComoPalabra(normalizar(cita), normalizar(fuente))
}

/**
 * ¿Aparece `aguja` dentro de `pajar` con FRONTERA a los dos lados?
 *
 * Los dos argumentos vienen ya normalizados. Como `normalizar()` deja solo
 * letras, números y espacios simples, la frontera es el espacio o el borde de
 * la cadena — no hace falta una expresión regular construida a partir de la
 * aguja, que además habría que escapar.
 *
 * ── ES LA MISMA REGLA EN CUATRO SITIOS, Y POR ESO VIVE AQUÍ ────────────────
 *
 * Una auditoría adversarial encontró el mismo fallo de substring en cuatro
 * funciones distintas de este archivo, todas escritas con `includes`:
 *
 *   · la cita:      «500 balboas» anclaba contra «4500 balboas»
 *   · el número:    el valor 3 anclaba contra «trescientos», el 1 contra «junio»
 *   · el valor:     un texto anclaba dentro de otra palabra
 *   · el lenguaje:  «dice» dentro de «índice» subía un dato llano a Confirmado
 *
 * Cuatro apariciones del mismo error no son cuatro descuidos: son una regla que
 * no estaba escrita en ningún sitio y que cada función tuvo que inventar por su
 * cuenta. Ahora está escrita una vez, y las cuatro la llaman.
 *
 * Se recorren TODAS las apariciones, no solo la primera: una aguja puede salir
 * a mitad de palabra en un sitio y bien delimitada en otro. Negarlo sería el
 * error contrario —un hueco donde no lo hay— y también hace daño, porque manda
 * al oficial a repreguntar por algo que ya tiene delante.
 */
function apareceComoPalabra (aguja, pajar) {
  if (!aguja || !pajar) return false
  for (let desde = 0; ; desde++) {
    const i = pajar.indexOf(aguja, desde)
    if (i === -1) return false
    const abre = i === 0 || pajar[i - 1] === ' '
    const cierra = i + aguja.length === pajar.length || pajar[i + aguja.length] === ' '
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
    // 1 · Su forma escrita: "tres" ancla al 3 — PERO COMO PALABRA COMPLETA.
    //
    // Medido por una auditoría adversarial: con `c.includes(enLetra)`, el valor
    // 3 anclaba contra «trescientos balboas» y el dataset guardaba 3 donde la
    // fuente decía 300, sellado como Confirmado. Un error de factor cien en un
    // campo de dinero. El 1 anclaba contra «junio» («un» va dentro), y el 100
    // contra «paciente» («cien» va dentro) — este último en el dominio de
    // salud, con el mismo núcleo y otro .json, que es justo lo que demuestra
    // que el fallo era del core y no de una instancia.
    const enLetra = NUMERO_A_PALABRA[valor]
    if (enLetra !== undefined && apareceComoPalabra(enLetra, c)) return true

    // 2 · Comparación NUMÉRICA contra los números de la cita original.
    //     No sirve comparar texto: normalizar() quita la puntuación, así que
    //     "45.30" se vuelve "45 30", y String(45.30) en JS es "45.3".
    //     Dos representaciones distintas del mismo número. Se comparan como números.
    return numerosDe(cita).some(n => Math.abs(n - valor) < 1e-9)
  }

  const v = normalizar(valor)
  if (!v) return false
  return apareceComoPalabra(v, c)
}

/**
 * Extrae los números de un texto.
 *
 * ── LA COMA NO SIEMPRE ES UN DECIMAL, Y TRATARLA ASÍ COSTABA UN FACTOR MIL ──
 *
 * Esto era `s.replace(',', '.')`, sin más. Medido por una auditoría adversarial:
 *
 *   fuente:   «el salario mensual es de 1,250 balboas»
 *   numerosDe devolvía [1.25]
 *
 *   · el dato VERDADERO se rechazaba: valor 1250 no anclaba, y el campo se
 *     sustituía por 0. El expediente perdía el salario real.
 *   · el dato FALSO se aceptaba: valor 1.25 anclaba y quedaba registrado. Un
 *     salario de mil doscientos cincuenta balboas entraba como uno con
 *     veinticinco.
 *
 * En un expediente bancario ese número decide si alguien califica. Errar por
 * mil hacia abajo no es un decimal mal puesto: es una denegación.
 *
 * La regla es determinista y se declara: un separador seguido de EXACTAMENTE
 * TRES dígitos que no son el final del número es separador de MILES. Con una,
 * dos, o más de tres cifras detrás, es DECIMAL. Cuando aparecen los dos
 * separadores, manda el último — «1,250.75» son mil doscientos cincuenta con
 * setenta y cinco.
 *
 * Se elige una interpretación y se cumple siempre. Aceptar las dos «por si
 * acaso» sería reabrir el agujero: haría anclar tanto el valor verdadero como
 * el falso, que es exactamente lo que no puede pasar.
 */
export function numerosDe (texto) {
  if (typeof texto !== 'string') return []
  // Captura el número ENTERO con sus separadores, no trozos sueltos.
  const encontrados = texto.match(/\d+(?:[.,]\d+)*/g) ?? []
  return encontrados.map(aNumero).filter(n => Number.isFinite(n))
}

function aNumero (crudo) {
  const partes = crudo.split(/[.,]/)
  if (partes.length === 1) return Number(crudo)

  // El último separador decide: si lo que va detrás son exactamente tres
  // dígitos, era un grupo de millares y el número no tiene decimales.
  const ultima = partes.at(-1)
  const hayDecimal = ultima.length !== 3
  const entero = (hayDecimal ? partes.slice(0, -1) : partes).join('')
  return Number(hayDecimal ? `${entero}.${ultima}` : entero)
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
  const ventana = contexto(cita, fuente)

  // ── LOS MARCADORES, POR PALABRA COMPLETA ─────────────────────────────────
  //
  // Esto era `ventana.includes(normalizar(a))`. Medido por una auditoría
  // adversarial: la fuente «El indice de morosidad del cliente es 3» no contiene
  // ningún afirmador, pero normalizar('indice') contiene 'dice'. Un dato llano
  // salía con el sello de evidencia MÁS ALTO que el sistema puede otorgar.
  //
  // Y no es rebuscado: «índice», «bendice», «predice», «juzgado» —que contiene
  // 'juzga'— aparecen en documentos financieros todo el rato.
  const hay = (lista) => lista.some(a => apareceComoPalabra(normalizar(a), ventana))

  if (hay(ATENUADORES)) return 'Estimado'
  if (hay(AFIRMADORES)) return 'Confirmado'
  return 'Reportado'
}

/**
 * La cita más 40 caracteres a cada lado, YA NORMALIZADA, para leer cómo se dijo.
 *
 * ── SE INDEXABA SOBRE UN TEXTO Y SE CORTABA SOBRE OTRO ────────────────────
 *
 * El índice salía de `normalizar(f)` y el corte se hacía sobre `f`. El propio
 * comentario lo admitía: «se aproxima sobre el original». Esa aproximación es
 * el fallo, porque normalizar cambia la longitud del texto —cada tilde, cada
 * signo de puntuación, cada espacio repetido desplaza todo lo que viene detrás—
 * y el desfase crece con el documento.
 *
 * Medido por una auditoría adversarial, con un encabezado normal de documento
 * escaneado:
 *
 *   «Certificado.\n» + «=» × 80 + «\nEl monto parece ser 4500 balboas.»
 *
 *   índice normalizado de la cita:  32
 *   índice real en el original:    114
 *
 * La ventana leída era el encabezado: nunca veía «parece», sí veía
 * «Certificado». Resultado: **Confirmado** sobre un dato que la propia fuente
 * da por incierto. El grado más alto de la escala, exactamente al revés.
 *
 * El arreglo es no tener dos textos: se indexa y se corta sobre el mismo, el
 * normalizado. La ventana solo sirve para buscar marcadores de lenguaje, que ya
 * se comparan normalizados, así que no se pierde nada por el camino.
 */
function contexto (cita, fuente, margen = 40) {
  const f = normalizar(fuente)
  const c = normalizar(cita)
  const i = f.indexOf(c)
  if (i === -1) return c
  return f.slice(Math.max(0, i - margen), Math.min(f.length, i + c.length + margen))
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
