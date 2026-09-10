// core/proyeccion.mjs — el expediente no se guarda: se DEDUCE.
//
// ═══════════════════════════════════════════════════════════════════════════
//   El dataset es una PROYECCIÓN del ledger. Se puede tirar entero y
//   regenerarlo, y sale idéntico byte a byte.
// ═══════════════════════════════════════════════════════════════════════════
//
// Invariante O5. El test que lo cierra es literal:
//
//     3 eventos → proyectar → MATAR el proceso → reproyectar → IDÉNTICO
//
// ── QUÉ HACE ESTO POSIBLE ──────────────────────────────────────────────────
//
// Que la proyección sea una función PURA de la lista de eventos. Nada de estado
// escondido, nada de reloj, nada de azar, nada de orden de inserción en un Map
// que dependa de cuándo llegó qué. Si esta función dejara de ser pura, el
// invariante O5 se caería sin que ningún test se pusiera rojo hasta el día del
// jurado — y ese es exactamente el fallo que este archivo existe para no tener.
//
// PROHIBIDO aquí: importar @qvac/sdk. Verificado por scripts/verificar-frontera.mjs

import { EVENTO } from './ledger.mjs'
import { ESTADOS, exigirTransicion } from './estado.mjs'
import { promover, nivelEvidencia, normalizar } from './anclaje.mjs'
import { EVIDENCIA } from './esquema.mjs'

export class LedgerIncoherente extends Error {
  constructor (seq, detalle) {
    super(`El ledger describe algo imposible en el evento #${seq}: ${detalle}`)
    this.name = 'LedgerIncoherente'
    this.seq = seq
  }
}

/**
 * Reduce una lista de eventos al expediente que describen.
 *
 * PURA. Mismos eventos → mismo resultado, siempre, en cualquier máquina.
 *
 * **Sí lanza**, y es deliberado: aquí una entrada mala no es un dato del usuario
 * —eso es `guardias.revisar()`, que nunca lanza— sino CORRUPCIÓN del registro de
 * hechos. Seguir proyectando sobre un ledger que describe una transición imposible
 * produciría un expediente que nunca debió existir, y lo produciría en silencio.
 *
 * @param {Array} eventos  en orden, tal como salieron del ledger
 * @returns {object} el expediente, congelado
 */
export function proyectar (eventos) {
  if (!Array.isArray(eventos)) throw new TypeError('proyectar() espera una lista de eventos')
  if (eventos.length === 0) return vacio()

  const ids = new Set(eventos.map(e => e.expediente))
  if (ids.size > 1) {
    throw new LedgerIncoherente(eventos[0].seq,
      `hay ${ids.size} expedientes mezclados en la misma proyección: ${[...ids].join(', ')}`)
  }

  const exp = {
    id: eventos[0].expediente,
    estado: null,
    fuentes: [],
    campos: new Map(),
    huecos: new Map(),
    propuestos: 0,
    rechazados: 0,
    duplicadoDe: null,
    contradicciones: [],
    conflictos: [],
    decisiones: [],
    historial: []
  }

  for (const e of eventos) aplicar(exp, e)

  return congelar(exp, eventos)
}

// ═══════════════════════════════════════════════════════════════════════════
//  Un hecho, un efecto. La tabla es tan explícita como la de transiciones.
// ═══════════════════════════════════════════════════════════════════════════

