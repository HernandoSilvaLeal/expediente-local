// pruebas/estado.test.mjs — T2
//
// El plan exige: "1 test por transición legal + 1 por CADA ilegal que debe lanzar".
// Aquí se cumple literalmente, y las ilegales se generan del propio objeto
// TRANSICIONES — así que si mañana alguien añade un estado, los tests lo cubren solos.
//
// Corre sin modelo, sin red y sin el SDK.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ESTADOS, TRANSICIONES, ORIGENES, SOLO_HUMANO, EXIGEN_MOTIVO,
  esEstado, esTerminal, siguientes, esLegal,
  exigirTransicion, fichaMarkdown,
  TransicionIlegal, MotivoRequerido, OrigenNoAutorizado
} from '../core/estado.mjs'

// ─────────────────────────────────────────────────────────────
// La tabla es un dato, y es inmutable
// ─────────────────────────────────────────────────────────────

test('T2-01 · la tabla de transiciones es inmutable', () => {
  assert.throws(() => { TRANSICIONES.CAPTURADO = ['LO_QUE_SEA'] }, TypeError)
  assert.throws(() => { TRANSICIONES.CAPTURADO.push('LO_QUE_SEA') }, TypeError,
    'los arrays también deben estar congelados, o se pueden mutar por dentro')
})

test('T2-02 · todo estado declarado tiene entrada en la tabla, y al revés', () => {
  assert.deepEqual(Object.keys(ESTADOS).sort(), Object.keys(TRANSICIONES).sort(),
    'un estado sin fila en la tabla es un estado del que no se puede salir por accidente')
})

test('T2-03 · todo destino de la tabla es un estado que existe', () => {
  for (const [desde, destinos] of Object.entries(TRANSICIONES)) {
    for (const hacia of destinos) {
      assert.ok(esEstado(hacia), `${desde} → ${hacia}: el destino no existe`)
    }
  }
})

test('T2-04 · hay exactamente cuatro estados terminales', () => {
  const term = Object.keys(TRANSICIONES).filter(esTerminal).sort()
  assert.deepEqual(term, ['APROBADO', 'DESCARTADO', 'DUPLICADO', 'RECHAZADO'])
})

test('T2-05 · desde un terminal no se sale a ninguna parte', () => {
  for (const e of Object.keys(TRANSICIONES).filter(esTerminal)) {
    assert.deepEqual(siguientes(e), [], `${e} es terminal y debe estar vacío`)
  }
})

// ─────────────────────────────────────────────────────────────
// UNA POR CADA TRANSICIÓN LEGAL
// ─────────────────────────────────────────────────────────────

for (const [desde, destinos] of Object.entries(TRANSICIONES)) {
  for (const hacia of destinos) {
    test(`T2-legal · ${desde} → ${hacia} se permite`, () => {
      const ctx = {}
      if (EXIGEN_MOTIVO.includes(hacia)) ctx.motivo = 'motivo de prueba'
      if (SOLO_HUMANO.includes(hacia))   ctx.origen = ORIGENES.HUMANO
      const t = exigirTransicion(desde, hacia, ctx)
      assert.equal(t.desde, desde)
      assert.equal(t.hacia, hacia)
      assert.ok(Object.isFrozen(t), 'la transición devuelta debe ser inmutable')
    })
  }
}

// ─────────────────────────────────────────────────────────────
// UNA POR CADA TRANSICIÓN ILEGAL — generadas de la propia tabla
// ─────────────────────────────────────────────────────────────

const TODOS = Object.keys(TRANSICIONES)
let ilegalesProbadas = 0

for (const desde of TODOS) {
  for (const hacia of TODOS) {
    if (esLegal(desde, hacia)) continue
    ilegalesProbadas++
    test(`T2-ilegal · ${desde} → ${hacia} LANZA`, () => {
      assert.throws(
        () => exigirTransicion(desde, hacia, { motivo: 'x', origen: ORIGENES.HUMANO }),
        TransicionIlegal,
        `${desde} → ${hacia} no está en la tabla y debe rechazarse aunque venga con motivo y de un humano`
      )
    })
  }
}

test('T2-06 · se probaron todas las combinaciones ilegales', () => {
  const total = TODOS.length ** 2
  const legales = Object.values(TRANSICIONES).reduce((a, d) => a + d.length, 0)
  assert.equal(ilegalesProbadas, total - legales,
    `deben probarse las ${total - legales} combinaciones ilegales, no una muestra`)
  // El ratio que convence a un jurado: la mayoría de los tests prueban que
  // lo ilegal FALLA, no que lo legal funciona.
  assert.ok(ilegalesProbadas > legales * 3,
    'si hay más tests de camino feliz que de rechazo, la FSM no está probada')
})

