// core/estado.mjs — la máquina de estados del REGISTRO.
//
// ═══════════════════════════════════════════════════════════════════════════
//  LA DISTINCIÓN QUE HACE QUE ESTO CIERRE
// ═══════════════════════════════════════════════════════════════════════════
//
//  Aquí viven DOS conceptos que parecen uno y no lo son. Confundirlos produce
//  un modelo que no cierra, y es el error que este archivo existe para evitar:
//
//    ESTE ARCHIVO  →  la FSM del REGISTRO
//                     CAPTURADO → EXTRAIDO → VALIDADO → COMPLETO → APROBADO
//                     Un expediente está en UNO de estos estados. Se transita.
//
//    anclaje.mjs   →  la ESCALA DE EVIDENCIA de un CAMPO
//                     Desconocido < Estimado < Reportado < Confirmado
//                     Un CAMPO tiene un grado. Se promueve, no se transita.
//
//  Meterlos en el mismo enum produce preguntas sin respuesta:
//  ¿qué significa pasar de COMPLETO a ESTIMADO? Nada. No es una transición.
//
// ═══════════════════════════════════════════════════════════════════════════
//
//  Las transiciones son DATO (el objeto TRANSICIONES), no un `switch`.
//  Consecuencia: la ficha de documentación y el código no pueden divergir,
//  porque se generan del mismo objeto. Y añadir un estado es editar un dato.
//
//  PROHIBIDO aquí: importar @qvac/sdk. Verificado por scripts/verificar-frontera.mjs

/** Los estados del registro. Congelado: nadie añade uno en caliente. */
export const ESTADOS = Object.freeze({
  CAPTURADO:  'CAPTURADO',   // entró texto, voz o imagen. Nada interpretado aún
  EXTRAIDO:   'EXTRAIDO',    // el modelo propuso campos. NADA validado todavía
  VALIDADO:   'VALIDADO',    // las guardias pasaron. Puede tener huecos
  COMPLETO:   'COMPLETO',    // no falta ningún campo crítico
  APROBADO:   'APROBADO',    // una persona lo aprobó. TERMINAL
  RECHAZADO:  'RECHAZADO',   // una persona lo rechazó. TERMINAL
  DESCARTADO: 'DESCARTADO',  // no superó las guardias. TERMINAL
  DUPLICADO:  'DUPLICADO'    // es otro expediente ya existente. TERMINAL, enlazado
})

/**
 * LA TABLA. Es un DATO.
 * Lo que no está aquí, no se puede hacer. No hay excepciones ni casos especiales.
 */
export const TRANSICIONES = Object.freeze({
  CAPTURADO:  Object.freeze(['EXTRAIDO', 'DESCARTADO']),
  EXTRAIDO:   Object.freeze(['VALIDADO', 'DESCARTADO']),
  VALIDADO:   Object.freeze(['COMPLETO', 'DUPLICADO', 'DESCARTADO']),
  COMPLETO:   Object.freeze(['APROBADO', 'RECHAZADO', 'DUPLICADO']),
  APROBADO:   Object.freeze([]),
  RECHAZADO:  Object.freeze([]),
  DESCARTADO: Object.freeze([]),
  DUPLICADO:  Object.freeze([])
})

/** Motivo obligatorio al entrar a estos estados. Un rechazo sin causa no es auditable. */
export const EXIGEN_MOTIVO = Object.freeze(['DESCARTADO', 'RECHAZADO', 'DUPLICADO'])

/** Quién puede provocar cada transición. El software NUNCA aprueba solo. */
export const ORIGENES = Object.freeze({
  LLM_LOCAL: 'LLM_LOCAL',   // el modelo propuso
  REGLA:     'REGLA',       // una guardia determinista decidió
  HUMANO:    'HUMANO',      // una persona decidió
  P2P:       'P2P'          // llegó por sincronización con otro dispositivo
})

/** Transiciones que SOLO puede provocar una persona. Es política, no técnica. */
export const SOLO_HUMANO = Object.freeze(['APROBADO', 'RECHAZADO'])