function aplicar (exp, e) {
  switch (e.tipo) {
    case EVENTO.CAPTURA: {
      // El primer hecho de todo expediente. La fuente se conserva ENTERA, porque
      // sin ella no se puede reverificar ni un solo anclaje mañana.
      exp.fuentes.push({ seq: e.seq, ts: e.ts, texto: e.datos.texto ?? '', medio: e.datos.medio ?? 'texto' })
      if (exp.estado === null) exp.estado = ESTADOS.CAPTURADO
      break
    }

    case EVENTO.EXTRACCION: {
      // Lo que el modelo PROPUSO. No asienta nada: proponer no es decidir.
      exp.propuestos += Number(e.datos.campos ?? 0)
      break
    }

    case EVENTO.REVISION: {
      // Lo que las guardias DECIDIERON.
      for (const c of e.datos.campos ?? []) {
        if (!c.aceptado) {
          exp.rechazados++
          // El rechazo NO se descarta: se conserva con su motivo, porque es lo
          // que contesta «¿por qué le falta este dato al expediente?». Un
          // dataset que no puede explicar sus huecos es un dataset en el que
          // hay que creer.
          exp.huecos.set(c.ruta, Object.freeze({
            ruta: c.ruta,
            guardias: Object.freeze((c.rechazos ?? []).map(r => r.guardia)),
            motivos: Object.freeze((c.rechazos ?? []).map(r => r.motivo)),
            seq: e.seq
          }))
          continue
        }
        // Un campo que ANTES fue rechazado y ahora ancla deja de ser un hueco:
        // la segunda observación lo resolvió, y el expediente lo refleja.
        exp.huecos.delete(c.ruta)
        asentar(exp, c, e)
      }
      break
    }

    case EVENTO.TRANSICION: {
      const hacia = e.datos.hacia
      try {
        exigirTransicion(exp.estado ?? e.datos.desde, hacia, { origen: e.origen, motivo: e.motivo })
      } catch (err) {
        throw new LedgerIncoherente(e.seq, err.message)
      }
      exp.estado = hacia
      exp.historial.push({ seq: e.seq, ts: e.ts, hacia, origen: e.origen, motivo: e.motivo })
      break
    }

    case EVENTO.CONTRADICCION: {
      // EL ÚNICO evento que puede BAJAR el grado de evidencia de un campo.
      // Invariante O4: la evidencia no baja en silencio; baja dejando escrito
      // qué la contradijo y quién lo dijo.
      const ruta = e.datos.ruta
      const campo = exp.campos.get(ruta)
      if (!campo) {
        throw new LedgerIncoherente(e.seq, `contradice "${ruta}", que no está asentado en el expediente`)
      }
      const nuevo = e.datos.evidencia ?? 'Desconocido'
      if (!EVIDENCIA.includes(nuevo)) {
        throw new LedgerIncoherente(e.seq, `grado de evidencia desconocido: "${nuevo}"`)
      }
      if (nivelEvidencia(nuevo) >= nivelEvidencia(campo.evidencia)) {
        throw new LedgerIncoherente(e.seq,
          `una contradicción tiene que BAJAR la evidencia; ${campo.evidencia} → ${nuevo} no baja. ` +
          'Para subir hace falta una observación nueva, no una contradicción')
      }
      exp.campos.set(ruta, Object.freeze({ ...campo, evidencia: nuevo, contradichoEn: e.seq }))
      exp.contradicciones.push({ seq: e.seq, ruta, de: campo.evidencia, a: nuevo, motivo: e.motivo })
      break
    }

    case EVENTO.DUPLICADO: {
      exp.duplicadoDe = e.datos.de ?? null
      break
    }

    case EVENTO.DECISION_HUMANA: {
      exp.decisiones.push({ seq: e.seq, ts: e.ts, que: e.datos.que ?? null, motivo: e.motivo })
      break
    }

    default:
      throw new LedgerIncoherente(e.seq, `tipo de evento desconocido: "${e.tipo}"`)
  }
}

/**
 * Asienta un campo aceptado.
 *
 * La evidencia SOLO SUBE (invariante O3). Una observación posterior que diga lo
 * mismo con menos respaldo no degrada lo que ya estaba probado; para bajar hace
 * falta una CONTRADICCION explícita, que es un hecho que alguien firma.
 */
function asentar (exp, c, e) {
  const previo = exp.campos.get(c.ruta)

  // ── EL CAMPO NO PUEDE CAMBIAR DE VALOR EN SILENCIO ───────────────────────
  //
  // Este proyecto blindó el DATO —nada entra sin cita literal— y durante un
  // tiempo dejó abierta LA PERSONA. Verificado: un expediente a nombre de
  // Juan Pérez González se convertía en María Gómez Batista con CERO rechazos,
  // cadena íntegra y ninguna alerta. Bastaba una segunda captura.
  //
  // En banca eso no es un detalle de implementación: es suplantación silenciosa.
  //
  // La política es la MISMA que ya aplica G9 entre expedientes distintos, ahora
  // aplicada dentro de uno: si dos fuentes dicen cosas distintas del mismo
  // campo, el sistema NO elige. Marca el conflicto y lo decide una persona.
  //
  // Que un campo RECHAZADO se resuelva después con un valor bueno sigue siendo
  // legítimo —es el caso de uso CU-6— porque ahí no había valor asentado que
  // contradecir: había un hueco.
  if (previo && !mismoValor(previo.valor, c.valor)) {
    exp.conflictos.push(Object.freeze({
      seq: e.seq,
      ruta: c.ruta,
      asentado: previo.valor,
      propuesto: c.valor,
      citaAsentada: previo.cita,
      citaPropuesta: c.cita ?? '',
      motivo: 'dos fuentes dan valores distintos para el mismo campo'
    }))
    // El valor asentado SE CONSERVA. Cambiarlo exige una CONTRADICCION
    // explícita, que es un hecho que una persona firma.
    return
  }

  const evidencia = previo ? promover(previo.evidencia, c.evidencia) : c.evidencia

  exp.campos.set(c.ruta, Object.freeze({
    ruta: c.ruta,
    valor: previo && evidencia === previo.evidencia && nivelEvidencia(c.evidencia) < nivelEvidencia(previo.evidencia)
      ? previo.valor            // el valor viaja con la evidencia que lo respalda
      : c.valor,
    cita: c.cita ?? '',
    evidencia,
    origen: e.origen,
    seq: e.seq
  }))
}

