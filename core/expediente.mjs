// core/expediente.mjs — la tubería. Une todo lo demás y NO toca el modelo.
//
// ═══════════════════════════════════════════════════════════════════════════
//   Este archivo es el 95 %. Recibe lo que el modelo propuso como un DATO
//   más, y a partir de ahí no hay una sola llamada a nada estocástico.
// ═══════════════════════════════════════════════════════════════════════════
//
// Consecuencia práctica, y es la que sostiene todo el proyecto: el flujo
// COMPLETO de un expediente —captura, revisión, anclaje, guardias, estados,
// ledger, proyección— se puede probar punta a punta **sin modelo, sin red, sin
// GPU y en milisegundos**. Lo único que hay que darle es lo que el modelo dijo,
// que en los tests es lo que el modelo dijo DE VERDAD, medido el 9-sep.
//
// ── EL RELOJ SE INYECTA ────────────────────────────────────────────────────
//
// `ahora()` se recibe de fuera. Un módulo que llama a `Date.now()` por su cuenta
// no es reproducible y no es testeable, y aquí el instante de cada hecho queda
// escrito para siempre en el ledger: es un dato de auditoría, no un detalle.
//
// PROHIBIDO aquí: importar @qvac/sdk. Verificado por scripts/verificar-frontera.mjs

import { revisar } from './guardias.mjs'
import { rutaGenerica } from './esquema.mjs'
import { EVENTO, registrar, leer, verificarCadena } from './ledger.mjs'
import { proyectar } from './proyeccion.mjs'
import { ESTADOS, ORIGENES, esLegal } from './estado.mjs'

/**
 * Abre un expediente sobre un ledger.
 *
 * @param {object} opciones
 * @param {string} opciones.ruta      el archivo .jsonl de este expediente
 * @param {object} opciones.esquema   el que cargó cargarEsquema()
 * @param {string} opciones.id        identificador del expediente
 * @param {function} [opciones.ahora] devuelve el instante ISO. Se inyecta.
 */