// ─────────────────────────────────────────────────────────────
// Estados que no existen
// ─────────────────────────────────────────────────────────────

test('T2-07 · un estado de origen inventado LANZA', () => {
  assert.throws(() => exigirTransicion('PENDIENTE_DE_REVISION', 'APROBADO', { origen: ORIGENES.HUMANO }),
    /Estado desconocido/)
})

test('T2-08 · un estado de destino inventado LANZA', () => {
  assert.throws(() => exigirTransicion('CAPTURADO', 'CASI_LISTO'), TransicionIlegal)
})

// ─────────────────────────────────────────────────────────────
// El motivo obligatorio
// ─────────────────────────────────────────────────────────────

for (const hacia of EXIGEN_MOTIVO) {
  const desde = TODOS.find(d => esLegal(d, hacia))
  test(`T2-motivo · ${desde} → ${hacia} sin motivo LANZA`, () => {
    const ctx = SOLO_HUMANO.includes(hacia) ? { origen: ORIGENES.HUMANO } : {}
    assert.throws(() => exigirTransicion(desde, hacia, ctx), MotivoRequerido,
      'un rechazo sin causa no es auditable')
  })
}

test('T2-09 · un motivo vacío no cuenta como motivo', () => {
  assert.throws(() => exigirTransicion('CAPTURADO', 'DESCARTADO', { motivo: '' }), MotivoRequerido)
})

// ─────────────────────────────────────────────────────────────
// EL SOFTWARE NUNCA APRUEBA SOLO — la política, como test
// ─────────────────────────────────────────────────────────────

for (const hacia of SOLO_HUMANO) {
  for (const origen of [ORIGENES.LLM_LOCAL, ORIGENES.REGLA, ORIGENES.P2P]) {
    test(`T2-humano · ${hacia} con origen ${origen} LANZA`, () => {
      assert.throws(
        () => exigirTransicion('COMPLETO', hacia, { origen, motivo: 'x' }),
        OrigenNoAutorizado,
        'ni el modelo, ni una regla, ni otro dispositivo pueden aprobar un expediente'
      )
    })
  }
  test(`T2-humano · ${hacia} con origen HUMANO se permite`, () => {
    const t = exigirTransicion('COMPLETO', hacia, { origen: ORIGENES.HUMANO, motivo: 'revisado en ventanilla' })
    assert.equal(t.origen, ORIGENES.HUMANO)
  })
}

// ─────────────────────────────────────────────────────────────
// La ficha se genera del código — no puede divergir
// ─────────────────────────────────────────────────────────────

test('T2-10 · la ficha generada contiene todos los estados y las cuentas correctas', () => {
  const md = fichaMarkdown()
  for (const e of TODOS) assert.match(md, new RegExp(`\`${e}\``), `falta ${e} en la ficha`)
  const legales = Object.values(TRANSICIONES).reduce((a, d) => a + d.length, 0)
  assert.match(md, new RegExp(`\\*\\*${legales} transiciones legales`),
    'la ficha debe contar las transiciones desde la tabla, no de memoria')
})

// ─────────────────────────────────────────────────────────────
// El recorrido completo de un expediente feliz
// ─────────────────────────────────────────────────────────────

test('T2-11 · un expediente puede recorrer CAPTURADO → APROBADO', () => {
  let e = ESTADOS.CAPTURADO
  for (const [hacia, ctx] of [
    ['EXTRAIDO',  { origen: ORIGENES.LLM_LOCAL }],
    ['VALIDADO',  { origen: ORIGENES.REGLA }],
    ['COMPLETO',  { origen: ORIGENES.REGLA }],
    ['APROBADO',  { origen: ORIGENES.HUMANO }]
  ]) {
    e = exigirTransicion(e, hacia, ctx).hacia
  }
  assert.equal(e, ESTADOS.APROBADO)
  assert.ok(esTerminal(e))
})

test('T2-12 · no se puede saltar de CAPTURADO directo a APROBADO', () => {
  // El atajo que un desarrollador cansado intentaría a las 3 de la mañana.
  assert.throws(
    () => exigirTransicion('CAPTURADO', 'APROBADO', { origen: ORIGENES.HUMANO, motivo: 'confío' }),
    TransicionIlegal,
    'ni una persona puede saltarse la extracción y la validación'
  )
})
