// pruebas/ui.test.mjs — la interfaz, que era la única parte sin probar.
//
// ═══════════════════════════════════════════════════════════════════════════
//   Once suites, 324 tests, y NINGUNA tocaba ui/. Justo la parte que el
//   jurado va a ver, y la única que nadie comprobaba.
// ═══════════════════════════════════════════════════════════════════════════
//
// ── POR QUÉ EXISTE ESTE ARCHIVO ────────────────────────────────────────────
//
// Una exploración encontró que `ui/index.html` tenía SESENTA LÍNEAS DUPLICADAS
// —una segunda copia de `resaltar()`, `normalizar()` y el cableado de la
// identidad, pegadas dentro del `try` del botón de resolver—. El efecto visible:
// al resolver un conflicto en EXP-003, la vista saltaba a EXP-001.
//
// No lo cazó la suite: la suite no miraba aquí. Y el defecto era mío, de ese
// mismo día, hecho con un `replace` sobre HTML que nadie verificó renderizado.
//
// Se levanta el servidor DE VERDAD, en un puerto libre, contra un directorio
// temporal. Nada de simular: si el contrato con el navegador se rompe, este
// archivo lo dice.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, cpSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

import { FUENTE_ART18, titularArt18, operacionArt18 } from './fixtures.mjs'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')

// Puerto alto y poco transitado: si la suite corre mientras alguien tiene la
// demo abierta en 7301, no se pisan.
const PUERTO = 7411
const BASE = `http://127.0.0.1:${PUERTO}`

let servidor, dir

/** Espera a que el servidor conteste. Sondear es más honesto que dormir un rato fijo. */
async function esperar (intentos = 60) {
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(`${BASE}/api/expedientes`)
      if (r.ok) return
    } catch { /* todavía no escucha */ }
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('el servidor no arrancó')
}

/**
 * Crea un expediente propio del test, con su conflicto ya dentro.
 *
 * Antes los tests compartían EXP-003, y el que resolvía primero dejaba sin
 * conflicto al siguiente. Cada test que MUTA trabaja sobre lo suyo: si dos
 * pruebas se pisan, lo que falla no es el sistema, es el andamio.
 */
async function expedienteConConflicto (id) {
  const doc = {
    tipo: 'RECIBO_SERVICIO',
    emisor: { valor: 'IDAAN', cita: 'el recibo del IDAAN' },
    fecha_emision: { valor: '20 de agosto de 2026', cita: 'del 20 de agosto de 2026' },
    monto: { valor: 45.30, cita: 'por 45.30 balboas' }
  }
  const base = (nombre, cita) => ({
    titular: { ...titularArt18(), nombre: { valor: nombre, cita } },
    operacion: operacionArt18(),
    documentos: [doc]
  })

  await post(`/api/capturar/${id}`, {
    rol: 'oficial', texto: FUENTE_ART18,
    extraccion: base('Juan Pérez González', 'El titular es Juan Pérez González')
  })
  await post(`/api/capturar/${id}`, {
    rol: 'oficial',
    texto: FUENTE_ART18.replace('El titular es Juan Pérez González',
                                'Según la carta laboral el titular es María Gómez Batista'),
    extraccion: base('María Gómez Batista', 'el titular es María Gómez Batista')
  })
  return id
}

const post = (ruta, cuerpo, cabeceras = {}) =>
  fetch(BASE + ruta, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...cabeceras },
    body: JSON.stringify(cuerpo)
  })

before(async () => {
  // Los datos son una COPIA: un test que aprueba un expediente no puede
  // estropear la demo que el Comandante tenga abierta.
  dir = mkdtempSync(join(tmpdir(), 'expediente-ui-'))
  if (existsSync(join(RAIZ, 'datos'))) cpSync(join(RAIZ, 'datos'), dir, { recursive: true })

  servidor = spawn('node', ['ui/servidor.mjs', '--puerto', String(PUERTO),
                            '--datos', dir, '--hoy', '2026-09-10'],
                   { cwd: RAIZ, stdio: 'ignore' })
  await esperar()
})