export class TransicionIlegal extends Error {
  constructor (desde, hacia) {
    const posibles = TRANSICIONES[desde]
    super(
      posibles === undefined
        ? `Estado desconocido: "${desde}"`
        : posibles.length === 0
          ? `${desde} es terminal: no admite ninguna transición (se intentó → ${hacia})`
          : `${desde} → ${hacia} no está en la tabla. Solo: ${posibles.join(', ')}`
    )
    this.name = 'TransicionIlegal'
    this.desde = desde
    this.hacia = hacia
  }
}

export class MotivoRequerido extends Error {
  constructor (hacia) {
    super(`Entrar a ${hacia} exige un motivo. Un rechazo sin causa no es auditable.`)
    this.name = 'MotivoRequerido'
    this.hacia = hacia
  }
}

export class OrigenNoAutorizado extends Error {
  constructor (hacia, origen) {
    super(`${hacia} solo lo puede decidir una persona (origen=HUMANO), no ${origen}. ` +
          'El software propone; nunca aprueba.')
    this.name = 'OrigenNoAutorizado'
    this.hacia = hacia
    this.origen = origen
  }
}

// ── Consultas puras ───────────────────────────────────────────────────────────

export function esEstado (e)   { return Object.hasOwn(TRANSICIONES, e) }
export function esTerminal (e) { return esEstado(e) && TRANSICIONES[e].length === 0 }
export function siguientes (e) { return esEstado(e) ? TRANSICIONES[e] : [] }
export function esLegal (desde, hacia) {
  return esEstado(desde) && TRANSICIONES[desde].includes(hacia)
}

/**
 * El guardián. Lanza si la transición no es legal.
 * Se llama al inicio de toda operación que cambie el estado de un registro.
 *
 * @param {string} desde
 * @param {string} hacia
 * @param {{origen?: string, motivo?: string}} ctx
 * @returns {{desde, hacia, origen, motivo}} la transición validada
 */
export function exigirTransicion (desde, hacia, ctx = {}) {
  const { origen = ORIGENES.REGLA, motivo = null } = ctx

  if (!esLegal(desde, hacia)) throw new TransicionIlegal(desde, hacia)
  if (EXIGEN_MOTIVO.includes(hacia) && !motivo) throw new MotivoRequerido(hacia)
  if (SOLO_HUMANO.includes(hacia) && origen !== ORIGENES.HUMANO) {
    throw new OrigenNoAutorizado(hacia, origen)
  }
  if (!Object.hasOwn(ORIGENES, origen)) {
    throw new Error(`Origen desconocido: "${origen}". Debe ser uno de ${Object.keys(ORIGENES).join(', ')}`)
  }
  return Object.freeze({ desde, hacia, origen, motivo })
}

/**
 * Genera la ficha de documentación DESDE la tabla.
 * Así el documento y el código no pueden divergir: salen del mismo objeto.
 */
export function fichaMarkdown () {
  const filas = Object.entries(TRANSICIONES).map(([e, dest]) => {
    const marca = dest.length === 0 ? ' **(terminal)**' : ''
    const humano = SOLO_HUMANO.includes(e) ? ' 👤' : ''
    return `| \`${e}\`${marca}${humano} | ${dest.length ? dest.map(d => `\`${d}\``).join(' · ') : '—'} |`
  })
  const legales = Object.values(TRANSICIONES).reduce((a, d) => a + d.length, 0)
  const total = Object.keys(TRANSICIONES).length ** 2

  return [
    '# FSM del registro — generada desde `core/estado.mjs`',
    '',
    '> Este documento NO se edita a mano. Se genera de la tabla `TRANSICIONES`,',
    '> así que el código y la ficha no pueden divergir.',
    '',
    '| Estado | Puede pasar a |',
    '|---|---|',
    ...filas,
    '',
    `**${legales} transiciones legales de ${total} combinaciones posibles.**`,
    `Las otras ${total - legales} lanzan \`TransicionIlegal\`.`,
    '',
    `👤 = solo lo puede decidir una persona: ${SOLO_HUMANO.join(', ')}`,
    '',
    `Exigen motivo: ${EXIGEN_MOTIVO.join(', ')}`
  ].join('\n')
}
