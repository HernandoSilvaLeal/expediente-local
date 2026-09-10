// pruebas/serie.test.mjs — T6a
//
// Aquí se prueba la parte del sistema que más caro sale si falla: la concurrencia.
// Corre SIN el SDK y SIN modelo, que es exactamente por lo que esta maquinaria
// vive en core/ y no en ia/.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { crearSerie, coalescer, memorizar, conPlazo, reintentar, ColaLlena, Expirado } from '../core/serie.mjs'

const tic = (ms = 0) => new Promise(r => setTimeout(r, ms))

// ═════════════════════════════════════════════════════════════════════
//  La serie: de una en una, en orden
// ═════════════════════════════════════════════════════════════════════

test('T6a-01 · las tareas corren DE UNA EN UNA, nunca solapadas', async () => {
  const s = crearSerie()
  let simultaneas = 0, pico = 0
  const tarea = async () => {
    simultaneas++; pico = Math.max(pico, simultaneas)
    await tic(5)
    simultaneas--
  }
  await Promise.all(Array.from({ length: 10 }, () => s.hacer(tarea)))
  assert.equal(pico, 1, 'dos completions sobre el mismo modelo no pueden ir simultaneas')
})

test('T6a-02 · el orden de salida es el de llegada', async () => {
  const s = crearSerie()
  const salida = []
  await Promise.all([3, 1, 2, 0].map((espera, i) =>
    s.hacer(async () => { await tic(espera); salida.push(i) })))
  assert.deepEqual(salida, [0, 1, 2, 3], 'FIFO: el que llega primero se atiende primero')
})

test('T6a-03 · una tarea que REVIENTA no mata la cola', async () => {
  // Sin el re-arme en finally, la primera excepción deja el proceso colgado
  // para siempre y sin decir por qué.
  const s = crearSerie()
  await assert.rejects(s.hacer(() => { throw new Error('boom') }), /boom/)
  assert.equal(await s.hacer(() => 'sigo viva'), 'sigo viva')
})

test('T6a-04 · el error llega a QUIEN encoló esa tarea, no a otro', async () => {
  const s = crearSerie()
  const p1 = s.hacer(async () => { await tic(5); return 'bien' })
  const p2 = s.hacer(() => { throw new Error('solo yo') })
  const p3 = s.hacer(() => 'también bien')
  assert.equal(await p1, 'bien')
  await assert.rejects(p2, /solo yo/)
  assert.equal(await p3, 'también bien')
})

test('T6a-05 · pasado el límite, la cola RECHAZA en vez de tragar', async () => {
  // Es el fondo de 64 del SDK, replicado aquí y mucho más bajo a propósito:
  // así la contrapresión la nota quien encola, no el modelo.
  const s = crearSerie({ limite: 3 })
  const lentas = Array.from({ length: 4 }, () => s.hacer(() => tic(20)))
  await assert.rejects(s.hacer(() => 'la de más'), ColaLlena)
  await Promise.allSettled(lentas)
})

test('T6a-06 · el estado dice el PICO real de espera, no el actual', async () => {
  const s = crearSerie()
  await Promise.all(Array.from({ length: 5 }, () => s.hacer(() => tic(2))))
  const e = s.estado()
  assert.equal(e.hechas, 5)
  assert.equal(e.enEspera, 0)
  assert.ok(e.picoEspera >= 4, 'el pico es lo que se enseña en el CSV de auditoría')
})

test('T6a-07 · el estado es inmutable', async () => {
  const s = crearSerie()
  assert.throws(() => { s.estado().hechas = 99 }, TypeError)
  assert.throws(() => { s.hacer = null }, TypeError)
})

// ═════════════════════════════════════════════════════════════════════
//  Coalescencia: loadModel NO está gateado por el SDK
// ═════════════════════════════════════════════════════════════════════

test('T6a-08 · diez cargas simultáneas del MISMO modelo son UNA sola', async () => {
  let veces = 0
  const cargar = coalescer(async (clave) => { veces++; await tic(10); return `id:${clave}` })
  const rs = await Promise.all(Array.from({ length: 10 }, () => cargar('medpsy')))
  assert.equal(veces, 1, 'sin esto son diez cargas de verdad, con su RAM y su tiempo')
  assert.deepEqual(new Set(rs), new Set(['id:medpsy']))
})