after(() => {
  servidor?.kill()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

// ═══════════════════════════════════════════════════════════════════════════
//  UI-1 · Lo que el navegador recibe
// ═══════════════════════════════════════════════════════════════════════════

test('UI-01 · la página se sirve y no pide NADA de fuera', async () => {
  const html = await (await fetch(`${BASE}/`)).text()

  // Que no haya peticiones externas es parte del argumento del proyecto, no
  // una anécdota: se comprueba, no se afirma.
  assert.equal(/<script\s+src=|<link[^>]+href=["']https?:/i.test(html), false,
    'ni un solo recurso externo')
  assert.match(html, /Expediente&nbsp;Local|Expediente Local/)
})

test('UI-02 · ⭐ cada función del script está UNA sola vez', async () => {
  // El test que habría cazado las sesenta líneas duplicadas. Un `replace` sobre
  // HTML que deja dos copias de una función no es un error de sintaxis —parsea—
  // pero la segunda se ejecuta donde no debe.
  const html = await (await fetch(`${BASE}/`)).text()
  const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'))

  for (const decl of ['function resaltar', 'function normalizar', 'function cablearConflictos',
                      'async function abrirExpediente', 'async function cargarLista', 'const QUIEN']) {
    assert.equal(js.split(decl).length - 1, 1, `"${decl}" tiene que aparecer exactamente una vez`)
  }
})

test('UI-03 · el script del navegador es sintácticamente válido', async () => {
  // `new Function` compila sin ejecutar. Es lo más cerca de un navegador que se
  // puede estar sin arrancar uno, y cuesta un milisegundo.
  const html = await (await fetch(`${BASE}/`)).text()
  const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'))
  assert.doesNotThrow(() => new Function(js))
})

// ═══════════════════════════════════════════════════════════════════════════
//  UI-2 · La API que la interfaz consume
// ═══════════════════════════════════════════════════════════════════════════

test('UI-04 · la lista trae lo que la interfaz necesita para pintar', async () => {
  const d = await (await fetch(`${BASE}/api/expedientes`)).json()
  assert.ok(Array.isArray(d.expedientes) && d.expedientes.length >= 3)
  assert.ok(d.esquema?.dominio, 'el dominio se pinta en la cabecera')

  const uno = d.expedientes[0]
  for (const campo of ['id', 'estado', 'anclados', 'huecos', 'completitud', 'puedeCerrar']) {
    assert.ok(campo in uno, `falta ${campo}`)
  }
})

test('UI-05 · el detalle trae la posición del anclaje, para poder resaltar', async () => {
  const d = await (await fetch(`${BASE}/api/expediente/EXP-001`)).json()
  const conPosicion = Object.values(d.expediente.campos).filter(c => c.donde)
  assert.ok(conPosicion.length > 0, 'sin `donde` no se puede resaltar el documento')

  const c = conPosicion[0]
  assert.ok(Number.isInteger(c.donde.desde) && c.donde.hasta > c.donde.desde)
})

test('UI-06 · un expediente que no existe da 404, no 500', async () => {
  const r = await fetch(`${BASE}/api/expediente/NO-EXISTE`)
  assert.equal(r.status, 404)
})

// ═══════════════════════════════════════════════════════════════════════════
//  UI-3 · El guardián de escrituras
// ═══════════════════════════════════════════════════════════════════════════

test('UI-07 · ⭐ una página ajena NO escribe en un expediente', async () => {
  const r = await post('/api/decidir/EXP-002', { que: 'aprobar', oficial: 'x', motivo: 'y' },
                       { origin: 'https://sitio-cualquiera.example' })
  assert.equal(r.status, 403)
})

test('UI-08 · ⭐ text/plain no cuela: es la vía que evita el preflight', async () => {
  const r = await fetch(`${BASE}/api/decidir/EXP-002`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ que: 'aprobar', motivo: 'aprobado por el oficial' })
  })
  assert.equal(r.status, 415)
})

test('UI-09 · una decisión NO crea un expediente', async () => {
  const r = await post('/api/decidir/EXP-FANTASMA', { que: 'aprobar', oficial: 'x', motivo: 'y' })
  assert.equal(r.status, 404)
  assert.equal(existsSync(join(dir, 'EXP-FANTASMA.jsonl')), false,
    'y no queda ningún archivo detrás')
})

test('UI-10 · la tableta de la sucursal SÍ escribe, con su propio origen', async () => {
  // El guardián deduce el origen legítimo de la cabecera Host. Comparar contra
  // un literal 127.0.0.1 dejaba fuera al único dispositivo para el que se abre
  // el servidor a la red.
  const r = await post('/api/decidir/EXP-002',
                       { que: 'aprobar', rol: 'aprobador', oficial: 'R. Arias', motivo: 'y' },
                       { origin: BASE })
  // Puede fallar por el ESTADO del expediente —eso es otra cosa y es legítimo—
  // pero nunca por venir de donde viene.
  assert.notEqual(r.status, 403, 'el mismo origen nunca se rechaza por origen')
})

// ═══════════════════════════════════════════════════════════════════════════
//  UI-4 · El ciclo humano, por HTTP
// ═══════════════════════════════════════════════════════════════════════════

