// core/guardias.mjs — G1..G5, las guardias de NÚCLEO.
//
// ═══════════════════════════════════════════════════════════════════════════
//   El modelo propone. Estas funciones deciden.
//   Ninguna de ellas sabe qué es un banco.
// ═══════════════════════════════════════════════════════════════════════════
//
// Son GENÉRICAS porque no llevan el dominio dentro: le preguntan al esquema qué
// esperaba en cada ruta. Cambiar `instancias/banca/esquema.json` por el de salud
// cambia lo que estas mismas funciones aceptan, sin tocar una línea de aquí.
//
// ── LAS CINCO ──────────────────────────────────────────────────────────────
//
//   G1 · TIPO       el valor es del tipo que el esquema declara
//   G2 · RANGO      está dentro de la enumeración / del rango / del formato
//   G3 · PROCEDENCIA la cita existe LITERALMENTE en la fuente  ← delega en anclaje.mjs
//   G4 · UNIDADES   la unidad es la que el esquema espera, y no viene dentro del valor
//   G5 · ESCAPE HATCH  nunca se falla en silencio
//
// G5 no es una comprobación más puesta en fila con las otras cuatro, y fingir que
// lo es sería mentir sobre el diseño. G5 es el CIERRE: la garantía de que todo
// campo sale de aquí con un veredicto explícito, de que lo rechazado toma el valor
// vacío que declara el esquema en vez de `undefined`, de que un campo que el modelo
// inventó y que el esquema no declara se marca como intruso, y de que un campo que
// el esquema exige y el modelo no devolvió se marca como ausente.
//
// ── POR QUÉ G3 NO REIMPLEMENTA EL ANCLAJE ──────────────────────────────────
//
// Lo llama. Una sola implementación de la regla de oro significa un solo sitio
// donde puede estar mal. Duplicarla para "adaptarla" es cómo se acaba con dos
// verdades distintas sobre el mismo dato.
//
// PROHIBIDO aquí: importar @qvac/sdk. Verificado por scripts/verificar-frontera.mjs

import { specDeCampo, esCampo, rutaGenerica } from './esquema.mjs'
import { anclar, MOTIVO, normalizar, numerosDe } from './anclaje.mjs'

/** Motivos de rechazo. Enum cerrado: el rechazo es un DATO que se cuenta y se audita. */
export const RECHAZO = Object.freeze({
  TIPO_INCORRECTO:   'TIPO_INCORRECTO',    // G1
  FUERA_DE_ENUM:     'FUERA_DE_ENUM',      // G2
  FUERA_DE_RANGO:    'FUERA_DE_RANGO',     // G2
  SIN_ANCLAJE:       'SIN_ANCLAJE',        // G3 — el detalle lo da MOTIVO de anclaje
  UNIDAD_AUSENTE:    'UNIDAD_AUSENTE',     // G4
  UNIDAD_EN_VALOR:   'UNIDAD_EN_VALOR',    // G4
  CAMPO_INTRUSO:     'CAMPO_INTRUSO',      // G5 — el esquema no lo declara
  CAMPO_AUSENTE:     'CAMPO_AUSENTE'       // G5 — el esquema lo exige y no vino
})

// ═══════════════════════════════════════════════════════════════════════════
//  G1 · TIPO
// ═══════════════════════════════════════════════════════════════════════════

function g1Tipo ({ valor, spec }) {
  const esperado = tipoEsperado(spec)
  if (!esperado) return null                       // el esquema no lo declara: no hay nada que exigir

  const real = valor === null ? 'null' : Array.isArray(valor) ? 'array' : typeof valor

  if (esperado === 'number') {
    // Un número que llega como texto es el fallo típico del modelo: devuelve "8"
    // en vez de 8. NO se convierte en silencio, porque convertir esconde el fallo
    // y el siguiente en aparecer sería "ocho".
    if (real !== 'number') {
      return { motivo: RECHAZO.TIPO_INCORRECTO,
               detalle: `se esperaba number y llegó ${real} (${JSON.stringify(valor)})` }
    }
    if (!Number.isFinite(valor)) {
      return { motivo: RECHAZO.TIPO_INCORRECTO, detalle: `${valor} no es un número finito` }
    }
    return null
  }

  if (esperado === 'integer') {
    if (real !== 'number' || !Number.isInteger(valor)) {
      return { motivo: RECHAZO.TIPO_INCORRECTO, detalle: `se esperaba un entero y llegó ${JSON.stringify(valor)}` }
    }
    return null
  }

  if (esperado !== real) {
    return { motivo: RECHAZO.TIPO_INCORRECTO, detalle: `se esperaba ${esperado} y llegó ${real}` }
  }
  return null
}