test('T6a-09 · modelos DISTINTOS sí cargan por separado', async () => {
  let veces = 0
  const cargar = coalescer(async (c) => { veces++; await tic(5); return c })
  await Promise.all([cargar('a'), cargar('b'), cargar('a')])
  assert.equal(veces, 2)
})

test('T6a-10 · una carga FALLIDA no se queda cacheada', async () => {
  // Si la limpieza fuese en .then y no en .finally, la promesa fallida quedaría
  // en el mapa y el modelo NO volvería a cargar en toda la vida del proceso.
  let veces = 0
  const cargar = coalescer(async () => { veces++; if (veces === 1) throw new Error('disco lleno'); return 'ok' })
  await assert.rejects(cargar('m'), /disco lleno/)
  assert.equal(await cargar('m'), 'ok', 'el segundo intento tiene que poder cargar')
  assert.equal(veces, 2)
})

test('T6a-11 · terminada la carga, el mapa queda limpio', async () => {
  const cargar = coalescer(async () => { await tic(2); return 1 })
  const p = cargar('x')
  assert.equal(cargar.enVuelo(), 1)
  await p
  assert.equal(cargar.enVuelo(), 0, 'un mapa que solo crece es una fuga de memoria con otro nombre')
})

// ═════════════════════════════════════════════════════════════════════
//  Memorizar ≠ coalescer — la distinción que costó un bug real
// ═════════════════════════════════════════════════════════════════════

test('T6a-M1 · SECUENCIALMENTE, coalescer vuelve a ejecutar y memorizar NO', () => {
  // ESTE es el bug que tuvo T6a-21: con la cola serializando de una en una,
  // cuando la segunda tarea pedía el modelo la carga de la primera ya había
  // terminado y se había limpiado del mapa. Cien cargas para cien extracciones.
  // La coalescencia no falló: era la herramienta equivocada.
  return (async () => {
    let a = 0, b = 0
    const coalescida = coalescer(async () => { a++; return 'x' })
    const memorizada = memorizar(async () => { b++; return 'x' })

    for (let i = 0; i < 5; i++) { await coalescida('m'); await memorizada('m') }

    assert.equal(a, 5, 'coalescer comparte lo EN VUELO; secuencialmente no comparte nada')
    assert.equal(b, 1, 'memorizar recuerda: un modelo cargado se queda cargado')
  })()
})

test('T6a-M2 · memorizar también comparte lo en vuelo', async () => {
  let veces = 0
  const m = memorizar(async () => { veces++; await tic(10); return 'v' })
  await Promise.all(Array.from({ length: 8 }, () => m('m')))
  assert.equal(veces, 1)
})

test('T6a-M3 · memorizar NO recuerda los fallos', async () => {
  let veces = 0
  const m = memorizar(async () => { veces++; if (veces === 1) throw new Error('sin RAM'); return 'ok' })
  await assert.rejects(m('m'), /sin RAM/)
  assert.equal(await m('m'), 'ok', 'solo se recuerda lo que salió bien')
  assert.equal(m.recordadas(), 1)
})

test('T6a-M4 · olvidar permite el ciclo unloadModel / loadModel', async () => {
  // Un recurso memorizado que no se puede invalidar es una fuga con nombre bonito.
  let veces = 0
  const m = memorizar(async () => { veces++; return `carga-${veces}` })
  assert.equal(await m('m'), 'carga-1')
  assert.equal(await m('m'), 'carga-1')
  m.olvidar('m')
  assert.equal(await m('m'), 'carga-2', 'tras descargar, la siguiente vuelve a cargar de verdad')
})

// ═════════════════════════════════════════════════════════════════════
//  El plazo
// ═════════════════════════════════════════════════════════════════════

test('T6a-12 · lo que tarda de más se corta con Expirado', async () => {
  await assert.rejects(conPlazo(tic(500), 20, 'la extracción'), Expirado)
})

test('T6a-13 · lo que llega a tiempo pasa intacto', async () => {
  assert.equal(await conPlazo(Promise.resolve('valor'), 200), 'valor')
})

test('T6a-14 · el error propio gana al plazo', async () => {
  await assert.rejects(conPlazo(Promise.reject(new Error('el mío')), 200), /el mío/)
})

