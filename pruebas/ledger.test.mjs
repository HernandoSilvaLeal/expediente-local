// pruebas/ledger.test.mjs — T5
//
// El test que cierra la tarea es literal, del plan:
//   3 eventos → proyectar → MATAR el proceso → reproyectar → IDÉNTICO
// y aquí el proceso se mata de verdad, no se simula.
//
// Corre sin modelo, sin red y sin el SDK.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import {
  EVENTO, GENESIS, BAJA_EVIDENCIA, LedgerCorrupto,
  canonico, hashDe, crearEvento, verificarCadena, exigirCadenaIntacta,
  anexar, leer, ultimo, registrar, abrirLedger
} from '../core/ledger.mjs'
import { proyectar, serializar, LedgerIncoherente } from '../core/proyeccion.mjs'
import { ORIGENES } from '../core/estado.mjs'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Un banco de pruebas por test: sin estado compartido, sin orden implícito. */
function banco () {
  const dir = mkdtempSync(join(tmpdir(), 'expediente-ledger-'))
  return { dir, ruta: join(dir, 'eventos.jsonl'), limpiar: () => rmSync(dir, { recursive: true, force: true }) }
}

const T = (n) => `2026-09-09T23:${String(n).padStart(2, '0')}:00.000Z`

/** Los tres hechos del test de O5. Ficticios y sintéticos, como todo el dataset. */
const TRES = [
  { tipo: EVENTO.CAPTURA, expediente: 'EXP-001', origen: ORIGENES.HUMANO, ts: T(1),
    datos: { texto: 'El titular es Juan Pérez, cédula 8-123-456.', medio: 'texto' } },
  { tipo: EVENTO.REVISION, expediente: 'EXP-001', origen: ORIGENES.REGLA, ts: T(2),
    datos: { campos: [
      { ruta: 'titular.nombre', aceptado: true, valor: 'Juan Pérez', cita: 'El titular es Juan Pérez', evidencia: 'Reportado' },
      { ruta: 'titular.cedula', aceptado: true, valor: '8-123-456', cita: 'cédula 8-123-456', evidencia: 'Reportado' },
      { ruta: 'titular.pasaporte', aceptado: false, valor: null, cita: '', evidencia: 'Desconocido' }
    ] } },
  { tipo: EVENTO.TRANSICION, expediente: 'EXP-001', origen: ORIGENES.LLM_LOCAL, ts: T(3),
    datos: { hacia: 'EXTRAIDO' } }
]

function sembrar (ruta, campos = TRES) {
  for (const c of campos) registrar(ruta, c)
  return leer(ruta)
}

// ═════════════════════════════════════════════════════════════════════
//  EL INVARIANTE, COMO TEST — no existe forma de actualizar ni de borrar
// ═════════════════════════════════════════════════════════════════════

test('T5-01 · el ledger NO exporta NINGUNA forma de actualizar ni de borrar', async () => {
  const mod = await import('../core/ledger.mjs')
  for (const prohibido of ['actualizar', 'borrar', 'eliminar', 'reemplazar', 'modificar',
                           'update', 'delete', 'remove', 'edit', 'set', 'escribir']) {
    assert.equal(mod[prohibido], undefined,
      `el ledger expone "${prohibido}": el append-only deja de ser un invariante y pasa a ser una intención`)
  }
})

test('T5-02 · abrirLedger tampoco devuelve una puerta trasera', () => {
  const b = banco()
  try {
    const l = abrirLedger(b.ruta)
    assert.deepEqual(Object.keys(l).sort(), ['leer', 'registrar', 'ruta', 'ultimo', 'verificar'])
    assert.throws(() => { l.registrar = null }, TypeError)
  } finally { b.limpiar() }
})

// ═════════════════════════════════════════════════════════════════════
//  La serialización canónica — de la que depende TODO el determinismo
// ═════════════════════════════════════════════════════════════════════

test('T5-03 · el orden de las claves no cambia el hash', () => {
  // Sin canonico(), {a,b} y {b,a} darían hashes distintos siendo el mismo hecho,
  // y la cadena se rompería sola al reescribir el archivo con otra librería.
  assert.equal(canonico({ a: 1, b: 2 }), canonico({ b: 2, a: 1 }))
  assert.equal(canonico({ z: { y: 1, x: 2 } }), canonico({ z: { x: 2, y: 1 } }))
})