/** El tipo que el esquema declara para el VALOR de un campo (o para el nodo suelto). */
function tipoEsperado (spec) {
  if (!spec) return null
  if (spec.properties?.valor?.type) return spec.properties.valor.type   // campo {valor, cita}
  return spec.type ?? null                                             // nodo primitivo con enum
}

// ═══════════════════════════════════════════════════════════════════════════
//  G2 · RANGO, ENUMERACIÓN Y FORMATO
// ═══════════════════════════════════════════════════════════════════════════

function g2Rango ({ valor, spec }) {
  const s = specDelValor(spec)
  if (!s) return null

  if (Array.isArray(s.enum) && !s.enum.includes(valor)) {
    return { motivo: RECHAZO.FUERA_DE_ENUM,
             detalle: `${JSON.stringify(valor)} no está en [${s.enum.join(', ')}]` }
  }
  if (typeof valor === 'number') {
    if (s.minimum !== undefined && valor < s.minimum) {
      return { motivo: RECHAZO.FUERA_DE_RANGO, detalle: `${valor} < mínimo ${s.minimum}` }
    }
    if (s.maximum !== undefined && valor > s.maximum) {
      return { motivo: RECHAZO.FUERA_DE_RANGO, detalle: `${valor} > máximo ${s.maximum}` }
    }
  }
  if (typeof valor === 'string' && s.pattern) {
    if (!new RegExp(s.pattern).test(valor)) {
      return { motivo: RECHAZO.FUERA_DE_RANGO, detalle: `"${valor}" no cumple /${s.pattern}/` }
    }
  }
  return null
}

/** La especificación del VALOR: dentro de `properties.valor` si es campo, o el nodo mismo. */
function specDelValor (spec) {
  if (!spec) return null
  return spec.properties?.valor ?? spec
}

// ═══════════════════════════════════════════════════════════════════════════
//  G3 · PROCEDENCIA LITERAL — la regla de oro, aplicada a todo campo
// ═══════════════════════════════════════════════════════════════════════════

function g3Procedencia ({ campo, fuente, esCampoConCita }) {
  // Un nodo primitivo (un enum suelto, sin cita) no tiene procedencia que
  // comprobar: su única defensa es G2, y así queda dicho.
  if (!esCampoConCita) return null

  const r = anclar(campo, fuente)
  if (r.anclado) return null

  return {
    motivo: RECHAZO.SIN_ANCLAJE,
    detalle: explicarAnclaje(r.motivo),
    submotivo: r.motivo
  }
}

function explicarAnclaje (motivo) {
  switch (motivo) {
    case MOTIVO.SIN_CITA:      return 'el modelo no devolvió cita'
    case MOTIVO.CITA_AUSENTE:  return 'la cita NO aparece en la fuente: es una invención'
    case MOTIVO.VALOR_AUSENTE: return 'la cita existe pero el valor no sale de ella: invención con coartada'
    case MOTIVO.VALOR_VACIO:   return 'no hay valor que anclar'
    default:                   return `sin anclaje (${motivo})`
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  G4 · UNIDADES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Dos cosas distintas, las dos vistas en salidas reales de modelo:
 *
 *   a) La unidad se cuela DENTRO del valor: monto = "45.30 balboas" en un campo
 *      que el esquema declara `number`. G1 ya lo atrapa por tipo; G4 lo nombra
 *      bien, porque el motivo importa para saber qué arreglar.
 *
 *   b) El esquema declara una unidad para esa ruta y la cita habla de OTRA.
 *      "45.30 dólares" cuando el expediente es en balboas no es el mismo dato,
 *      aunque el número coincida.
 */
