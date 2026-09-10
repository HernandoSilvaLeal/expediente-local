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
                      'function cablearFirma', 'function pintarCaptura', 'function seguirCambios',
                      'function puedeFirmar', 'function reparto',
                      'async function abrirExpediente', 'async function cargarLista',
                      'const QUIEN', 'let refresco', 'let ESQUEMA']) {
    assert.equal(js.split(decl).length - 1, 1, `"${decl}" tiene que aparecer exactamente una vez`)
  }

  // Y la llamada de arranque, una sola: dos `cargarLista()` sueltos al final
  // significan que un replace se aplicó donde no debía. Ya pasó DOS veces en
  // este archivo —la segunda insertó cinco copias del mismo bloque— y las dos
  // veces el script seguía parseando, que es lo que lo hace difícil de ver.
  assert.equal((js.match(/^cargarLista\(\)$/gm) ?? []).length, 1,
    'una sola llamada de arranque')
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

// ═══════════════════════════════════════════════════════════════════════════
//  UI-8 · QUE LOS DISPOSITIVOS SE ENTEREN
//
//  Marta resuelve en la tableta y el celular de Ricardo mostraba datos viejos
//  hasta que él recargara a mano. Con dos personas actuando, eso se ve.
//
//  Esto se prueba de VERDAD —abriendo el canal y provocando un cambio— y no
//  comprobando que la palabra «event-stream» esté en un archivo. Un grep sobre
//  el código dice que alguien escribió algo, no que funcione.
// ═══════════════════════════════════════════════════════════════════════════

test('UI-31 · ⭐ un dispositivo se entera de lo que hizo otro', async () => {
  // El expediente se prepara ANTES de abrir el canal: capturar también avisa, y
  // si no, lo primero que llega es el aviso de la preparación y no el del acto
  // que se está probando. Un test que se conforma con «llegó algo» no prueba
  // que llegue lo correcto.
  const id = await expedienteConConflicto('EXP-AVISO')

  const canal = await fetch(`${BASE}/api/eventos`)
  assert.equal(canal.headers.get('content-type'), 'text/event-stream')

  const lector = canal.body.getReader()
  const dec = new TextDecoder()
  let recibido = ''

  // Se lee en paralelo mientras otro «dispositivo» actúa.
  const escuchando = (async () => {
    const limite = Date.now() + 5000
    while (Date.now() < limite) {
      const { value, done } = await lector.read()
      if (done) break
      recibido += dec.decode(value, { stream: true })
      if (recibido.includes('event: cambio')) return
    }
  })()

  await new Promise(r => setTimeout(r, 200))
  await post(`/api/resolver/${id}`, {
    campo: 'titular.nombre', valor: 'María Gómez Batista', rol: 'oficial',
    oficial: 'Marta Him', motivo: 'La cédula coincide con la carta laboral.'
  })

  await escuchando
  await lector.cancel()

  assert.match(recibido, /retry:/, 'el navegador tiene que saber cada cuánto reintentar')
  assert.match(recibido, /event: cambio/, 'el aviso llegó al otro dispositivo')
  assert.match(recibido, /"que":"resuelto"/)
})

test('UI-32 · el aviso NO lleva los datos, solo dice que algo cambió', async () => {
  // Un canal que empuja estado es un segundo sitio donde el estado puede quedar
  // desfasado, y ya tenemos uno. Quien recibe el aviso pide lo que necesite.
  const canal = await fetch(`${BASE}/api/eventos`)
  const lector = canal.body.getReader()
  const dec = new TextDecoder()

  await new Promise(r => setTimeout(r, 100))
  await post('/api/capturar/EXP-AVISO-2', { rol: 'oficial', texto: 'El titular es Ana Ruiz.' })

  let recibido = ''
  const limite = Date.now() + 4000
  while (Date.now() < limite && !recibido.includes('event: cambio')) {
    const { value, done } = await lector.read()
    if (done) break
    recibido += dec.decode(value, { stream: true })
  }
  await lector.cancel()

  const datos = /data: (.+)/.exec(recibido)?.[1]
  assert.ok(datos, 'llegó un aviso')
  const payload = JSON.parse(datos)
  assert.deepEqual(Object.keys(payload), ['que'], 'solo dice QUÉ pasó, no el expediente entero')
})

// ═══════════════════════════════════════════════════════════════════════════
//  UI-9 · LO QUE ENCONTRÓ EL ADVERSARIAL
//
//  Trece hallazgos, cinco críticos, sobre código escrito el mismo día. Cada
//  uno queda fijado aquí para que no vuelva por otra puerta.
// ═══════════════════════════════════════════════════════════════════════════