test('T5-04 · canonico distingue lo que ES distinto', () => {
  assert.notEqual(canonico({ a: 1 }), canonico({ a: 2 }))
  assert.notEqual(canonico({ a: 1 }), canonico({ a: '1' }), 'el número 1 no es la cadena "1"')
  assert.notEqual(canonico([1, 2]), canonico([2, 1]), 'en un array el orden SÍ es información')
})

test('T5-05 · canonico no revienta con nulos, indefinidos ni anidamiento', () => {
  assert.equal(canonico(null), 'null')
  assert.equal(canonico({ a: undefined, b: 1 }), '{"b":1}', 'undefined no viaja')
  assert.doesNotThrow(() => canonico({ a: [{ b: [{ c: null }] }] }))
})

// ═════════════════════════════════════════════════════════════════════
//  La cadena
// ═════════════════════════════════════════════════════════════════════

test('T5-06 · el primer evento cuelga del génesis', () => {
  const e = crearEvento(TRES[0], null)
  assert.equal(e.anterior, GENESIS)
  assert.equal(e.seq, 1)
  assert.equal(e.hash, hashDe(e))
})

test('T5-07 · cada evento engancha con el anterior', () => {
  const b = banco()
  try {
    const evs = sembrar(b.ruta)
    assert.equal(evs.length, 3)
    assert.equal(evs[1].anterior, evs[0].hash)
    assert.equal(evs[2].anterior, evs[1].hash)
    assert.deepEqual(evs.map(e => e.seq), [1, 2, 3])
    assert.equal(verificarCadena(evs).intacta, true)
  } finally { b.limpiar() }
})

test('T5-08 · EDITAR un evento a mano rompe la cadena, y se dice DÓNDE', () => {
  // Es el plano del video: se corrompe el archivo con un editor de texto y el
  // verificador canta el número de evento exacto.
  const b = banco()
  try {
    sembrar(b.ruta)
    const lineas = readFileSync(b.ruta, 'utf8').trim().split('\n')
    const alterado = JSON.parse(lineas[1])
    alterado.datos.campos[0].valor = 'Pedro Martínez'      // el fraude clásico
    lineas[1] = JSON.stringify(alterado)
    writeFileSync(b.ruta, lineas.join('\n') + '\n')

    const v = verificarCadena(leer(b.ruta))
    assert.equal(v.intacta, false)
    assert.equal(v.rotoEn, 2, 'tiene que señalar el evento exacto, no decir "algo falla"')
    assert.match(v.causa, /se editó después de escribirse/)
  } finally { b.limpiar() }
})

test('T5-09 · BORRAR un evento del medio rompe la cadena', () => {
  const b = banco()
  try {
    sembrar(b.ruta)
    const lineas = readFileSync(b.ruta, 'utf8').trim().split('\n')
    writeFileSync(b.ruta, [lineas[0], lineas[2]].join('\n') + '\n')

    const v = verificarCadena(leer(b.ruta))
    assert.equal(v.intacta, false)
    assert.equal(v.rotoEn, 3)
    assert.match(v.causa, /falta un evento/)
  } finally { b.limpiar() }
})

test('T5-10 · REORDENAR dos eventos rompe la cadena', () => {
  const b = banco()
  try {
    sembrar(b.ruta)
    const l = readFileSync(b.ruta, 'utf8').trim().split('\n')
    writeFileSync(b.ruta, [l[0], l[2], l[1]].join('\n') + '\n')
    assert.equal(verificarCadena(leer(b.ruta)).intacta, false)
  } finally { b.limpiar() }
})

test('T5-11 · una línea ilegible es CORRUPCIÓN, no una línea a saltar', () => {
  const b = banco()
  try {
    sembrar(b.ruta)
    writeFileSync(b.ruta, readFileSync(b.ruta, 'utf8') + '{esto no es json}\n')
    assert.throws(() => leer(b.ruta), LedgerCorrupto,
      'saltarse una línea rota es perder un hecho sin que nadie se entere')
  } finally { b.limpiar() }
})

test('T5-12 · exigirCadenaIntacta LANZA con el número de evento', () => {
  const b = banco()
  try {
    sembrar(b.ruta)
    const l = readFileSync(b.ruta, 'utf8').trim().split('\n')
    writeFileSync(b.ruta, [l[0], l[2]].join('\n') + '\n')
    assert.throws(() => exigirCadenaIntacta(leer(b.ruta)),
      (e) => e instanceof LedgerCorrupto && e.seq === 3)
  } finally { b.limpiar() }
})