function g4Unidades ({ valor, campo, ruta, esquema, esCampoConCita }) {
  const unidad = esquema?.unidades?.[rutaGenerica(ruta)]

  // (a) unidad metida dentro del valor de un campo que debería ser numérico
  if (typeof valor === 'string' && unidad) {
    const numeros = numerosDe(valor)
    const soloNumero = /^[\d.,\s]+$/.test(valor)
    if (numeros.length > 0 && !soloNumero) {
      return { motivo: RECHAZO.UNIDAD_EN_VALOR,
               detalle: `"${valor}" trae la unidad dentro del valor; el valor debe ser el número solo` }
    }
  }

  if (!unidad || !esCampoConCita) return null

  // (b) la cita debe hablar de la unidad que el esquema declara
  const cita = String(campo?.cita ?? '')
  if (!cita.trim()) return null                // sin cita no hay nada que leer: es cosa de G3

  // Se compara por PALABRA COMPLETA, no por substring, y hay dos razones medidas:
  //
  //   · normalizar('$') devuelve cadena VACÍA —el símbolo no es letra ni número— y
  //     `cita.includes('')` es SIEMPRE true. Con substring, esta guardia aceptaba
  //     cualquier cita del mundo. Es el mismo falso positivo que tenía el grep de
  //     la frontera, y con el mismo efecto: un verificador que no verifica nada.
  //
  //   · 'B/.' normaliza a 'b', y por substring cualquier cita con una be —"cobrado",
  //     "diciembre"— habría contado como mención de la moneda.
  //
  // Los símbolos no sobreviven a normalizar(), así que se buscan en la cita literal.
  const palabras = new Set(normalizar(cita).split(' ').filter(Boolean))
  const variantes = [unidad, ...(SINONIMOS[normalizar(unidad)] ?? [])]

  for (const v of variantes) {
    const n = normalizar(v)
    if (n) { if (palabras.has(n)) return null }        // palabra: balboas, dolares, pab
    else   { if (cita.includes(v)) return null }       // símbolo: $
  }

  return { motivo: RECHAZO.UNIDAD_AUSENTE,
           detalle: `la cita no menciona "${unidad}": «${campo.cita}»` }
}

/**
 * Sinónimos de unidad. Es un DATO y vive aquí porque es lenguaje, no dominio:
 * el balboa panameño está a la par con el dólar y en la calle se dicen los dos.
 * Ampliarlo es editar esta tabla, no escribir código.
 */
const SINONIMOS = Object.freeze({
  balboas: Object.freeze(['balboa', 'b/.', 'pab', 'dolares', 'dólares', 'usd', '$']),
  anos:    Object.freeze(['ano', 'años', 'año', 'years']),
  dias:    Object.freeze(['dia', 'días', 'día'])
})

// ═══════════════════════════════════════════════════════════════════════════
//  LA TABLA — las guardias son un DATO, igual que las transiciones
// ═══════════════════════════════════════════════════════════════════════════

export const GUARDIAS = Object.freeze([
  Object.freeze({ id: 'G1', que: 'tipo',
    porque: 'un número que llega como texto es un fallo, no una variante',
    aplicar: g1Tipo }),
  Object.freeze({ id: 'G2', que: 'rango y enumeración',
    porque: 'el esquema declara qué valores existen; lo demás no existe',
    aplicar: g2Rango }),
  Object.freeze({ id: 'G3', que: 'procedencia literal',
    porque: 'LA REGLA DE ORO: la cita tiene que estar en la fuente',
    aplicar: g3Procedencia }),
  Object.freeze({ id: 'G4', que: 'unidades',
    porque: '45,30 en otra moneda no es el mismo dato aunque el número coincida',
    aplicar: g4Unidades })
])