export function abrirExpediente ({
  ruta, esquema, id,
  ahora = () => new Date().toISOString(),
  // ── LAS GUARDIAS DE DOMINIO SE INYECTAN ──────────────────────────────────
  //
  // `core/` NO importa instancias/banca/guardias.mjs, y esa línea es la que
  // sostiene toda la genericidad del proyecto: si el núcleo importara la cédula
  // panameña, «el mismo código sirve para inventario hospitalario» dejaría de
  // ser cierto en el mismo instante.
  //
  // Quien abre el expediente decide qué reglas de negocio aplican. El núcleo
  // solo sabe que existe una función y que devuelve rechazos.
  guardiasDominio = null,
  contextoDominio = {}
}) {
  if (!ruta)     throw new Error('abrirExpediente necesita la ruta del ledger')
  if (!esquema)  throw new Error('abrirExpediente necesita un esquema')
  if (!id)       throw new Error('abrirExpediente necesita un id de expediente')
  if (guardiasDominio !== null && typeof guardiasDominio !== 'function') {
    throw new TypeError('guardiasDominio debe ser una función (campo, contexto) => rechazos')
  }

  const hecho = (tipo, campos = {}) =>
    registrar(ruta, { tipo, expediente: id, ts: ahora(), ...campos })

  const estadoActual = () => proyectar(leer(ruta)).estado

  /** Solo transita si la transición es legal. Devuelve si la hizo. */
  const transitarSiPuede = (hacia, origen, motivo = null) => {
    const desde = estadoActual()
    if (!esLegal(desde, hacia)) return false
    hecho(EVENTO.TRANSICION, { origen, motivo, datos: { desde, hacia } })
    return true
  }

  return Object.freeze({
    id,
    ruta,

    /**
     * Entra texto. Es el primer hecho de todo expediente.
     * La fuente se guarda ENTERA: sin ella no se puede reverificar un anclaje mañana.
     */
    capturar (texto, { medio = 'texto', origen = ORIGENES.HUMANO } = {}) {
      if (typeof texto !== 'string' || !texto.trim()) {
        throw new Error('capturar() necesita un texto no vacío')
      }
      hecho(EVENTO.CAPTURA, { origen, datos: { texto, medio } })
      return this.leer()
    },

    /**
     * Asienta lo que el modelo propuso.
     *
     * Aquí ocurre TODO lo que importa, y en este orden:
     *   1. se registra que el modelo propuso algo  → EXTRAIDO
     *   2. las guardias deciden campo a campo      → REVISION
     *   3. si algo sobrevive                       → VALIDADO
     *   4. si no falta ningún campo crítico        → COMPLETO
     *
     * Lo rechazado NO se tira: viaja en el evento con su motivo, porque el
     * rechazo es la evidencia de que las guardias hicieron algo.
     */
    asentar (extraido, { origen = ORIGENES.LLM_LOCAL } = {}) {
      const exp = proyectar(leer(ruta))
      const fuente = exp.fuentes.map(f => f.texto).join('\n')
      if (!fuente) throw new Error('No se puede asentar sin haber capturado antes: no hay fuente contra la que anclar')

      const revisionNucleo = revisar(extraido, esquema, fuente)

      // Las de dominio corren DESPUÉS de las de núcleo y solo sobre lo que
      // sobrevivió: no tiene sentido preguntar si una cédula es de una provincia
      // que existe cuando esa cédula ni siquiera ancló en el texto.
      const campos = guardiasDominio
        ? revisionNucleo.campos.map(c => {
            if (!c.aceptado) return c
            const extra = guardiasDominio({ ruta: c.ruta, valor: c.valor, cita: c.cita }, contextoDominio)
            if (!extra?.length) return c
            return Object.freeze({
              ...c,
              aceptado: false,
              propuesto: c.valor,
              valor: esquema.vacios?.[typeof c.valor === 'number' ? 'numero' : 'texto'] ?? 'DESCONOCIDO',
              evidencia: 'Desconocido',
              rechazos: Object.freeze([...c.rechazos, ...extra])
            })
          })
        : revisionNucleo.campos

      const rechazados = campos.filter(c => !c.aceptado).length
      const resumen = Object.freeze({
        ...revisionNucleo.resumen,
        aceptados: campos.length - rechazados,
        rechazados,
        // Un crítico que las guardias de DOMINIO tumbaron cuenta igual que uno
        // que nunca vino: el expediente no puede cerrar con él.
        faltanCriticos: Object.freeze((esquema.camposCriticos ?? []).filter(cr =>
          !campos.some(c => rutaGenerica(c.ruta) === cr && c.aceptado))),
        completo: (esquema.camposCriticos ?? []).every(cr =>
          campos.some(c => rutaGenerica(c.ruta) === cr && c.aceptado))
      })

      hecho(EVENTO.EXTRACCION, { origen, datos: { campos: campos.length } })
      transitarSiPuede(ESTADOS.EXTRAIDO, origen)

      hecho(EVENTO.REVISION, {
        origen: ORIGENES.REGLA,
        datos: {
          campos: campos.map(c => ({
            ruta: c.ruta, aceptado: c.aceptado, valor: c.valor,
            cita: c.cita, evidencia: c.evidencia,
            // El motivo del rechazo viaja al ledger: es lo que se exporta al
            // CSV de auditoría y lo que contesta «¿por qué falta este dato?».
            rechazos: c.rechazos.map(r => ({ guardia: r.guardia, motivo: r.motivo }))
          })),
          resumen: { aceptados: resumen.aceptados, rechazados: resumen.rechazados }
        }
      })

      transitarSiPuede(ESTADOS.VALIDADO, ORIGENES.REGLA)
      if (resumen.completo) transitarSiPuede(ESTADOS.COMPLETO, ORIGENES.REGLA)

      return Object.freeze({ revision: { campos, resumen }, expediente: this.leer() })
    },

    /**
     * Baja el grado de evidencia de un campo. EXIGE motivo.
     * Es el único camino legítimo hacia abajo (invariante O4).
     */
    contradecir (rutaCampo, evidencia, motivo, { origen = ORIGENES.HUMANO } = {}) {
      if (!motivo) throw new Error('Contradecir sin motivo no es auditable: el motivo es obligatorio')
      hecho(EVENTO.CONTRADICCION, { origen, motivo, datos: { ruta: rutaCampo, evidencia } })
      return this.leer()
    },

    /** Enlaza con otro expediente. NO borra: borrar destruiría la evidencia. */
    marcarDuplicado (deId, motivo, { origen = ORIGENES.REGLA } = {}) {
      if (!motivo) throw new Error('Marcar un duplicado exige motivo')
      hecho(EVENTO.DUPLICADO, { origen, datos: { de: deId } })
      transitarSiPuede(ESTADOS.DUPLICADO, origen, motivo)
      return this.leer()
    },

    /**
     * La decisión de una persona. APROBADO y RECHAZADO solo salen de aquí.
     *
     * `exigirTransicion` ya lo impide desde dentro, pero se comprueba también
     * en la puerta: un error que llega antes de escribir en un ledger
     * append-only vale más que uno que llega después.
     */
    decidir (que, { motivo = null } = {}) {
      const hacia = que === 'aprobar' ? ESTADOS.APROBADO
                  : que === 'rechazar' ? ESTADOS.RECHAZADO
                  : null
      if (!hacia) throw new Error(`decidir() acepta 'aprobar' o 'rechazar', no "${que}"`)
      if (hacia === ESTADOS.RECHAZADO && !motivo) {
        throw new Error('Rechazar exige motivo. Un rechazo sin causa no es auditable.')
      }

      hecho(EVENTO.DECISION_HUMANA, { origen: ORIGENES.HUMANO, motivo, datos: { que } })

      const desde = estadoActual()
      if (!esLegal(desde, hacia)) {
        throw new Error(
          `No se puede ${que} un expediente en estado ${desde}. ` +
          'Hay que completar la extracción y la validación primero.')
      }
      hecho(EVENTO.TRANSICION, { origen: ORIGENES.HUMANO, motivo, datos: { desde, hacia } })
      return this.leer()
    },

    /** El expediente, deducido del ledger. Nunca almacenado. */
    leer () { return proyectar(leer(ruta)) },

    /** ¿Alguien tocó el archivo a mano? */
    verificar () { return verificarCadena(leer(ruta)) },

    /** Los hechos en crudo, para el CSV de auditoría. */
    hechos () { return leer(ruta) }
  })
}

