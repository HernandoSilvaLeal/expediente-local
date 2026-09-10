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
  const r = await post('/api/decidir/EXP-002', { que: 'aprobar', oficial: 'x', motivo: 'y' },
                       { origin: BASE })
  assert.notEqual(r.status, 403, 'el mismo origen nunca se rechaza por origen')
})

// ═══════════════════════════════════════════════════════════════════════════
//  UI-4 · El ciclo humano, por HTTP
// ═══════════════════════════════════════════════════════════════════════════

test('UI-11 · resolver exige valor de la disputa, oficial y motivo', async () => {
  const casos = [
    [{ campo: 'titular.nombre', valor: 'Pedro Ramírez Him', oficial: 'A. Ruiz', motivo: 'me suena mejor' },
     /no es ninguno de los dos valores/],
    [{ campo: 'titular.nombre', valor: 'María Gómez Batista', motivo: 'la cédula coincide' },
     /exige identificar al oficial/],
    [{ campo: 'titular.nombre', valor: 'María Gómez Batista', oficial: 'A. Ruiz' },
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
    { que: 'aprobar', oficial: 'R. Him · gerente', motivo: 'conforme' })
  assert.equal(bloqueada.status, 409)
  assert.match((await bloqueada.json()).error, /se contradicen/)

  // Una persona lo zanja, con su nombre y su motivo.
  const resuelto = await post('/api/resolver/EXP-003', {
    campo: 'titular.nombre',
    valor: 'María Gómez Batista',
    oficial: 'Marta Him · oficial de cuenta',
    motivo: 'La cédula física presentada en ventanilla coincide con la carta laboral.'
  })
  assert.equal(resuelto.status, 200)
  assert.equal((await resuelto.json()).conflictos, 0)

  // Y ahora sí.
  const firmada = await post('/api/decidir/EXP-003',
    { que: 'aprobar', oficial: 'R. Him · gerente de sucursal', motivo: 'Resolución revisada.' })
  assert.equal(firmada.status, 200)
  assert.equal((await firmada.json()).estado, 'APROBADO')

  // Y queda escrito quién, con la cadena intacta.
  const despues = await (await fetch(`${BASE}/api/expediente/EXP-003`)).json()
  assert.equal(despues.expediente.decisiones.at(-1).oficial, 'R. Him · gerente de sucursal')
  assert.ok(despues.cadena.intacta)
})

test('UI-13 · el CSV que la interfaz muestra lleva sus columnas de auditoría', async () => {
  const d = await (await fetch(`${BASE}/api/expediente/EXP-001`)).json()
  assert.equal(d.csv.split('\n')[0],
    'expediente,campo,valor,evidencia,cita,desde,hasta,origen,guardias,motivo,firmante')
})