// ═══════════════════════════════════════════════════════════════════════════
//  LA REVISIÓN — el punto de entrada
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Revisa un objeto extraído contra su esquema y su fuente.
 *
 * NO lanza. Un campo malo no es una excepción: es un dato con su motivo, que hay
 * que poder contar, exportar y enseñar. Lanzar aquí obligaría a envolver toda la
 * tubería en try/catch y perdería justo la información que interesa.
 *
 * @param {object} extraido  lo que devolvió el modelo
 * @param {object} esquema   el que cargó cargarEsquema()
 * @param {string} fuente    el texto de origen, literal
 * @returns {{campos: Array, resumen: object}}
 */
export function revisar (extraido, esquema, fuente) {
  const campos = []

  recorrer(extraido, '', campos, esquema, fuente)
  exigirRequeridos(extraido, esquema, campos)

  return Object.freeze({
    campos: Object.freeze(campos),
    resumen: resumir(campos, esquema)
  })
}

function recorrer (nodo, ruta, acc, esquema, fuente) {
  if (nodo === undefined) return

  // ── G5 · campo intruso: el modelo devolvió algo que el esquema no declara ──
  const spec = ruta === '' ? (esquema.jsonSchema?.schema ?? null) : specDeCampo(esquema, ruta)
  if (ruta !== '' && spec === undefined) {
    acc.push(cerrar({
      ruta, valor: valorDe(nodo), cita: citaDe(nodo), esquema,
      rechazos: [{ guardia: 'G5', motivo: RECHAZO.CAMPO_INTRUSO,
                   detalle: 'el esquema no declara esta ruta: el modelo la inventó' }]
    }))
    return
  }

  if (esCampo(nodo))      { acc.push(revisarCampo(nodo, ruta, spec, esquema, fuente, true));  return }
  if (Array.isArray(nodo)) { nodo.forEach((x, i) => recorrer(x, `${ruta}[${i}]`, acc, esquema, fuente)); return }

  if (nodo !== null && typeof nodo === 'object') {
    for (const [k, v] of Object.entries(nodo)) {
      recorrer(v, ruta ? `${ruta}.${k}` : k, acc, esquema, fuente)
    }
    return
  }

  // Hoja primitiva sin cita (un enum suelto). Su única defensa es G2, y se dice.
  if (ruta !== '') acc.push(revisarCampo(nodo, ruta, spec, esquema, fuente, false))
}

function revisarCampo (nodo, ruta, spec, esquema, fuente, esCampoConCita) {
  const valor = esCampoConCita ? nodo.valor : nodo
  const campo = esCampoConCita ? nodo : { valor: nodo, cita: '' }
  const ctx = { ruta, valor, campo, spec, esquema, fuente, esCampoConCita }

  const rechazos = []
  for (const g of GUARDIAS) {
    const r = g.aplicar(ctx)
    if (r) rechazos.push({ guardia: g.id, ...r })
  }

  // El grado de evidencia solo lo puede otorgar un anclaje que pasó.
  const evidencia = rechazos.length === 0 && esCampoConCita
    ? anclar(campo, fuente).evidencia
    : 'Desconocido'

  return cerrar({ ruta, valor, cita: campo.cita ?? '', esquema, rechazos, evidencia })
}

// ═══════════════════════════════════════════════════════════════════════════
//  G5 · EL ESCAPE HATCH — nunca se falla en silencio
// ═══════════════════════════════════════════════════════════════════════════

/**
 * El cierre. Todo campo sale de aquí con veredicto explícito, y lo rechazado
 * toma el VALOR VACÍO QUE DECLARA EL ESQUEMA — nunca `undefined`, nunca el valor
 * malo colado sin avisar.
 *
 * `undefined` viaja silenciosamente por todo un sistema y aparece tres capas más
 * abajo convertido en la cadena "undefined" dentro de un CSV que alguien firma.
 */
function cerrar ({ ruta, valor, cita, esquema, rechazos = [], evidencia }) {
  const aceptado = rechazos.length === 0
  return Object.freeze({
    ruta,
    aceptado,
    valor: aceptado ? valor : vacioPara(valor, esquema),
    propuesto: aceptado ? undefined : valor,   // lo que el modelo quería meter, para auditar
    cita: aceptado ? String(cita ?? '') : '',
    evidencia: evidencia ?? (aceptado ? 'Reportado' : 'Desconocido'),
    rechazos: Object.freeze(rechazos.map(r => Object.freeze(r)))
  })
}

