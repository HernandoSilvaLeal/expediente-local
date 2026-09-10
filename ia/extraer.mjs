// ia/extraer.mjs — EL ÚNICO ARCHIVO DE TODO EL PROYECTO QUE TOCA EL MODELO.
//
// ═══════════════════════════════════════════════════════════════════════════
//   Aquí acaba el software y empieza la estadística.
//   Todo lo que sale de este archivo es una PROPUESTA, nunca un hecho.
// ═══════════════════════════════════════════════════════════════════════════
//
// Quien lea el repo puede comprobar esa frase con un comando, no con confianza:
//
//     npm run test:frontera     # falla si core/ o pruebas/ importan @qvac/*
//
// ── LO QUE ESTE ARCHIVO NO HACE ────────────────────────────────────────────
//
// No decide. No valida. No ancla. No transita estados. No escribe en el ledger.
// Recibe texto, pide campos con su cita, y devuelve lo que el modelo dijo —
// aunque sea mentira. Comprobarlo es trabajo de `core/`, que corre sin él.
//
// Esa separación es la que permite que el 100 % de la lógica de decisión tenga
// tests que corren sin modelo, sin red y sin GPU, en menos de un segundo.
//
// ── LA MAQUINARIA PELIGROSA ESTÁ FUERA, A PROPÓSITO ────────────────────────
//
// La cola, la memorización de la carga, el plazo y el reintento viven en
// `core/serie.mjs`, que no importa el SDK y sí tiene 25 tests. Los fallos de
// concurrencia son intermitentes, y lo intermitente hay que poder reproducirlo.
//
// ── VERSIÓN ────────────────────────────────────────────────────────────────
//
// Escrito contra **@qvac/sdk 0.18.2**, instalado y leído en esta máquina el
// 10-sep-2026: cada símbolo que se importa aquí se comprobó abriendo el paquete,
// y los ejemplos oficiales que trae en `dist/examples/` son la fuente de la
// mecánica de delegación. La API está verificada, no supuesta.

import {
  loadModel, completion, unloadModel, close,
  RequestRejectedByPolicyError
} from '@qvac/sdk'

import { crearSerie, memorizar, conPlazo, reintentar } from '../core/serie.mjs'
// El prompt es una función PURA del esquema, así que vive en core/ y tiene tests.
// Dejarlo aquí lo habría metido en el único directorio donde los tests no llegan.
import { construirSistema } from '../core/prompt.mjs'

/** Errores tipados: quien llama decide qué hacer según la CLASE, no leyendo un mensaje. */
export class ModeloDevolvioBasura extends Error {
  constructor (crudo, causa) {
    super(`El modelo devolvió algo que no es JSON válido (${causa}). ` +
          'Con json_schema activo esto es raro, y por eso conviene verlo.')
    this.name = 'ModeloDevolvioBasura'
    this.crudo = String(crudo).slice(0, 500)
  }
}

