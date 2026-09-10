// core/serie.mjs — la maquinaria de concurrencia. SIN SDK, y por eso se puede probar.
//
// ═══════════════════════════════════════════════════════════════════════════
//   Los fallos de concurrencia son intermitentes. Un fallo intermitente a las
//   tres de la mañana no se depura: se sufre. Por eso esta parte vive fuera
//   de `ia/`, donde los tests sí la alcanzan sin cargar un modelo de gigas.
// ═══════════════════════════════════════════════════════════════════════════
//
// ── QUÉ RESUELVE, Y POR QUÉ NO LO RESUELVE EL SDK ──────────────────────────
//
// Verificado abriendo @qvac/sdk@0.18.2 en esta máquina
// (`dist/server/bare/runtime/request-registry-singleton.js`):
//
//     r.policy({ kind: 'completion', maxConcurrentPerModel: 1,
//                onOverflow: 'queue', maxQueueDepthPerModel: 64, … })
//
// O sea: **el SDK SÍ encola.** Dos `completion()` sobre el mismo modelo no se
// pisan; la segunda espera su turno. Un mutex global propio sería código muerto,
// y durante un tiempo el corpus dijo lo contrario porque repitió una conclusión
// de otro proyecto sin repetir su verificación.
//
// Lo que el SDK NO hace, y sí es nuestro:
//
//   1. LA COLA TIENE FONDO: 64. La petición 65 no espera, RECHAZA con
//      `RequestRejectedByPolicyError`. Lanzar `Promise.all` sobre doscientas
//      observaciones no es «ir rápido»: es perder ciento treinta y seis.
//
//   2. `loadModel` NO ESTÁ GATEADO — usa `kind:'loadModel'` sin `modelId`, y sin
//      `modelId` no se aplica política. Dos cargas simultáneas del mismo modelo
//      son dos cargas de verdad, con su RAM y su tiempo por duplicado.
//
//   3. `embed` NO ESTÁ GATEADO — sin política registrada, sin límite y sin
//      contrapresión. Es la etapa que más llamadas dispara en la deduplicación.
//
// PROHIBIDO aquí: importar @qvac/sdk. Verificado por scripts/verificar-frontera.mjs

export class ColaLlena extends Error {
  constructor (limite) {
    super(`La cola llegó a ${limite} tareas en espera y rechaza más. ` +
          'Es el mismo fondo que impone el SDK: sirve para que la contrapresión ' +
          'la note quien encola, no el modelo.')
    this.name = 'ColaLlena'
    this.limite = limite
  }
}

export class Expirado extends Error {
  constructor (ms, que) {
    super(`${que} pasó de ${ms} ms sin responder. Un cuelgue sin plazo es un cuelgue eterno.`)
    this.name = 'Expirado'
    this.ms = ms
  }
}

/**
 * Ejecuta tareas DE UNA EN UNA, en orden de llegada.
 *
 * `limite` se queda MUY por debajo del fondo de 64 del SDK a propósito: así el
 * rechazo por contrapresión ocurre aquí, donde se puede reintentar con criterio,
 * y no allí, donde llega como un error de política a mitad de un lote.
 *
 * El re-arme va en `finally`: si una tarea revienta, la cola sigue viva. Una cola
 * que se muere con la primera excepción deja el proceso colgado sin decir por qué.
 */
export function crearSerie ({ limite = 16 } = {}) {
  const espera = []
  let corriendo = false
  let hechas = 0
  let picoEspera = 0

  const bombear = () => {
    if (corriendo || espera.length === 0) return
    corriendo = true
    const { tarea, resolver, rechazar } = espera.shift()

    Promise.resolve()
      .then(tarea)
      .then(resolver, rechazar)
      .finally(() => {          // ← el re-arme. Sin esto, un fallo mata la cola entera
        corriendo = false
        hechas++
        bombear()
      })
  }

  return Object.freeze({
    /** Encola una tarea y devuelve su promesa. */
    hacer (tarea) {
      if (espera.length >= limite) return Promise.reject(new ColaLlena(limite))
      return new Promise((resolver, rechazar) => {
        espera.push({ tarea, resolver, rechazar })
        picoEspera = Math.max(picoEspera, espera.length)
        bombear()
      })
    },
    /** Lo que se enseña en el CSV de auditoría: cuánto llegó a acumularse de verdad. */
    estado: () => Object.freeze({ enEspera: espera.length, corriendo, hechas, picoEspera, limite })
  })
}