/** El vacío lo declara el esquema, no este archivo. Otro dominio, otro vacío. */
function vacioPara (valor, esquema) {
  const v = esquema?.vacios ?? {}
  if (typeof valor === 'number') return v.numero ?? 0
  return v.texto ?? 'DESCONOCIDO'
}

/**
 * G5, segunda mitad: lo que el esquema EXIGE y el modelo no devolvió.
 * Un campo ausente es tan auditable como uno rechazado, y se pierde con
 * facilidad porque no hay nada que mirar.
 */
function exigirRequeridos (extraido, esquema, acc) {
  const raiz = esquema.jsonSchema?.schema
  if (!raiz) return
  const vistas = new Set(acc.map(c => c.ruta))

  const bajar = (spec, obj, prefijo) => {
    if (!spec || typeof spec !== 'object') return
    for (const req of spec.required ?? []) {
      const ruta = prefijo ? `${prefijo}.${req}` : req
      const hijo = obj?.[req]
      if (hijo === undefined || hijo === null) {
        if (![...vistas].some(v => v === ruta || v.startsWith(ruta + '.'))) {
          acc.push(cerrar({
            ruta, valor: null, cita: '', esquema,
            rechazos: [{ guardia: 'G5', motivo: RECHAZO.CAMPO_AUSENTE,
                         detalle: 'el esquema lo exige y el modelo no lo devolvió' }]
          }))
        }
      }
    }
    for (const [k, s] of Object.entries(spec.properties ?? {})) {
      const hijo = obj?.[k]
      const ruta = prefijo ? `${prefijo}.${k}` : k
      if (s.type === 'object' && hijo && typeof hijo === 'object') bajar(s, hijo, ruta)
      if (s.type === 'array' && Array.isArray(hijo)) {
        hijo.forEach((el, i) => bajar(resolverItems(s, raiz), el, `${ruta}[${i}]`))
      }
    }
  }
  bajar(raiz, extraido, '')
}

function resolverItems (spec, raiz) {
  const it = spec.items
  if (!it) return null
  if (!it.$ref) return it
  const m = /^#\/\$defs\/(.+)$/.exec(it.$ref)
  return m ? raiz.$defs?.[m[1]] ?? null : null
}

// ═══════════════════════════════════════════════════════════════════════════
//  El resumen — lo que se enseña en cámara y lo que va al CSV de auditoría
// ═══════════════════════════════════════════════════════════════════════════

function resumir (campos, esquema) {
  const porGuardia = {}
  const porMotivo = {}
  for (const c of campos) {
    for (const r of c.rechazos) {
      porGuardia[r.guardia] = (porGuardia[r.guardia] ?? 0) + 1
      porMotivo[r.motivo]   = (porMotivo[r.motivo]   ?? 0) + 1
    }
  }
  const criticos = esquema?.camposCriticos ?? []
  const faltanCriticos = criticos.filter(cr =>
    !campos.some(c => rutaGenerica(c.ruta) === cr && c.aceptado))

  return Object.freeze({
    total: campos.length,
    aceptados: campos.filter(c => c.aceptado).length,
    rechazados: campos.filter(c => !c.aceptado).length,
    porGuardia: Object.freeze(porGuardia),
    porMotivo: Object.freeze(porMotivo),
    faltanCriticos: Object.freeze(faltanCriticos),
    // Un expediente NO puede llegar a COMPLETO con un crítico sin anclar.
    // Esto es lo que dispara la repregunta determinista.
    completo: faltanCriticos.length === 0
  })
}

// ── Utilidades pequeñas ──────────────────────────────────────────────────────
function valorDe (nodo) { return esCampo(nodo) ? nodo.valor : nodo }
function citaDe  (nodo) { return esCampo(nodo) ? nodo.cita  : '' }