test('UI-11 · resolver exige valor de la disputa, oficial y motivo', async () => {
  // Con el rol correcto: lo que se prueba aquí son las reglas del NÚCLEO, no
  // las del control dual. Cada capa se comprueba por separado o no se sabe cuál
  // rechazó.
  const casos = [
    [{ campo: 'titular.nombre', valor: 'Pedro Ramírez Him', rol: 'oficial', oficial: 'A. Ruiz', motivo: 'me suena mejor' },
     /no es ninguno de los dos valores/],
    [{ campo: 'titular.nombre', valor: 'María Gómez Batista', rol: 'oficial', motivo: 'la cédula coincide' },
     /exige identificar al oficial/],
    [{ campo: 'titular.nombre', valor: 'María Gómez Batista', rol: 'oficial', oficial: 'A. Ruiz' },
     /exige motivo/]
  ]
  for (const [cuerpo, esperado] of casos) {
    const r = await post('/api/resolver/EXP-003', cuerpo)
    assert.equal(r.status, 409, 'no es un fallo del servidor: es una operación ilegal')
    assert.match((await r.json()).error, esperado)
  }
})

test('UI-12 · ⭐ el ciclo completo: resolver y solo entonces firmar', async () => {
  const antes = await (await fetch(`${BASE}/api/expediente/EXP-003`)).json()
  assert.equal(antes.expediente.conflictos.length, 1, 'parte de un conflicto abierto')

  // Con el conflicto abierto, la firma se para en seco.
  const bloqueada = await post('/api/decidir/EXP-003',
    { que: 'aprobar', rol: 'aprobador', oficial: 'R. Him · gerente', motivo: 'conforme' })
  assert.equal(bloqueada.status, 409)
  assert.match((await bloqueada.json()).error, /se contradicen/)

  // Una persona lo zanja, con su nombre y su motivo.
  const resuelto = await post('/api/resolver/EXP-003', {
    campo: 'titular.nombre',
    valor: 'María Gómez Batista',
    rol: 'oficial',
    oficial: 'Marta Him · oficial de cuenta',
    motivo: 'La cédula física presentada en ventanilla coincide con la carta laboral.'
  })
  assert.equal(resuelto.status, 200)
  assert.equal((await resuelto.json()).conflictos, 0)

  // Y ahora sí.
  const firmada = await post('/api/decidir/EXP-003',
    { que: 'aprobar', rol: 'aprobador', oficial: 'R. Him · gerente de sucursal', motivo: 'Resolución revisada.' })
  assert.equal(firmada.status, 200)
  assert.equal((await firmada.json()).estado, 'APROBADO')

  // Y queda escrito quién, con la cadena intacta.
  const despues = await (await fetch(`${BASE}/api/expediente/EXP-003`)).json()
  assert.equal(despues.expediente.decisiones.at(-1).oficial, 'R. Him · gerente de sucursal')
  assert.ok(despues.cadena.intacta)
})

// ═══════════════════════════════════════════════════════════════════════════
//  UI-5 · El control dual — quién puede qué
//
//  MAKER-CHECKER: quien prepara el expediente no es quien lo aprueba. Lo que la
//  banca usa desde Basilea II, y lo que el núcleo ya insinuaba al declarar
//  APROBADO y RECHAZADO como SOLO_HUMANO — el rol solo añade CUÁL humano.
//
//  Se prueba por HTTP y SIN pasar por la interfaz, a propósito: esconder un
//  botón no es aplicar un rol. Si la separación no vive en el servidor, no vive.
// ═══════════════════════════════════════════════════════════════════════════

test('UI-14 · ⭐ la oficial que arma el expediente NO puede firmarlo', async () => {
  const r = await post('/api/decidir/EXP-001',
    { que: 'aprobar', rol: 'oficial', oficial: 'Marta Him', motivo: 'conforme' })
  assert.equal(r.status, 403)
  const { error } = await r.json()
  assert.match(error, /no puede aprobar/)
  assert.match(error, /control dual, no un fallo/,
    'el mensaje tiene que decir POR QUÉ, o parece un error del sistema')
})

test('UI-15 · y el gerente que firma no arma expedientes', async () => {
  const r = await post('/api/resolver/EXP-003', {
    campo: 'titular.nombre', valor: 'María Gómez Batista',
    rol: 'aprobador', oficial: 'R. Arias', motivo: 'x'
  })
  assert.equal(r.status, 403)
  assert.match((await r.json()).error, /no puede resolver/)
})