test('T5-13 · un ledger vacío está intacto: cero eventos no es un error', () => {
  assert.equal(verificarCadena([]).intacta, true)
  const b = banco()
  try { assert.deepEqual(leer(b.ruta), []); assert.equal(ultimo(b.ruta), null) }
  finally { b.limpiar() }
})

// ═════════════════════════════════════════════════════════════════════
//  Lo que un evento no puede ser
// ═════════════════════════════════════════════════════════════════════

test('T5-14 · un tipo de evento inventado LANZA', () => {
  assert.throws(() => crearEvento({ tipo: 'ARREGLADO_A_MANO', expediente: 'X', ts: T(1) }),
    /Tipo de evento desconocido/)
})

test('T5-15 · un evento sin expediente LANZA', () => {
  assert.throws(() => crearEvento({ tipo: EVENTO.CAPTURA, ts: T(1) }), /pertenece a un expediente/)
})

test('T5-16 · un evento sin instante LANZA: el ts se recibe, no se inventa aquí', () => {
  // Un módulo que llama a Date.now() por su cuenta no es testeable ni reproducible.
  assert.throws(() => crearEvento({ tipo: EVENTO.CAPTURA, expediente: 'X' }), /falta `ts`/)
})

test('T5-17 · el evento devuelto es inmutable', () => {
  const e = crearEvento(TRES[0], null)
  assert.throws(() => { e.datos = {} }, TypeError)
})

// ═════════════════════════════════════════════════════════════════════
//  ⭐ O5 — EL TEST DE LA TAREA. El proceso se mata DE VERDAD.
// ═════════════════════════════════════════════════════════════════════

test('T5-O5 · 3 eventos → proyectar → MATAR el proceso → reproyectar → IDÉNTICO', () => {
  const b = banco()
  try {
    sembrar(b.ruta)

    // Cada proyección corre en su PROPIO proceso de Node, que nace, escribe y muere.
    // Nada sobrevive entre las dos: ni un módulo cacheado, ni una variable, ni un Map.
    const proyectarEnOtroProceso = (salida) => {
      execFileSync(process.execPath, ['-e', `
        import('${resolve(RAIZ, 'core/ledger.mjs')}').then(async (L) => {
          const P = await import('${resolve(RAIZ, 'core/proyeccion.mjs')}')
          const fs = await import('node:fs')
          const eventos = L.leer(${JSON.stringify(b.ruta)})
          L.exigirCadenaIntacta(eventos)
          fs.writeFileSync(${JSON.stringify('SALIDA')}.replace('SALIDA', ${JSON.stringify(salida)}),
                           P.serializar(P.proyectar(eventos)))
        })
      `], { stdio: ['ignore', 'pipe', 'pipe'] })
      return readFileSync(salida, 'utf8')
    }

    const primera = proyectarEnOtroProceso(join(b.dir, 'a.json'))
    const segunda = proyectarEnOtroProceso(join(b.dir, 'b.json'))

    assert.equal(primera, segunda, 'la proyección tiene que ser idéntica byte a byte')
    assert.ok(primera.length > 100, 'y no puede ser idéntica por estar vacía')

    const exp = JSON.parse(primera)
    assert.equal(exp.id, 'EXP-001')
    assert.equal(exp.estado, 'EXTRAIDO')
    assert.equal(exp.resumen.camposAsentados, 2)
    assert.equal(exp.resumen.camposRechazados, 1)
  } finally { b.limpiar() }
})

