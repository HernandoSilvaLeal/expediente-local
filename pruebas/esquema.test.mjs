// pruebas/esquema.test.mjs — T1
//
// Corre SIN modelo, SIN red y SIN el SDK:   node --test pruebas/
//
// Un test que solo comprueba el camino feliz no prueba nada. Aquí hay un caso
// por cada forma conocida de que el esquema esté mal, y cada uno DEBE lanzar.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  cargarEsquema, EVIDENCIA, nivelEvidencia,
  recorrerCampos, esCampo, leerRuta
} from '../core/esquema.mjs'

// ─────────────────────────────────────────────────────────────
// El esquema real de banca
// ─────────────────────────────────────────────────────────────

test('T1-01 · el esquema de banca carga y trae lo esencial', () => {
  const e = cargarEsquema('instancias/banca/esquema.json')
  assert.equal(e.dominio, 'banca')
  assert.equal(e.entidad, 'expediente')
  assert.equal(e.jsonSchema.name, 'expediente')
  assert.equal(e.jsonSchema.schema.type, 'object')
  assert.ok(e.camposCriticos.length > 0, 'debe declarar campos críticos')
})

test('T1-02 · el esquema es inmutable una vez cargado', () => {
  const e = cargarEsquema('instancias/banca/esquema.json')
  assert.throws(() => { e.dominio = 'otro' }, TypeError,
    'un esquema mutable permite que una capa lo cambie a mitad de ejecución')
})

test('T1-03 · todo objeto del esquema lleva additionalProperties:false', () => {
  // Trampa 18: json_schema.strict NO lo aplica. Si falta, el modelo inventa campos.
  const e = cargarEsquema('instancias/banca/esquema.json')
  const laxos = []
  ;(function rec (n, ruta) {
    if (!n || typeof n !== 'object') return
    if (n.type === 'object' && n.additionalProperties !== false) laxos.push(ruta)
    for (const [k, v] of Object.entries(n.properties ?? {})) rec(v, `${ruta}.${k}`)
    for (const [k, v] of Object.entries(n.$defs ?? {}))      rec(v, `${ruta}.$defs.${k}`)
    if (n.items) rec(n.items, `${ruta}[]`)
  })(e.jsonSchema.schema, 'raiz')
  assert.deepEqual(laxos, [])
})

// ─────────────────────────────────────────────────────────────
// Lo que DEBE fallar
// ─────────────────────────────────────────────────────────────

function esquemaTemporal (obj) {
  const dir = mkdtempSync(join(tmpdir(), 'esq-'))
  const ruta = join(dir, 'e.json')
  writeFileSync(ruta, JSON.stringify(obj))
  return ruta
}

test('T1-04 · un esquema sin json_schema.name LANZA', () => {
  const ruta = esquemaTemporal({
    dominio: 'x', entidad: 'y', vacios: {},
    json_schema: { schema: { type: 'object', additionalProperties: false } }
  })
  assert.throws(() => cargarEsquema(ruta), /name es obligatorio/,
    'sin name, el SDK responde "expected string, received undefined"')
})

test('T1-05 · un objeto sin additionalProperties:false LANZA', () => {
  const ruta = esquemaTemporal({
    dominio: 'x', entidad: 'y', vacios: {},
    json_schema: { name: 'x', schema: { type: 'object' } }   // ← falta
  })
  assert.throws(() => cargarEsquema(ruta), /additionalProperties/,
    'debe reventar al arrancar, no producir campos inventados horas después')
})

test('T1-06 · un esquema al que le faltan claves obligatorias LANZA', () => {
  const ruta = esquemaTemporal({ dominio: 'x' })
  assert.throws(() => cargarEsquema(ruta), /Esquema incompleto/)
})

test('T1-07 · una ruta inexistente LANZA con el nombre del archivo', () => {
  assert.throws(() => cargarEsquema('instancias/no-existe/esquema.json'),
    /No se pudo leer el esquema/)
})

// ─────────────────────────────────────────────────────────────
// La escala de evidencia — ordenada, no arbitraria
// ─────────────────────────────────────────────────────────────

test('T1-08 · la escala de evidencia está ordenada de menor a mayor', () => {
  assert.deepEqual(EVIDENCIA, ['Desconocido', 'Estimado', 'Reportado', 'Confirmado'])
  assert.ok(nivelEvidencia('Confirmado') > nivelEvidencia('Reportado'))
  assert.ok(nivelEvidencia('Reportado')  > nivelEvidencia('Estimado'))
  assert.ok(nivelEvidencia('Estimado')   > nivelEvidencia('Desconocido'))
})

test('T1-09 · un grado desconocido vale 0, nunca undefined', () => {
  // Si devolviera undefined, cualquier comparación sería false y un dato basura
  // pasaría los filtros en silencio.
  assert.equal(nivelEvidencia('Inventado'), 0)
  assert.equal(nivelEvidencia(undefined), 0)
  assert.equal(nivelEvidencia(null), 0)
})

// ─────────────────────────────────────────────────────────────
// El recorrido de campos — la base de las guardias
// ─────────────────────────────────────────────────────────────

test('T1-10 · esCampo reconoce {valor,cita} y rechaza el resto', () => {
  assert.ok(esCampo({ valor: 'x', cita: 'y' }))
  assert.ok(esCampo({ valor: 3, cita: '' }))
  assert.ok(!esCampo({ valor: 'x' }))
  assert.ok(!esCampo('texto'))
  assert.ok(!esCampo(null))
  assert.ok(!esCampo([{ valor: 1, cita: '' }]))
})

test('T1-11 · recorrerCampos llega a todas las hojas, incluidas las de arrays', () => {
  const obj = {
    titular: { nombre: { valor: 'Ana', cita: 'Ana' } },
    documentos: [
      { tipo: 'CEDULA', emisor: { valor: 'TE', cita: 'TE' } },
      { tipo: 'RECIBO_SERVICIO', emisor: { valor: 'IDAAN', cita: 'IDAAN' } }
    ]
  }
  const vistos = []
  recorrerCampos(obj, r => vistos.push(r))
  assert.deepEqual(vistos.sort(), [
    'documentos[0].emisor',
    'documentos[1].emisor',
    'titular.nombre'
  ])
})

test('T1-12 · leerRuta resuelve puntos y corchetes, y no revienta si no existe', () => {
  const obj = { documentos: [{ tipo: 'CEDULA' }] }
  assert.equal(leerRuta(obj, 'documentos[0].tipo'), 'CEDULA')
  assert.equal(leerRuta(obj, 'documentos[9].tipo'), undefined)
  assert.equal(leerRuta(obj, 'no.existe.nada'), undefined)
})
