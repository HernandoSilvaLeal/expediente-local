// core/esquema.mjs — carga el esquema de entidad desde un .json y lo valida.
//
// Este módulo NO sabe qué es un expediente bancario ni un equipo médico.
// Sabe de campos, citas, enumeraciones y valores vacíos. Nada más.
//
// Cambiar `instancias/banca/esquema.json` por `instancias/salud/esquema.json`
// convierte el mismo binario en otra cosa, sin recompilar.
//
// PROHIBIDO en este archivo: importar @qvac/sdk. Hay un test que lo verifica.

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = resolve(AQUI, '..')

/** Los cuatro niveles de evidencia, ORDENADOS. Es una escala, no una máquina de estados. */
export const EVIDENCIA = Object.freeze(['Desconocido', 'Estimado', 'Reportado', 'Confirmado'])

/** Nivel numérico de un grado de evidencia. Desconocido=0 … Confirmado=3 */
export function nivelEvidencia (grado) {
  const i = EVIDENCIA.indexOf(grado)
  return i === -1 ? 0 : i
}

/**
 * Carga y valida un esquema de instancia.
 * Falla ruidosamente: un esquema mal formado debe reventar al arrancar,
 * no producir extracciones silenciosamente incorrectas tres horas después.
 */
export function cargarEsquema (rutaRelativa) {
  const ruta = resolve(RAIZ, rutaRelativa)

  let crudo
  try {
    crudo = JSON.parse(readFileSync(ruta, 'utf8'))
  } catch (e) {
    throw new Error(`No se pudo leer el esquema en ${ruta}: ${e.message}`)
  }

  // --- Validación estructural. Lo que falte, se dice ahora ---
  const faltan = ['dominio', 'entidad', 'json_schema', 'vacios']
    .filter(k => crudo[k] === undefined)
  if (faltan.length) {
    throw new Error(`Esquema incompleto en ${rutaRelativa}. Faltan: ${faltan.join(', ')}`)
  }

  const js = crudo.json_schema
  // Trampa 13 del SDK: json_schema.name es OBLIGATORIO.
  // Sin él: "Invalid input: expected string, received undefined"
  if (!js.name || typeof js.name !== 'string') {
    throw new Error(`json_schema.name es obligatorio y debe ser string (${rutaRelativa})`)
  }
  if (!js.schema || js.schema.type !== 'object') {
    throw new Error(`json_schema.schema debe ser un objeto de tipo "object" (${rutaRelativa})`)
  }

  // Trampa 18: json_schema.strict es un PLACEBO — se acepta por compatibilidad con
  // OpenAI pero NO aplica la semántica de auto-tightening. `required` y
  // `additionalProperties:false` hay que ponerlos a mano o el modelo inventa campos.
  verificarEstrictez(js.schema, js.name)

  return Object.freeze({
    dominio: crudo.dominio,
    entidad: crudo.entidad,
    version: crudo.version ?? '0.0.0',
    descripcion: crudo.descripcion ?? '',
    jsonSchema: js,
    vacios: Object.freeze({ ...crudo.vacios }),
    camposCriticos: Object.freeze([...(crudo.campos_criticos ?? [])]),
    // Las unidades NO van dentro del json_schema: ese es la gramática que
    // restringe al modelo. Esto es contrato de validación, que es otra cosa
    // y la lee otro consumidor (G4).
    unidades: Object.freeze({ ...(crudo.unidades ?? {}) }),
    ruta: rutaRelativa
  })
}

/**
 * Convierte una ruta concreta en la ruta genérica con la que se declaran las
 * políticas del esquema: `documentos[0].tipo` → `documentos[].tipo`.
 *
 * Existe porque `campos_criticos` y `unidades` hablan de "el tipo de CUALQUIER
 * documento", no del tipo del documento número 3.
 */
export function rutaGenerica (ruta) {
  return String(ruta).replace(/\[\d+\]/g, '[]')
}

/**
 * Recorre el esquema y exige `additionalProperties:false` en todo objeto.
 * Devuelve las rutas que lo incumplen; lanza si hay alguna.
 */