// ═══════════════════════════════════════════════════════════════════════════
//  El cierre
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Los campos salen ORDENADOS POR RUTA, no por orden de llegada.
 *
 * No es cosmética: es lo que hace que dos dispositivos que recibieron los mismos
 * hechos en distinto orden serialicen el mismo JSON, byte a byte. Sin esto, el
 * invariante O5 y la convergencia de la malla se caen a la vez.
 */
function congelar (exp, eventos) {
  const campos = {}
  for (const ruta of [...exp.campos.keys()].sort()) campos[ruta] = exp.campos.get(ruta)

  // Los huecos también salen ordenados por ruta, y por la misma razón: dos
  // dispositivos con los mismos hechos tienen que serializar el mismo JSON.
  const huecos = {}
  for (const ruta of [...exp.huecos.keys()].sort()) huecos[ruta] = exp.huecos.get(ruta)

  return Object.freeze({
    id: exp.id,
    estado: exp.estado,
    campos: Object.freeze(campos),
    huecos: Object.freeze(huecos),
    fuentes: Object.freeze(exp.fuentes.map(Object.freeze)),
    duplicadoDe: exp.duplicadoDe,
    historial: Object.freeze(exp.historial.map(Object.freeze)),
    decisiones: Object.freeze(exp.decisiones.map(Object.freeze)),
    contradicciones: Object.freeze(exp.contradicciones.map(Object.freeze)),
    // Campos donde dos fuentes se contradicen. NO se resuelven solos.
    conflictos: Object.freeze(exp.conflictos.map(Object.freeze)),
    resumen: Object.freeze({
      eventos: eventos.length,
      camposAsentados: Object.keys(campos).length,
      camposRechazados: exp.rechazados,
      huecosAbiertos: Object.keys(huecos).length,
      camposPropuestos: exp.propuestos,
      conflictosAbiertos: exp.conflictos.length,
      ultimoHash: eventos[eventos.length - 1]?.hash ?? null,
      porEvidencia: contarPorEvidencia(campos)
    })
  })
}

function contarPorEvidencia (campos) {
  const n = Object.fromEntries(EVIDENCIA.map(g => [g, 0]))
  for (const c of Object.values(campos)) n[c.evidencia] = (n[c.evidencia] ?? 0) + 1
  return Object.freeze(n)
}

function vacio () {
  return Object.freeze({
    id: null, estado: null, campos: Object.freeze({}), huecos: Object.freeze({}), fuentes: Object.freeze([]),
    duplicadoDe: null, historial: Object.freeze([]), decisiones: Object.freeze([]),
    contradicciones: Object.freeze([]), conflictos: Object.freeze([]),
    resumen: Object.freeze({
      eventos: 0, camposAsentados: 0, camposRechazados: 0, huecosAbiertos: 0,
      conflictosAbiertos: 0, camposPropuestos: 0,
      ultimoHash: null, porEvidencia: contarPorEvidencia({})
    })
  })
}

/**
 * ¿Son el mismo valor? Se compara normalizado, porque «Juan Pérez» y
 * «JUAN PEREZ» son la misma persona y no un conflicto — pero «Juan Pérez» y
 * «Juan Peres» SÍ lo son: una letra de diferencia es otra persona, igual que
 * en el anclaje.
 */
function mismoValor (a, b) {
  if (a === b) return true
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b)
  return normalizar(String(a ?? '')) === normalizar(String(b ?? ''))
}

/**
 * La serialización canónica del expediente: lo que se compara para probar O5 y
 * lo que se sincroniza entre dispositivos. Claves ordenadas por construcción.
 */
export function serializar (expediente) {
  return JSON.stringify(expediente, null, 2)
}
