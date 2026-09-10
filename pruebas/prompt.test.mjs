// pruebas/prompt.test.mjs — T6b
//
// El prompt es la instrucción más importante del sistema y casi se queda en el
// único directorio donde los tests no llegan. Aquí se prueba que dice lo que
// tiene que decir, y que sigue diciéndolo cuando alguien lo edite.
//
// Corre sin modelo, sin red y sin el SDK.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { construirSistema, EJEMPLO_ANTIPROPAGACION } from '../core/prompt.mjs'
import { cargarEsquema } from '../core/esquema.mjs'

const ESQ = cargarEsquema('instancias/banca/esquema.json')

test('T6b-01 · el prompt EXIGE la cita, o el sistema no extrae nada', () => {
  // Sin esta instrucción, anclaje.mjs rechaza absolutamente todos los campos.
  // El json_schema obliga a que la cita EXISTA; el modelo cumple el trámite
  // devolviendo cadena vacía si nadie le dice para qué sirve.
  const p = construirSistema(ESQ)
  assert.match(p, /cita/i)
  assert.match(p, /LITERAL/, 'tiene que decir que la cita es literal, no una paráfrasis')
})

test('T6b-02 · el prompt AUTORIZA dejar huecos', () => {
  // Un modelo al que no se le permite explícitamente no saber, inventa.
  const p = construirSistema(ESQ)
  assert.match(p, /NO lo inventes/)
  assert.match(p, /Un hueco es una respuesta correcta/)
})

test('T6b-03 · el prompt prohíbe la propagación — el error medido el 9-sep', () => {
  // "UNO de los resonadores parece de unos ocho años" se convirtió en los tres.
  const p = construirSistema(ESQ)
  assert.match(p, /UNO de tres/)
  assert.match(p, /NO significa que los tres/)
})

test('T6b-04 · el prompt avisa de que un programa comprueba las citas', () => {
  assert.match(construirSistema(ESQ), /búsqueda literal/)
})

test('T6b-05 · el prompt se GENERA del esquema, no está escrito a mano', () => {
  const banca = construirSistema(ESQ)
  assert.match(banca, /expediente/)
  assert.match(banca, /banca/)

  // El mismo código, otro dominio, otro prompt. Si estuviera escrito a mano,
  // este test no podría pasar sin editarlo.
  const salud = construirSistema({ entidad: 'equipo médico', dominio: 'salud' })
  assert.match(salud, /equipo médico/)
  assert.match(salud, /salud/)
  assert.ok(!salud.includes('banca'))
})

test('T6b-06 · los campos críticos se nombran EXPLÍCITAMENTE', () => {
  // Son los que impiden que el expediente llegue a COMPLETO si faltan.
  const p = construirSistema(ESQ)
  for (const c of ESQ.camposCriticos) {
    assert.ok(p.includes(c), `el prompt no menciona el campo crítico ${c}`)
  }
})

test('T6b-07 · un esquema sin críticos no rompe el prompt', () => {
  const p = construirSistema({ entidad: 'x', dominio: 'y' })
  assert.ok(p.length > 100)
  assert.ok(!p.includes('especial atención'))
})

test('T6b-08 · el prompt aguanta un esquema vacío sin reventar', () => {
  for (const basura of [null, undefined, {}, 42, 'texto']) {
    assert.doesNotThrow(() => construirSistema(basura))
    assert.ok(construirSistema(basura).length > 100)
  }
})

test('T6b-09 · la cita va ANTES que el formato de salida', () => {
  // Los modelos pequeños atienden más al principio de la instrucción que al
  // final. El orden de las reglas es una decisión, no el orden en que se me
  // ocurrieron.
  const p = construirSistema(ESQ)
  assert.ok(p.indexOf('cita') < p.indexOf('solo con el JSON'),
    'si el formato va primero, la cita es lo que el modelo se salta')
})

test('T6b-10 · construirSistema es determinista', () => {
  const primero = construirSistema(ESQ)
  for (let i = 0; i < 50; i++) assert.equal(construirSistema(ESQ), primero)
})

test('T6b-11 · el ejemplo antipropagación existe y NO está en el prompt por defecto', () => {
  // Alarga el contexto y en las pruebas el modelo cumplía sin él. Está escrito
  // para no tener que redactarlo a las tres de la mañana si el fallo reaparece.
  assert.match(EJEMPLO_ANTIPROPAGACION, /Lo que se dice de uno no se dice de todos/)
  assert.ok(!construirSistema(ESQ).includes(EJEMPLO_ANTIPROPAGACION))
})