export class ExtraccionRechazada extends Error {
  constructor (causa) {
    super(`El SDK rechazó la petición: ${causa}. ` +
          'Si es por política, la cola llegó a su fondo de 64: hay que encolar menos, no reintentar más.')
    this.name = 'ExtraccionRechazada'
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  EL EXTRACTOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param {object} opciones
 * @param {string} opciones.modelSrc      ruta o constante de modelo del SDK
 * @param {object} [opciones.delegate]    {providerPublicKey, timeout, fallbackToLocal}
 * @param {object} [opciones.modelConfig] ctx_size, gpu_layers, device…
 * @param {number} [opciones.plazoMs]     plazo por extracción
 * @param {number} [opciones.semilla]     seed fija: sin ella no hay reproducibilidad
 */
export function crearExtractor ({
  modelSrc,
  delegate = null,
  modelConfig = { ctx_size: 4096 },
  plazoMs = 30_000,
  plazoCargaMs = 90_000,
  semilla = 42,
  limiteCola = 16,
  predict = 700
} = {}) {
  if (!modelSrc) throw new Error('crearExtractor necesita modelSrc')

  // TRAMPA · la cola del SDK tiene fondo 64 y la 65 RECHAZA. Se encola aquí,
  // muy por debajo, para que la contrapresión la note quien pide y no el modelo.
  const serie = crearSerie({ limite: limiteCola })

  // TRAMPA · `loadModel` NO está gateado por el SDK: sin esto, dos peticiones
  // simultáneas son dos cargas de verdad. Y es `memorizar`, no `coalescer`:
  // un modelo cargado se queda cargado (ver core/serie.mjs y T6a-M1).
  const cargar = memorizar(async () => {
    const params = { modelSrc, modelConfig }

    // TRAMPA · `delegate` va en loadModel, NO en completion. Verificado en el
    // ejemplo oficial dist/examples/delegated-inference/consumer.js.
    if (delegate) {
      params.delegate = {
        providerPublicKey: delegate.providerPublicKey,
        // El propio SDK avisa: arrancar hyperdht y localizar la clave del
        // proveedor tarda 15-45 s LA PRIMERA VEZ. Un plazo corto aquí aborta
        // el camino feliz y se diagnostica como avería de red. Ya pasó.
        timeout: delegate.timeout ?? 60_000,
        fallbackToLocal: delegate.fallbackToLocal ?? true,
        forceNewConnection: delegate.forceNewConnection ?? false
      }
    }
    return conPlazo(loadModel(params), plazoCargaMs, 'la carga del modelo')
  })

  const registro = []
  let llamadas = 0

  /**
   * Pide al modelo los campos de un texto.
   *
   * @returns {{objeto: object, stats: object, crudo: string}}
   */
  async function extraer (texto, esquema, { sistema } = {}) {
    if (typeof texto !== 'string' || !texto.trim()) {
      throw new Error('extraer() necesita un texto no vacío')
    }
    if (!esquema?.jsonSchema?.name) {
      // TRAMPA 13 · sin json_schema.name el SDK responde
      // "Invalid input: expected string, received undefined", que no menciona
      // el campo que falta. Se comprueba aquí para dar un error que sí lo dice.
      throw new Error('El esquema no trae json_schema.name, y el SDK lo exige')
    }

    return serie.hacer(async () => {
      const modelId = await cargar('modelo')
      const t0 = Date.now()

      const pedir = () => {
        const r = completion({
          modelId,
          history: [
            { role: 'system', content: sistema ?? construirSistema(esquema) },
            { role: 'user', content: texto }
          ],
          // TRAMPA · `stream` EXPLÍCITO. Dejarlo al valor por defecto hace que el
          // comportamiento dependa de la versión del SDK, y este archivo tiene
          // que dar el mismo resultado en la máquina del juez que en la nuestra.
          stream: false,
          // TRAMPA · NUNCA `tools` junto a `responseFormat`: se ignoran
          // mutuamente y en silencio, que es la peor combinación posible.
          responseFormat: {
            type: 'json_schema',
            json_schema: esquema.jsonSchema      // ya validado por core/esquema.mjs
          },
          generationParams: {
            temp: 0,                 // sin esto no hay determinismo que enseñar
            seed: semilla,           // ni reproducibilidad entre corridas
            predict,
            // TRAMPA · sin `reasoning_budget: 0` el modelo razona antes de
            // responder y el JSON tarda un orden de magnitud más.
            reasoning_budget: 0
          }
        })
        return r
      }

      let r
      try {
        r = await reintentar(pedir, {
          intentos: 2,
          esperaMs: 300,
          // Un rechazo por política NO se reintenta: la cola está llena y
          // reintentar la llena más. Se reintenta lo transitorio y nada más.
          debeReintentar: (e) => !(e instanceof RequestRejectedByPolicyError)
        })
      } catch (e) {
        if (e instanceof RequestRejectedByPolicyError) throw new ExtraccionRechazada(e.message)
        throw e
      }

      const final = await conPlazo(r.final, plazoMs, 'la extracción')
      const crudo = String(final?.contentText ?? '').trim()

      let objeto
      try { objeto = JSON.parse(crudo) } catch (e) { throw new ModeloDevolvioBasura(crudo, e.message) }

      const stats = (await r.stats) ?? {}
      llamadas++

      // TRAMPA · el PRIMER TTFT se marca como frío y se descarta de la mediana.
      // El arranque en frío contamina la media entera y produce un número que
      // no describe nada: ni el caso frío ni el caliente.
      const fila = Object.freeze({
        n: llamadas,
        frio: llamadas === 1,
        paredMs: Date.now() - t0,
        ttftMs: redondear(stats.timeToFirstToken),
        tokS: redondear(stats.tokensPerSecond, 1),
        promptTokens: stats.promptTokens ?? null,
        emitidos: stats.emittedTokens ?? null,
        // El dispositivo se lee de stats.backendDevice (0=CPU, 1=GPU).
        // getSystemResources() NO sirve para esto.
        dispositivo: stats.backendDevice ?? null,
        // ── LO QUE PEDIMOS, NO LO QUE PASÓ. Y SE LLAMA COMO LO QUE ES ───────
        //
        // Este campo se llamaba `delegado` y valía `Boolean(delegate)`. Es
        // decir: informaba de su propio parámetro de entrada y lo publicaba en
        // `audit/inference_log.csv` como si fuera una observación.
        //
        // Si la delegación se pide y cae a local —que es justo lo que hace
        // `fallbackToLocal`— la fila decía «delegado: true» mientras la
        // inferencia corría en esta máquina. Un campo de auditoría que afirma
        // algo que no midió es peor que no tener el campo: lo encontró nuestra
        // propia auditoría, que es exactamente donde más duele.
        //
        // Se buscó la verdad en el SDK: `@qvac/inference` 0.18.2 no expone
        // dónde se ejecutó la inferencia en ningún campo de `stats` —el único
        // «delegated» del paquete está dentro de un comentario—. Así que el
        // dato NO EXISTE, y se dice, en vez de inventarlo.
        delegacionSolicitada: Boolean(delegate),
        ejecutadoEn: 'NO_REPORTADO',
        caracteres: texto.length
      })
      registro.push(fila)

      return Object.freeze({ objeto, crudo, stats: fila })
    })
  }

  return Object.freeze({
    extraer,

    /** Las filas del `audit/inference_log.csv`. La primera va marcada como fría. */
    telemetria: () => Object.freeze({
      filas: Object.freeze([...registro]),
      cola: serie.estado(),
      medianas: medianas(registro.filter(f => !f.frio)),
      version: '0.18.2',
      nota: registro.length
        ? 'la fila 1 está marcada `frio: true` y NO entra en las medianas'
        : 'sin llamadas todavía'
    }),

    /**
     * Descarga el modelo y cierra el SDK.
     *
     * `olvidar` es obligatorio: si el modelo se descarga pero se sigue
     * recordando su id, la siguiente extracción usaría un identificador muerto.
     */
    async cerrar () {
      try {
        const id = cargar.recordadas() ? await cargar('modelo') : null
        if (id) await unloadModel({ modelId: id })
      } finally {
        cargar.olvidar('modelo')
        await close()
      }
    }
  })
}

// ── Utilidades pequeñas ──────────────────────────────────────────────────────

function redondear (x, dec = 0) {
  return typeof x === 'number' && Number.isFinite(x) ? Number(x.toFixed(dec)) : null
}

/** Mediana, no media: un único arranque lento desplaza la media y no la mediana. */
function medianas (filas) {
  if (filas.length === 0) return null
  const med = (clave) => {
    const xs = filas.map(f => f[clave]).filter(x => typeof x === 'number').sort((a, b) => a - b)
    return xs.length ? xs[Math.floor(xs.length / 2)] : null
  }
  return Object.freeze({ paredMs: med('paredMs'), ttftMs: med('ttftMs'), tokS: med('tokS'), n: filas.length })
}