test('T5-O5b · el orden de las claves de campos NO depende del orden de llegada', () => {
  // Es lo que permite que dos dispositivos que recibieron los mismos hechos en
  // distinto orden serialicen el mismo JSON. Sin esto, O5 y la convergencia de
  // la malla se caen a la vez.
  const uno = proyectar(conHashes([
    { ...TRES[0] },
    { tipo: EVENTO.REVISION, expediente: 'EXP-001', origen: ORIGENES.REGLA, ts: T(2), datos: { campos: [
      { ruta: 'zzz.ultimo', aceptado: true, valor: 'z', cita: 'z', evidencia: 'Reportado' },
      { ruta: 'aaa.primero', aceptado: true, valor: 'a', cita: 'a', evidencia: 'Reportado' }
    ] } }
  ]))
  const otro = proyectar(conHashes([
    { ...TRES[0] },
    { tipo: EVENTO.REVISION, expediente: 'EXP-001', origen: ORIGENES.REGLA, ts: T(2), datos: { campos: [
      { ruta: 'aaa.primero', aceptado: true, valor: 'a', cita: 'a', evidencia: 'Reportado' },
      { ruta: 'zzz.ultimo', aceptado: true, valor: 'z', cita: 'z', evidencia: 'Reportado' }
    ] } }
  ]))
  assert.deepEqual(Object.keys(uno.campos), ['aaa.primero', 'zzz.ultimo'])
  assert.deepEqual(Object.keys(otro.campos), ['aaa.primero', 'zzz.ultimo'])

  // Se comparan los CAMPOS, no el expediente entero, y la razón importa:
  // `resumen.ultimoHash` difiere de forma legítima porque los dos eventos llevan
  // el array de campos en distinto orden, y en un array el orden SÍ es información
  // (T5-04). Dos ledgers distintos que describen los mismos hechos convergen al
  // mismo DATO aunque no al mismo hash — que es justo lo que la malla necesita.
  assert.equal(JSON.stringify(uno.campos), JSON.stringify(otro.campos))
  assert.notEqual(uno.resumen.ultimoHash, otro.resumen.ultimoHash,
    'y los hashes SÍ difieren: son dos historias distintas del mismo resultado')
})

/** Encadena una lista de campos de evento sin tocar disco. */
function conHashes (lista) {
  const out = []
  let prev = null
  for (const c of lista) { prev = crearEvento(c, prev); out.push(prev) }
  return out
}

// ═════════════════════════════════════════════════════════════════════
//  La proyección
// ═════════════════════════════════════════════════════════════════════

test('T5-P01 · la proyección es PURA: cien corridas, resultado idéntico', () => {
  const evs = conHashes(TRES)
  const primero = serializar(proyectar(evs))
  for (let i = 0; i < 100; i++) assert.equal(serializar(proyectar(evs)), primero)
})

test('T5-P02 · un ledger vacío proyecta un expediente vacío, no un error', () => {
  const e = proyectar([])
  assert.equal(e.id, null)
  assert.equal(e.resumen.eventos, 0)
})

test('T5-P03 · la fuente se conserva ENTERA', () => {
  const e = proyectar(conHashes(TRES))
  assert.equal(e.fuentes.length, 1)
  assert.match(e.fuentes[0].texto, /Juan Pérez/,
    'sin la fuente no se puede reverificar ni un solo anclaje mañana')
})

test('T5-P04 · mezclar dos expedientes en una proyección LANZA', () => {
  const evs = conHashes([TRES[0], { ...TRES[1], expediente: 'EXP-002' }])
  assert.throws(() => proyectar(evs), LedgerIncoherente)
})

test('T5-P05 · una transición ILEGAL en el ledger LANZA', () => {
  // Aquí sí se lanza, y es deliberado: no es una entrada mala del usuario
  // —eso es guardias.revisar(), que nunca lanza— sino CORRUPCIÓN del registro.
  const evs = conHashes([
    TRES[0],
    { tipo: EVENTO.TRANSICION, expediente: 'EXP-001', origen: ORIGENES.HUMANO, ts: T(2),
      motivo: 'confío', datos: { hacia: 'APROBADO' } }
  ])
  assert.throws(() => proyectar(evs), LedgerIncoherente,
    'ni una persona puede saltarse la extracción y la validación')
})

test('T5-P06 · APROBADO exige origen HUMANO también desde el ledger', () => {
  const evs = conHashes([
    TRES[0], TRES[1], TRES[2],
    { tipo: EVENTO.TRANSICION, expediente: 'EXP-001', origen: ORIGENES.REGLA, ts: T(4), datos: { hacia: 'VALIDADO' } },
    { tipo: EVENTO.TRANSICION, expediente: 'EXP-001', origen: ORIGENES.REGLA, ts: T(5), datos: { hacia: 'COMPLETO' } },
    { tipo: EVENTO.TRANSICION, expediente: 'EXP-001', origen: ORIGENES.LLM_LOCAL, ts: T(6), datos: { hacia: 'APROBADO' } }
  ])
  assert.throws(() => proyectar(evs), LedgerIncoherente, 'el software propone; nunca aprueba')
})