/**
 * Exporta el expediente a CSV **con columna de auditoría**.
 *
 * La columna `guardias` es lo que separa este CSV de cualquier otro: dice qué
 * guardia tocó qué campo. Un dataset que no puede explicar por qué le falta un
 * dato es un dataset en el que hay que creer.
 */
export function aCsv (expediente) {
  const filas = [['campo', 'valor', 'evidencia', 'cita', 'origen', 'guardias', 'motivo'].join(',')]

  for (const [ruta, c] of Object.entries(expediente.campos)) {
    filas.push([ruta, c.valor, c.evidencia, c.cita, c.origen, '', ''].map(escapar).join(','))
  }

  // LOS HUECOS VAN EN EL MISMO CSV, no en un anexo que nadie abre. Un campo que
  // falta y un campo que el sistema RECHAZÓ no son lo mismo, y la diferencia es
  // justo lo que un auditor quiere ver: qué guardia lo paró y por qué.
  for (const [ruta, h] of Object.entries(expediente.huecos ?? {})) {
    filas.push([ruta, '', 'Desconocido', '', '', h.guardias.join('|'), h.motivos.join('|')]
      .map(escapar).join(','))
  }
  return filas.join('\n')
}

/** Comillas dobles duplicadas, según RFC 4180. Un CSV mal escapado corrompe el dato. */
function escapar (x) {
  const s = String(x ?? '')
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