function verificarEstrictez (nodo, ruta, laxos = []) {
  if (!nodo || typeof nodo !== 'object') return laxos

  if (nodo.type === 'object' && nodo.additionalProperties !== false) {
    laxos.push(ruta)
  }
  for (const [k, v] of Object.entries(nodo.properties ?? {})) {
    verificarEstrictez(v, `${ruta}.${k}`, laxos)
  }
  for (const [k, v] of Object.entries(nodo.$defs ?? {})) {
    verificarEstrictez(v, `${ruta}.$defs.${k}`, laxos)
  }
  if (nodo.items) verificarEstrictez(nodo.items, `${ruta}[]`, laxos)

  if (ruta.indexOf('.') === -1 && laxos.length) {
    throw new Error(
      `El esquema tiene ${laxos.length} objeto(s) sin additionalProperties:false: ${laxos.join(', ')}\n` +
      'json_schema.strict NO lo aplica por ti. Sin esto el modelo inventa campos en silencio.'
    )
  }
  return laxos
}

/**
 * Recorre las hojas de un objeto extraído y llama a `visitar(ruta, valor)`.
 * Una hoja es un objeto {valor, cita} — la unidad que las guardias verifican.
 */
export function recorrerCampos (obj, visitar, ruta = '') {
  if (obj === null || typeof obj !== 'object') return

  if (esCampo(obj)) { visitar(ruta, obj); return }

  if (Array.isArray(obj)) {
    obj.forEach((x, i) => recorrerCampos(x, visitar, `${ruta}[${i}]`))
    return
  }
  for (const [k, v] of Object.entries(obj)) {
    recorrerCampos(v, visitar, ruta ? `${ruta}.${k}` : k)
  }
}

/** Un campo es {valor, cita}: la forma que exige la regla de oro del anclaje. */
export function esCampo (x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x) &&
         'valor' in x && 'cita' in x
}

/**
 * Resuelve `$ref` contra el propio esquema. Solo admite referencias locales
 * `#/$defs/x`: una referencia remota sería una descarga, y aquí no se descarga nada.
 */
export function resolverRef (nodo, raiz) {
  if (!nodo || typeof nodo !== 'object' || !nodo.$ref) return nodo
  const m = /^#\/\$defs\/(.+)$/.exec(nodo.$ref)
  if (!m) throw new Error(`$ref no local: "${nodo.$ref}". Solo se admite "#/$defs/…"`)
  const destino = raiz.$defs?.[m[1]]
  if (!destino) throw new Error(`$ref rota: "${nodo.$ref}" no existe en $defs`)
  return destino
}

/**
 * Devuelve la especificación que el esquema declara para una ruta concreta.
 *
 *   specDeCampo(esq, 'titular.nombre')      → la definición de campoTexto
 *   specDeCampo(esq, 'documentos[0].monto') → la definición de campoNumero
 *
 * Es lo que permite que las guardias sean GENÉRICAS: no saben qué es un
 * expediente bancario, le preguntan al esquema qué esperaba en esa ruta.
 * Devuelve `undefined` si la ruta no está declarada — y eso es un dato: significa
 * que el modelo devolvió un campo que nadie le pidió.
 */
export function specDeCampo (esquema, ruta) {
  const raiz = esquema.jsonSchema?.schema ?? esquema
  let nodo = raiz

  for (const parte of ruta.split('.')) {
    if (!nodo) return undefined
    const m = /^(.+?)\[(\d+)\]$/.exec(parte)
    const nombre = m ? m[1] : parte

    nodo = resolverRef(nodo, raiz)
    nodo = nodo.properties?.[nombre]
    if (!nodo) return undefined
    nodo = resolverRef(nodo, raiz)

    if (m) {                              // había índice: bajamos al elemento
      if (nodo.type !== 'array' || !nodo.items) return undefined
      nodo = resolverRef(nodo.items, raiz)
    }
  }
  return nodo
}

/** Lee una ruta con puntos y corchetes: "documentos[0].tipo" */
export function leerRuta (obj, ruta) {
  return ruta.split('.').reduce((acc, parte) => {
    if (acc == null) return undefined
    const m = parte.match(/^(.+?)\[(\d+)\]$/)
    if (m) return acc[m[1]]?.[Number(m[2])]
    return acc[parte]
  }, obj)
}