// ═════════════════════════════════════════════════════════════════════
//  La evidencia — O3 y O4, sobre el ledger
// ═════════════════════════════════════════════════════════════════════

test('T5-E01 · la evidencia SUBE con una observación mejor', () => {
  const e = proyectar(conHashes([
    TRES[0],
    revision(T(2), [{ ruta: 'titular.nombre', aceptado: true, valor: 'Juan Pérez', cita: 'c', evidencia: 'Estimado' }]),
    revision(T(3), [{ ruta: 'titular.nombre', aceptado: true, valor: 'Juan Pérez', cita: 'c', evidencia: 'Confirmado' }])
  ]))
  assert.equal(e.campos['titular.nombre'].evidencia, 'Confirmado')
})

test('T5-E02 · la evidencia NO baja por una observación peor: O3', () => {
  const e = proyectar(conHashes([
    TRES[0],
    revision(T(2), [{ ruta: 'titular.nombre', aceptado: true, valor: 'Juan Pérez', cita: 'c', evidencia: 'Confirmado' }]),
    revision(T(3), [{ ruta: 'titular.nombre', aceptado: true, valor: 'Juan Pérez', cita: 'c', evidencia: 'Estimado' }])
  ]))
  assert.equal(e.campos['titular.nombre'].evidencia, 'Confirmado',
    'una observación con menos respaldo no degrada lo que ya estaba probado')
})

test('T5-E03 · SOLO DOS eventos bajan la evidencia, y los dos los firma una persona: O4', () => {
  // La lista es cerrada y se comprueba entera: si alguien añade un tercer
  // evento capaz de degradar un campo, este test cae y hay que justificarlo.
  //
  // Son dos y no uno porque zanjar un conflicto entre fuentes puede significar
  // quedarse con el valor MENOS respaldado: el oficial que tiene los dos
  // documentos delante sabe cosas que el sistema no puede saber. Que pueda
  // hacerlo es el punto; que quede escrito con su nombre y su motivo, el precio.
  assert.deepEqual([...BAJA_EVIDENCIA], [EVENTO.CONTRADICCION, EVENTO.RESOLUCION_HUMANA])
  const e = proyectar(conHashes([
    TRES[0],
    revision(T(2), [{ ruta: 'titular.nombre', aceptado: true, valor: 'Juan Pérez', cita: 'c', evidencia: 'Confirmado' }]),
    { tipo: EVENTO.CONTRADICCION, expediente: 'EXP-001', origen: ORIGENES.HUMANO, ts: T(3),
      motivo: 'el segundo documento dice otro nombre',
      datos: { ruta: 'titular.nombre', evidencia: 'Estimado' } }
  ]))
  assert.equal(e.campos['titular.nombre'].evidencia, 'Estimado')
  assert.equal(e.contradicciones.length, 1)
  assert.match(e.contradicciones[0].motivo, /segundo documento/,
    'la evidencia no baja en silencio: baja dejando escrito qué la contradijo')
})

test('T5-E04 · una CONTRADICCION que no baja nada LANZA', () => {
  const evs = conHashes([
    TRES[0],
    revision(T(2), [{ ruta: 'titular.nombre', aceptado: true, valor: 'J', cita: 'c', evidencia: 'Estimado' }]),
    { tipo: EVENTO.CONTRADICCION, expediente: 'EXP-001', origen: ORIGENES.HUMANO, ts: T(3),
      motivo: 'x', datos: { ruta: 'titular.nombre', evidencia: 'Confirmado' } }
  ])
  assert.throws(() => proyectar(evs), /tiene que BAJAR/,
    'para SUBIR hace falta una observación nueva, no una contradicción')
})

test('T5-E05 · contradecir un campo que no está asentado LANZA', () => {
  const evs = conHashes([
    TRES[0],
    { tipo: EVENTO.CONTRADICCION, expediente: 'EXP-001', origen: ORIGENES.HUMANO, ts: T(2),
      motivo: 'x', datos: { ruta: 'no.existe', evidencia: 'Desconocido' } }
  ])
  assert.throws(() => proyectar(evs), LedgerIncoherente)
})

test('T5-E06 · un grado de evidencia inventado LANZA', () => {
  const evs = conHashes([
    TRES[0],
    revision(T(2), [{ ruta: 'titular.nombre', aceptado: true, valor: 'J', cita: 'c', evidencia: 'Confirmado' }]),
    { tipo: EVENTO.CONTRADICCION, expediente: 'EXP-001', origen: ORIGENES.HUMANO, ts: T(3),
      motivo: 'x', datos: { ruta: 'titular.nombre', evidencia: 'Dudoso' } }
  ])
  assert.throws(() => proyectar(evs), /grado de evidencia desconocido/)
})