test('T6a-15 · el mensaje de Expirado dice QUÉ expiró y en cuánto', async () => {
  // Un timeout que solo dice "timeout" obliga a adivinar cuál de las cuatro
  // llamadas de la tubería fue.
  try { await conPlazo(tic(200), 15, 'la carga del modelo'); assert.fail('debía expirar') }
  catch (e) { assert.match(e.message, /la carga del modelo/); assert.match(e.message, /15 ms/) }
})

test('T6a-16 · el temporizador se limpia SIEMPRE', async () => {
  // Un setTimeout vivo mantiene el bucle de eventos despierto y el proceso no
  // termina: `npm test` pasa todos los tests y se queda colgado, sin nada en rojo.
  const antes = process._getActiveHandles?.().length ?? 0
  for (let i = 0; i < 50; i++) await conPlazo(Promise.resolve(i), 10_000)
  await tic(10)
  const despues = process._getActiveHandles?.().length ?? 0
  assert.ok(despues <= antes + 1, `quedaron temporizadores vivos: ${antes} → ${despues}`)
})

// ═════════════════════════════════════════════════════════════════════
//  El reintento
// ═════════════════════════════════════════════════════════════════════

test('T6a-17 · reintenta lo transitorio y acaba devolviendo el valor', async () => {
  let n = 0
  const r = await reintentar(async () => { if (++n < 3) throw new Error('ocupado'); return 'ok' },
    { intentos: 5, dormir: () => Promise.resolve() })
  assert.equal(r, 'ok')
  assert.equal(n, 3)
})

test('T6a-18 · NO reintenta lo que no lo merece', async () => {
  // Reintentar un error de validación es quemar tiempo para volver a fallar igual.
  let n = 0
  await assert.rejects(
    reintentar(async () => { n++; const e = new Error('esquema inválido'); e.fatal = true; throw e },
      { intentos: 5, debeReintentar: (e) => !e.fatal, dormir: () => Promise.resolve() }),
    /esquema inválido/)
  assert.equal(n, 1, 'un solo intento: el error dijo que no tenía arreglo')
})

test('T6a-19 · agotados los intentos, propaga el ÚLTIMO error', async () => {
  let n = 0
  await assert.rejects(
    reintentar(async () => { throw new Error(`intento ${++n}`) },
      { intentos: 3, dormir: () => Promise.resolve() }),
    /intento 3/)
})

test('T6a-20 · la espera crece: 200, 400, 800', async () => {
  const esperas = []
  await assert.rejects(
    reintentar(async () => { throw new Error('x') },
      { intentos: 4, esperaMs: 200, factor: 2, dormir: (ms) => { esperas.push(ms); return Promise.resolve() } }),
    /x/)
  assert.deepEqual(esperas, [200, 400, 800], 'reintentar al mismo ritmo es insistir, no esperar')
})

// ═════════════════════════════════════════════════════════════════════
//  Las tres piezas juntas, que es como se usan de verdad
// ═════════════════════════════════════════════════════════════════════

test('T6a-21 · serie + memorizar + plazo: cien tareas, una carga, cero solapes', async () => {
  const s = crearSerie({ limite: 200 })
  let cargas = 0, simultaneas = 0, pico = 0
  // memorizar, NO coalescer: la serie ejecuta de una en una, así que cuando la
  // segunda pide el modelo la carga de la primera ya terminó. Ver T6a-M1.
  const cargar = memorizar(async () => { cargas++; await tic(5); return 'modelo' })

  const trabajos = Array.from({ length: 100 }, (_, i) => s.hacer(async () => {
    await cargar('medpsy')
    simultaneas++; pico = Math.max(pico, simultaneas)
    const r = await conPlazo(tic(1).then(() => i), 1000, 'la extracción')
    simultaneas--
    return r
  }))

  const rs = await Promise.all(trabajos)
  assert.equal(cargas, 1, 'una sola carga para cien extracciones')
  assert.equal(pico, 1, 'ni un solo solape sobre el mismo modelo')
  assert.deepEqual(rs, Array.from({ length: 100 }, (_, i) => i), 'y en orden')
  assert.ok(s.estado().picoEspera > 50, 'la cola sí llegó a acumular: el test no es trivial')
})