/**
 * Comparte la promesa en vuelo por clave.
 *
 * Es la respuesta al hueco 2: `loadModel` no está gateado, así que dos llamadas
 * simultáneas al mismo modelo son dos cargas de verdad. Con esto, la segunda
 * recibe la promesa de la primera.
 *
 * La limpieza va en `finally` y no en `then`: si la carga falla, la promesa
 * fallida NO puede quedarse cacheada, o el modelo no volvería a cargar nunca
 * en toda la vida del proceso.
 */
export function coalescer (fn) {
  const enVuelo = new Map()

  const envuelta = (clave, ...args) => {
    if (enVuelo.has(clave)) return enVuelo.get(clave)
    const p = Promise.resolve()
      .then(() => fn(clave, ...args))
      .finally(() => { enVuelo.delete(clave) })   // ← también si falló
    enVuelo.set(clave, p)
    return p
  }
  envuelta.enVuelo = () => enVuelo.size
  return envuelta
}

/**
 * Como `coalescer`, pero además RECUERDA el resultado.
 *
 * ── LA DIFERENCIA, QUE COSTÓ UN BUG ───────────────────────────────────────
 *
 * `coalescer` comparte solo lo que está en vuelo **a la vez**. Sirve cuando dos
 * llamadas simultáneas no deben duplicarse, pero una llamada posterior sí debe
 * volver a ejecutar.
 *
 * Un modelo cargado NO es eso: se carga una vez y se queda cargado.
 *
 * El bug: con la cola serializando las extracciones de una en una, cuando la
 * segunda pedía el modelo la carga de la primera ya había terminado y se había
 * limpiado del mapa. Resultado medido por el test: **cien cargas para cien
 * extracciones**, con sus gigas y su tiempo, cada una. La coalescencia no falló
 * —hizo exactamente lo suyo—; era la herramienta equivocada.
 *
 * `olvidar` existe porque el ciclo `unloadModel`/`loadModel` es real: un recurso
 * memorizado que no se puede invalidar es una fuga con nombre bonito.
 */
export function memorizar (fn) {
  const listos = new Map()
  const enVuelo = new Map()

  const envuelta = (clave, ...args) => {
    if (listos.has(clave)) return Promise.resolve(listos.get(clave))
    if (enVuelo.has(clave)) return enVuelo.get(clave)

    const p = Promise.resolve()
      .then(() => fn(clave, ...args))
      .then((v) => { listos.set(clave, v); return v })   // solo se recuerda lo que SALIÓ BIEN
      .finally(() => { enVuelo.delete(clave) })

    enVuelo.set(clave, p)
    return p
  }
  envuelta.olvidar = (clave) => listos.delete(clave)
  envuelta.olvidarTodo = () => { listos.clear() }
  envuelta.recordadas = () => listos.size
  envuelta.enVuelo = () => enVuelo.size
  return envuelta
}

/**
 * Pone plazo a una promesa.
 *
 * El temporizador se limpia SIEMPRE. Un `setTimeout` vivo mantiene el bucle de
 * eventos despierto, y el proceso no termina: el síntoma es un `npm test` que
 * pasa todos los tests y se queda colgado, que es de los fallos más molestos
 * de diagnosticar porque no hay nada en rojo.
 */
export function conPlazo (promesa, ms, que = 'la operación') {
  let id
  const alarma = new Promise((_, rechazar) => {
    id = setTimeout(() => rechazar(new Expirado(ms, que)), ms)
    if (typeof id?.unref === 'function') id.unref()
  })
  return Promise.race([promesa, alarma]).finally(() => clearTimeout(id))
}

/**
 * Reintenta con espera creciente, pero SOLO lo que merece reintentarse.
 *
 * `debeReintentar` se recibe de fuera a propósito: qué es transitorio depende del
 * SDK, y este módulo no lo conoce ni quiere conocerlo. Reintentar un error de
 * validación es quemar tiempo para volver a fallar igual.
 *
 * La espera se recibe por inyección (`dormir`) para que los tests no tarden
 * segundos de verdad.
 */
export async function reintentar (tarea, {
  intentos = 3, esperaMs = 200, factor = 2,
  debeReintentar = () => true,
  dormir = (ms) => new Promise(r => setTimeout(r, ms))
} = {}) {
  let ultimo
  for (let i = 0; i < intentos; i++) {
    try { return await tarea(i) } catch (e) {
      ultimo = e
      if (i === intentos - 1 || !debeReintentar(e)) throw e
      await dormir(esperaMs * factor ** i)
    }
  }
  throw ultimo
}