test('UI-16 · el auditor lee y no toca — leer no es escribir', async () => {
  // Este rol existe para demostrar justo eso: un `puede: []` es una posición
  // legítima, no un rol a medio configurar.
  const lee = await fetch(`${BASE}/api/expediente/EXP-001`)
  assert.equal(lee.status, 200, 'leer nunca se le niega a nadie')

  const escribe = await post('/api/decidir/EXP-001',
    { que: 'aprobar', rol: 'auditor', oficial: 'x', motivo: 'y' })
  assert.equal(escribe.status, 403)
  assert.match((await escribe.json()).error, /leer, no escribir/)
})

test('UI-17 · sin rol declarado no se escribe, y se dice qué falta', async () => {
  const r = await post('/api/decidir/EXP-001', { que: 'aprobar', oficial: 'x', motivo: 'y' })
  assert.equal(r.status, 403)
  assert.match((await r.json()).error, /di con qué rol actúas/)
})

test('UI-18 · un rol inventado se rechaza diciendo cuáles existen', async () => {
  const r = await post('/api/decidir/EXP-001',
    { que: 'aprobar', rol: 'presidente', oficial: 'x', motivo: 'y' })
  assert.equal(r.status, 403)
  const { error } = await r.json()
  assert.match(error, /no existe aquí/)
  assert.match(error, /oficial.*aprobador.*auditor/s, 'y dice cuáles hay')
})

test('UI-19 · ⭐ aprobar y rechazar son permisos distintos, no uno solo', async () => {
  // `decidir` es una ruta y DOS acciones. Un banco puede repartirlas distinto,
  // y por eso la acción sale de `que` y no de la ruta.
  const r = await post('/api/decidir/EXP-002',
    { que: 'rechazar', rol: 'oficial', oficial: 'Marta', motivo: 'no procede' })
  assert.equal(r.status, 403)
  assert.match((await r.json()).error, /no puede rechazar/,
    'el mensaje nombra la acción pedida, no «aprobar» por defecto')
})

test('UI-20 · ⭐ el ciclo con control dual: Marta prepara, Ricardo firma', async () => {
  const ID = await expedienteConConflicto('EXP-DUAL')

  const resuelto = await post(`/api/resolver/${ID}`, {
    campo: 'titular.nombre', valor: 'María Gómez Batista', rol: 'oficial',
    oficial: 'Marta Him · oficial de cuenta',
    motivo: 'La cédula física presentada en ventanilla coincide con la carta laboral.'
  })
  assert.equal(resuelto.status, 200)

  const firmada = await post(`/api/decidir/${ID}`, {
    que: 'aprobar', rol: 'aprobador',
    oficial: 'Ricardo Arias · gerente de sucursal', motivo: 'Resolución revisada.'
  })
  assert.equal(firmada.status, 200)

  // Y el ledger guarda a los DOS, que es el punto del control dual.
  const d = await (await fetch(`${BASE}/api/expediente/${ID}`)).json()
  assert.match(d.expediente.resoluciones.at(-1).oficial, /Marta/)
  assert.match(d.expediente.decisiones.at(-1).oficial, /Ricardo/)
  assert.ok(d.cadena.intacta)
})

test('UI-13 · el CSV que la interfaz muestra lleva sus columnas de auditoría', async () => {
  const d = await (await fetch(`${BASE}/api/expediente/EXP-001`)).json()
  assert.equal(d.csv.split('\n')[0],
    'expediente,campo,valor,evidencia,cita,desde,hasta,origen,guardias,motivo,firmante')
})

// ═══════════════════════════════════════════════════════════════════════════
//  UI-6 · CAPTURAR — lo que le faltaba a la ventanilla para existir
//
//  Hasta que existió este endpoint, la interfaz solo sabía leer y decidir sobre
//  lo ya capturado: para iniciar un expediente había que abrir una terminal.
//  En una demostración, ese es el momento exacto en que se pierde a la sala.
// ═══════════════════════════════════════════════════════════════════════════

test('UI-21 · ⭐ la oficial inicia un expediente sin tocar la terminal', async () => {
  const r = await post('/api/capturar/EXP-VENTANILLA', {
    rol: 'oficial',
    texto: 'El titular es Ana Ruiz, cédula 8-777-888.'
  })
  assert.equal(r.status, 200)
  const d = await r.json()
  assert.equal(d.estado, 'CAPTURADO',
    'sin propuesta del modelo, el expediente queda capturado — y eso es un estado legítimo')

  // Y aparece en la lista, que es lo que ve el resto de la sucursal.
  const lista = await (await fetch(`${BASE}/api/expedientes`)).json()
  assert.ok(lista.expedientes.some(e => e.id === 'EXP-VENTANILLA'))
})

