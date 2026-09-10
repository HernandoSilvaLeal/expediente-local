// core/calidad.mjs — cuánto le falta a un expediente, y qué preguntar primero.
//
// ═══════════════════════════════════════════════════════════════════════════
//   CERO IA. La repregunta la decide una regla, no un modelo.
// ═══════════════════════════════════════════════════════════════════════════
//
// Es una de las decisiones que más se defienden solas ante un jurado técnico:
// preguntarle a un modelo «¿qué te falta?» es pedirle que adivine su propia
// ignorancia. El esquema ya sabe qué campos existen y cuáles son críticos.
// Con eso, la siguiente pregunta es aritmética.
//
// ── QUÉ SIGNIFICA «MÁS VALIOSO» ────────────────────────────────────────────
//
// Está definido y es discutible, que es justo lo que un criterio oculto impide.
// Se pregunta primero por:
//
//   1. lo CRÍTICO que falta            — sin eso el expediente no puede cerrar
//   2. lo que el sistema RECHAZÓ       — hubo un intento y salió mal: es lo que
//                                        más probablemente se arregla al repreguntar
//   3. lo que falta y no es crítico    — completa, pero no bloquea
//   4. lo anclado con evidencia baja   — mejorable, pero ya hay algo
//
// Dentro de cada nivel, orden alfabético por ruta. No por «importancia
// percibida»: eso sería un criterio que nadie puede auditar.
//
// PROHIBIDO aquí: importar @qvac/sdk. Verificado por scripts/verificar-frontera.mjs

import { EVIDENCIA, nivelEvidencia, rutaGenerica } from './esquema.mjs'

/** Por qué se pregunta por un campo. El orden de este objeto ES la prioridad. */
export const MOTIVO_PREGUNTA = Object.freeze({
  CRITICO_AUSENTE:   'CRITICO_AUSENTE',
  RECHAZADO:         'RECHAZADO',
  OPCIONAL_AUSENTE:  'OPCIONAL_AUSENTE',
  EVIDENCIA_BAJA:    'EVIDENCIA_BAJA'
})

const PRIORIDAD = Object.freeze([
  MOTIVO_PREGUNTA.CRITICO_AUSENTE,
  MOTIVO_PREGUNTA.RECHAZADO,
  MOTIVO_PREGUNTA.OPCIONAL_AUSENTE,
  MOTIVO_PREGUNTA.EVIDENCIA_BAJA
])

/**
 * Puntúa un expediente. Determinista y explicable campo a campo.
 *
 * Las dos mitades se publican por separado a propósito: un expediente completo
 * y flojo de evidencia NO es lo mismo que uno incompleto y bien respaldado, y
 * fundirlos en un número único esconde justo la diferencia que importa.
 */
export function calidad (expediente, esquema) {
  const criticos = esquema?.camposCriticos ?? []
  const campos = expediente?.campos ?? {}
  const huecos = expediente?.huecos ?? {}
  const conflictos = expediente?.conflictos ?? []

  const criticosPresentes = criticos.filter(c => tieneCampo(campos, c))
  const completitud = criticos.length ? criticosPresentes.length / criticos.length : 1

  const anclados = Object.values(campos)
  const respaldo = anclados.length
    ? anclados.reduce((a, c) => a + nivelEvidencia(c.evidencia), 0) / (anclados.length * (EVIDENCIA.length - 1))
    : 0

  return Object.freeze({
    completitud: +completitud.toFixed(3),
    respaldo: +respaldo.toFixed(3),
    criticosPresentes: Object.freeze(criticosPresentes),
    criticosAusentes: Object.freeze(criticos.filter(c => !tieneCampo(campos, c))),
    camposAnclados: anclados.length,
    huecosAbiertos: Object.keys(huecos).length,
    conflictosAbiertos: conflictos.length,
    porEvidencia: contarPorEvidencia(anclados),
    // ── PUEDE CERRAR SOLO SI ESTÁN TODOS LOS CRÍTICOS **Y NINGUNO EN DISPUTA** ──
    //
    // No es una puntuación: es un sí o un no, y por eso va aparte de los dos
    // números de arriba.
    //
    // Lo segundo se añadió después de verlo pasar: un expediente con el titular
    // en conflicto —el formulario dice Juan Pérez, la carta laboral dice María
    // Gómez, la cédula es la misma— llegaba a COMPLETO con completitud 100 % y
    // se dejaba aprobar. La completitud contaba el campo como presente, que es
    // cierto: hay un valor asentado. Pero «hay un valor» y «sabemos de quién es
    // la cuenta» no son la misma frase.
    //
    // Un conflicto abierto no es un dato de menos: es una pregunta sin responder
    // sobre un dato que ya está dentro. Y esa se responde antes de firmar.
    puedeCerrar: completitud === 1 && conflictos.length === 0
  })
}

function tieneCampo (campos, rutaCritica) {
  if (campos[rutaCritica]) return true
  return Object.keys(campos).some(k => rutaGenerica(k) === rutaCritica)
}

function contarPorEvidencia (campos) {
  const n = Object.fromEntries(EVIDENCIA.map(g => [g, 0]))
  for (const c of campos) n[c.evidencia] = (n[c.evidencia] ?? 0) + 1
  return Object.freeze(n)
}

/**
 * Qué preguntar a continuación. Devuelve la lista COMPLETA, ordenada.
 *
 * Devolver la lista entera y no solo la primera es deliberado: quien llama
 * decide si pregunta una cosa o cinco, y puede enseñar por qué en ese orden.
 * Una función que devuelve solo «la siguiente» esconde su propio criterio.
 */