test('UI-33 · ⭐ un expediente FIRMADO no se reescribe — ni capturando, ni resolviendo', async () => {
  // El peor de los trece. El rol OFICIAL —el que por control dual no puede
  // firmar— reescribía el titular de un expediente ya APROBADO, y el CSV de
  // auditoría atribuía el valor nuevo al gerente que nunca lo vio. La cadena
  // seguía intacta, porque cada hecho era legítimo por separado: lo que no era
  // legítimo es que ocurrieran DESPUÉS de la firma.
  const id = await expedienteConConflicto('EXP-TERMINAL')
  await post(`/api/resolver/${id}`, {
    campo: 'titular.nombre', valor: 'María Gómez Batista', rol: 'oficial',
    oficial: 'Marta Him', motivo: 'la cédula coincide'
  })
  const firmada = await post(`/api/decidir/${id}`,
    { que: 'aprobar', rol: 'aprobador', oficial: 'R. Arias', motivo: 'conforme' })
  assert.equal(firmada.status, 200)

  // Y a partir de aquí, no se toca.
  const reescribir = await post(`/api/capturar/${id}`, {
    rol: 'oficial', texto: 'El titular es Fulano Testaferro Blanqueador.'
  })
  assert.equal(reescribir.status, 409)
  assert.match((await reescribir.json()).error, /terminal y ya está firmado/)

  const d = await (await fetch(`${BASE}/api/expediente/${id}`)).json()
  assert.equal(d.expediente.campos['titular.nombre'].valor, 'María Gómez Batista',
    'el titular firmado sigue siendo el firmado')
})

test('UI-34 · ⭐ el botón de resolver manda el rol — se prueba lo que la PÁGINA envía', async () => {
  // El botón central de la demostración llevaba roto desde que se añadió el
  // control dual: la página no mandaba `rol` y el servidor devolvía 403. Con la
  // suite entera en verde, porque los tests llamaban a la API poniendo el rol A
  // MANO. Probaban el servidor, no la página.
  const html = await (await fetch(`${BASE}/`)).text()
  const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'))

  // Se extrae el cuerpo que arma el manejador de resolver y se comprueba que
  // incluye el rol. No es un clic, pero sí es lo que el clic va a enviar.
  const bloque = js.slice(js.indexOf('function cablearConflictos'))
  const cuerpo = bloque.slice(bloque.indexOf('const cuerpo = {'), bloque.indexOf('}', bloque.indexOf('const cuerpo = {')))
  assert.match(cuerpo, /rol:/, 'el cuerpo que envía el botón tiene que llevar rol')

  // Y las tres zonas de escritura de la página, todas.
  for (const fn of ['cablearConflictos', 'cablearFirma', 'pintarCaptura']) {
    const trozo = js.slice(js.indexOf(`function ${fn}`), js.indexOf(`function ${fn}`) + 2200)
    assert.match(trozo, /rol\(\)/, `${fn} tiene que mandar el rol`)
  }
})

test('UI-35 · un rol raro no revienta el servidor: 403, no 500', async () => {
  // `roles[rol]` sobre `__proto__` devolvía algo truthy sin `puede`, y el
  // servidor contestaba 500 con su traza interna. Fallaba cerrado por
  // casualidad, no por diseño.
  for (const rol of ['__proto__', 'constructor', 'toString', '$comentario']) {
    const r = await post('/api/decidir/EXP-002',
      { que: 'aprobar', rol, oficial: 'x', motivo: 'y' })
    assert.equal(r.status, 403, `${rol} tiene que dar 403`)
    assert.match((await r.json()).error, /no existe aquí/)
  }
})

test('UI-36 · el rol se comprueba por TIPO, no se coacciona', async () => {
  // Con `String(cuerpo.rol)`, un `["aprobador"]` se convertía en el rol
  // «aprobador» y pasaba. Una puerta que acepta cualquier cosa y la interpreta
  // no es una puerta.
  for (const rol of [['aprobador'], { rol: 'aprobador' }, 42, true]) {
    const r = await post('/api/decidir/EXP-002',
      { que: 'aprobar', rol, oficial: 'x', motivo: 'y' })
    assert.equal(r.status, 403, `${JSON.stringify(rol)} no es un rol`)
    assert.match((await r.json()).error, /di con qué rol actúas/)
  }
})

test('UI-37 · ⭐ no se lee cualquier .jsonl del disco', async () => {
  // `capturar` validaba el identificador; ver, resolver y decidir no. Un
  // `..%2ffuera%2fSECRETO` leía cualquier archivo del equipo — y el servidor
  // está pensado para abrirse a la red de la sucursal sin autenticación.
  for (const malo of ['..%2ffuera%2fSECRETO', '..%2f..%2fetc%2fpasswd', '%2e%2e%2fx']) {
    const r = await fetch(`${BASE}/api/expediente/${malo}`)
    assert.equal(r.status, 400, `${malo} tiene que morir en la puerta, no en el núcleo`)
  }
  // Y lo legítimo sigue pasando.
  assert.equal((await fetch(`${BASE}/api/expediente/EXP-001`)).status, 200)
})