test('UI-22 · capturar con la propuesta del modelo asienta y revisa de una vez', async () => {
  const r = await post('/api/capturar/EXP-CON-PROPUESTA', {
    rol: 'oficial',
    texto: FUENTE_ART18,
    extraccion: { titular: titularArt18(), operacion: operacionArt18(), documentos: [] }
  })
  assert.equal(r.status, 200)
  const d = await r.json()
  assert.ok(d.anclados > 10, 'los campos del artículo 18 entran')
  assert.equal(d.rechazados, 0, 'y ninguno se rechaza: las citas son literales')
})

test('UI-23 · un identificador que no sirve se rechaza antes de crear nada', async () => {
  for (const malo of ['../fuera', 'con espacio', '', 'a'.repeat(80)]) {
    const r = await post(`/api/capturar/${encodeURIComponent(malo)}`,
                         { rol: 'oficial', texto: 'algo' })
    assert.ok(r.status === 400 || r.status === 404,
      `"${malo}" no puede crear un expediente`)
  }
})

test('UI-24 · capturar sin texto no crea un expediente vacío', async () => {
  const r = await post('/api/capturar/EXP-SIN-TEXTO', { rol: 'oficial', texto: '   ' })
  assert.equal(r.status, 400)
  assert.equal(existsSync(join(dir, 'EXP-SIN-TEXTO.jsonl')), false,
    'y no queda archivo detrás')
})

test('UI-25 · ⭐ el gerente no captura: es la otra mitad del control dual', async () => {
  const r = await post('/api/capturar/EXP-GERENTE', { rol: 'aprobador', texto: 'algo' })
  assert.equal(r.status, 403)
  assert.match((await r.json()).error, /no puede capturar/)
  assert.equal(existsSync(join(dir, 'EXP-GERENTE.jsonl')), false)
})

// ═══════════════════════════════════════════════════════════════════════════
//  UI-7 · LO QUE LA PANTALLA TIENE QUE OFRECER
//
//  Escritos ANTES que el código, y por eso empiezan en rojo. Es TDD con un
//  límite que conviene decir en voz alta: desde aquí no se puede HACER CLIC.
//  Estos tests comprueban el CONTRATO —que el elemento esté, que la API
//  responda, que el dato viaje— y el clic lo cubren las pruebas de usuario.
//  Dar por probado lo que no se probó es cómo se llega a una suite verde con
//  quince fallos dentro.
// ═══════════════════════════════════════════════════════════════════════════

test('UI-26 · ⭐ el gerente tiene dónde firmar, no solo un endpoint', async () => {
  const html = await (await fetch(`${BASE}/`)).text()
  assert.match(html, /api\/decidir/, 'la interfaz tiene que llamar al endpoint que ya existe')
  assert.match(html, /aprobar/i)
  assert.match(html, /rechazar/i)
})

test('UI-27 · el rol se elige en pantalla y se recuerda en el equipo', async () => {
  const html = await (await fetch(`${BASE}/`)).text()
  assert.match(html, /id="rol"/, 'un selector, no una URL: en una ponencia hay que poder cambiarlo')
  // Los tres roles del esquema tienen que estar como opciones.
  for (const rol of ['oficial', 'aprobador', 'auditor']) {
    assert.match(html, new RegExp(`value="${rol}"`), `falta la opción ${rol}`)
  }
  assert.match(html, /localStorage/, 'y se recuerda en ESTE navegador')
})

test('UI-28 · se ven TODAS las firmas, no solo la última', async () => {
  // Con control dual hay dos actores firmando cosas distintas. Enseñar solo la
  // última esconde justo lo que demuestra la separación de funciones.
  const html = await (await fetch(`${BASE}/`)).text()
  assert.match(html, /decisiones\.map/, 'el array entero, no decisiones.at(-1)')
})

test('UI-29 · la oficial puede capturar desde la pantalla', async () => {
  const html = await (await fetch(`${BASE}/`)).text()
  assert.match(html, /<textarea/, 'hace falta dónde escribir lo que dicta el cliente')
  assert.match(html, /api\/capturar/)
})

test('UI-30 · la pantalla usa lo que el servidor YA calcula', async () => {
  // Cuatro datos que el servidor devuelve y el HTML ignoraba. Cero cálculo
  // nuevo: solo dejar de tirarlos.
  const html = await (await fetch(`${BASE}/`)).text()
  for (const dato of ['puedeCerrar', 'porEvidencia', 'criticos']) {
    assert.match(html, new RegExp(dato), `${dato} se devuelve y no se pinta`)
  }
})