export function preguntasPendientes (expediente, esquema) {
  const criticos = esquema?.camposCriticos ?? []
  const campos = expediente?.campos ?? {}
  const huecos = expediente?.huecos ?? {}
  const conflictos = expediente?.conflictos ?? []
  const pendientes = []

  for (const ruta of criticos) {
    if (tieneCampo(campos, ruta)) continue
    const hueco = huecos[ruta] ?? Object.values(huecos).find(h => rutaGenerica(h.ruta) === ruta)
    pendientes.push({
      ruta,
      motivo: hueco ? MOTIVO_PREGUNTA.RECHAZADO : MOTIVO_PREGUNTA.CRITICO_AUSENTE,
      critico: true,
      detalle: hueco
        ? `lo rechazó ${hueco.guardias.join(', ')}: ${hueco.motivos.join(', ')}`
        : 'el esquema lo exige y no ha aparecido',
      pregunta: redactar(ruta, hueco)
    })
  }

  // Huecos que NO son críticos: hubo intento y falló, así que se repregunta,
  // pero no bloquean el cierre.
  for (const [ruta, h] of Object.entries(huecos)) {
    if (criticos.some(c => c === ruta || c === rutaGenerica(ruta))) continue
    pendientes.push({
      ruta,
      motivo: MOTIVO_PREGUNTA.RECHAZADO,
      critico: false,
      detalle: `lo rechazó ${h.guardias.join(', ')}: ${h.motivos.join(', ')}`,
      pregunta: redactar(ruta, h)
    })
  }

  // Anclados con evidencia baja: mejorables, y van los últimos.
  for (const [ruta, c] of Object.entries(campos)) {
    if (nivelEvidencia(c.evidencia) >= nivelEvidencia('Reportado')) continue
    // Un campo SIN CITA por diseño —un enum suelto como el tipo de documento—
    // no tiene evidencia que mejorar: su defensa es G2, no el anclaje. Preguntar
    // «¿puede confirmar el tipo?» sobre un valor correcto es ruido, y el ruido
    // en una repregunta hace que el oficial deje de leerlas.
    if (!c.cita) continue
    pendientes.push({
      ruta,
      motivo: MOTIVO_PREGUNTA.EVIDENCIA_BAJA,
      critico: criticos.includes(rutaGenerica(ruta)),
      detalle: `está como ${c.evidencia}: la fuente no lo afirmaba con certeza`,
      pregunta: `¿Puede confirmar ${legible(ruta)}? Ahora consta como «${c.valor}», pero la fuente lo daba por aproximado.`
    })
  }

  // El orden importa y tiene tres niveles, en este orden exacto:
  //   1. CRÍTICO antes que opcional — sin el crítico el expediente no cierra,
  //      así que preguntar otra cosa primero es hacer perder el tiempo
  //   2. el motivo, según PRIORIDAD
  //   3. alfabético por ruta — estable y auditable, no «importancia percibida»
  //
  // El nivel 1 se me había olvidado, y su test lo cazó: un opcional rechazado
  // adelantaba a un crítico rechazado solo por ir antes en el alfabeto.
  pendientes.sort((a, b) => {
    if (a.critico !== b.critico) return a.critico ? -1 : 1
    const d = PRIORIDAD.indexOf(a.motivo) - PRIORIDAD.indexOf(b.motivo)
    return d !== 0 ? d : a.ruta.localeCompare(b.ruta)
  })

  return Object.freeze(pendientes.map(Object.freeze))
}

/** La siguiente pregunta, o `null` si no falta nada. */
export function siguientePregunta (expediente, esquema) {
  return preguntasPendientes(expediente, esquema)[0] ?? null
}

/**
 * Redacta la pregunta en español llano.
 *
 * Es una PLANTILLA, no un modelo generando texto. Un oficial de sucursal lee
 * esto en pantalla, y que sea siempre igual es una ventaja: se aprende. Un texto
 * distinto en cada corrida obliga a leerlo entero cada vez.
 */
function redactar (ruta, hueco) {
  const q = legible(ruta)
  if (!hueco) return `Falta ${q}. ¿Aparece en algún documento del expediente?`

  const motivo = hueco.motivos?.[0]
  if (motivo === 'SIN_ANCLAJE') {
    return `No se pudo confirmar ${q}: lo propuesto no aparece literalmente en el documento. ` +
           '¿Puede leerlo del original y dictarlo tal cual está escrito?'
  }
  if (motivo === 'UNIDAD_AUSENTE' || motivo === 'UNIDAD_EN_VALOR') {
    return `Falta la unidad de ${q}. ¿En qué moneda o unidad está expresado?`
  }
  if (motivo === 'FUERA_DE_ENUM') {
    return `El valor de ${q} no es uno de los admitidos. ¿Cuál de las opciones corresponde?`
  }
  return `Falta ${q}. ¿Puede aportarlo?`
}

/** `titular.cedula` → «la cédula del titular». Tabla, no adivinanza. */
function legible (ruta) {
  const limpia = rutaGenerica(ruta).replace(/\[\]/g, '')
  const partes = limpia.split('.')
  const campo = partes.at(-1).replace(/_/g, ' ')
  const grupo = partes.length > 1 ? partes.slice(0, -1).join(' ').replace(/_/g, ' ') : null
  return grupo ? `${campo} de ${grupo}` : campo
}