const revision = (ts, campos) => ({
  tipo: EVENTO.REVISION, expediente: 'EXP-001', origen: ORIGENES.REGLA, ts, datos: { campos }
})

// ═════════════════════════════════════════════════════════════════════
//  El duplicado se ENLAZA, nunca se borra
// ═════════════════════════════════════════════════════════════════════

test('T5-D01 · un duplicado queda ENLAZADO, no borrado', () => {
  const e = proyectar(conHashes([
    TRES[0], TRES[1], TRES[2],
    { tipo: EVENTO.TRANSICION, expediente: 'EXP-001', origen: ORIGENES.REGLA, ts: T(4), datos: { hacia: 'VALIDADO' } },
    { tipo: EVENTO.DUPLICADO, expediente: 'EXP-001', origen: ORIGENES.REGLA, ts: T(5), datos: { de: 'EXP-000' } },
    { tipo: EVENTO.TRANSICION, expediente: 'EXP-001', origen: ORIGENES.REGLA, ts: T(6),
      motivo: 'mismo titular que EXP-000', datos: { hacia: 'DUPLICADO' } }
  ]))
  assert.equal(e.duplicadoDe, 'EXP-000')
  assert.equal(e.estado, 'DUPLICADO')
  assert.equal(e.resumen.camposAsentados, 2,
    'borrar destruiría la evidencia de que hubo un duplicado')
})

// ═════════════════════════════════════════════════════════════════════
//  El recorrido completo, tal como ocurre en sucursal
// ═════════════════════════════════════════════════════════════════════

test('T5-F01 · un expediente recorre CAPTURADO → APROBADO y queda auditable', () => {
  const b = banco()
  try {
    sembrar(b.ruta)
    registrar(b.ruta, { tipo: EVENTO.TRANSICION, expediente: 'EXP-001', origen: ORIGENES.REGLA, ts: T(4), datos: { hacia: 'VALIDADO' } })
    registrar(b.ruta, { tipo: EVENTO.TRANSICION, expediente: 'EXP-001', origen: ORIGENES.REGLA, ts: T(5), datos: { hacia: 'COMPLETO' } })
    registrar(b.ruta, { tipo: EVENTO.DECISION_HUMANA, expediente: 'EXP-001', origen: ORIGENES.HUMANO, ts: T(6),
                        motivo: 'documentos verificados en ventanilla', datos: { que: 'aprobar' } })
    registrar(b.ruta, { tipo: EVENTO.TRANSICION, expediente: 'EXP-001', origen: ORIGENES.HUMANO, ts: T(7), datos: { hacia: 'APROBADO' } })

    const evs = leer(b.ruta)
    assert.equal(verificarCadena(evs).intacta, true)

    const e = proyectar(evs)
    assert.equal(e.estado, 'APROBADO')
    assert.equal(e.historial.length, 4)
    assert.equal(e.decisiones.length, 1)
    assert.match(e.decisiones[0].motivo, /ventanilla/)
    assert.equal(e.resumen.porEvidencia.Reportado, 2)
    assert.equal(e.resumen.ultimoHash, evs[evs.length - 1].hash)
  } finally { b.limpiar() }
})

test('T5-F02 · el expediente proyectado es inmutable', () => {
  const e = proyectar(conHashes(TRES))
  assert.throws(() => { e.estado = 'APROBADO' }, TypeError)
  assert.throws(() => { e.campos['titular.nombre'].valor = 'otro' }, TypeError)
})

test('T5-F03 · anexar es la ÚNICA escritura, y el archivo solo crece', () => {
  const b = banco()
  try {
    sembrar(b.ruta)
    const antes = readFileSync(b.ruta, 'utf8')
    registrar(b.ruta, { tipo: EVENTO.TRANSICION, expediente: 'EXP-001', origen: ORIGENES.REGLA, ts: T(4), datos: { hacia: 'VALIDADO' } })
    const despues = readFileSync(b.ruta, 'utf8')
    assert.ok(despues.startsWith(antes), 'lo que ya estaba escrito no se toca jamás')
    assert.ok(despues.length > antes.length)
  } finally { b.limpiar() }
})
