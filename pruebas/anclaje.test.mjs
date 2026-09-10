// pruebas/anclaje.test.mjs — T3
//
// Los primeros casos NO son inventados: son los tres errores que MedPsy 1.7B
// produjo en esta máquina el 9-sep-2026, con json_schema activo y JSON válido.
// Si el anclaje no los atrapa, el anclaje no sirve.
//
// Corre sin modelo, sin red y sin el SDK.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  anclar, MOTIVO, normalizar, citaEstaEnFuente, valorEstaEnCita,
  gradoDeEvidencia, promover
} from '../core/anclaje.mjs'

// ═════════════════════════════════════════════════════════════════════
//  LOS TRES ERRORES MEDIDOS — 9-sep-2026, MedPsy 1.7B, GPU, temp 0
// ═════════════════════════════════════════════════════════════════════

const FUENTE_MEDIDA =
  'Estoy en Hospital DemoCare Pacific, en Panama. Tienen tres resonadores ' +
  'magneticos Siemens y un tomografo. Uno de los resonadores parece de unos ocho anos.'

test('T3-medido-1 · la MARCA que saltó al tomógrafo NO ancla', () => {
  // El modelo devolvió: CT x1 con fabricante "Siemens".
  // "Siemens" está en la fuente, pero califica a los resonadores, no al tomógrafo.
  // La cita honesta del tomógrafo no contiene la marca.
  const r = anclar({ valor: 'Siemens', cita: 'y un tomografo' }, FUENTE_MEDIDA)
  assert.equal(r.anclado, false)
  assert.equal(r.motivo, MOTIVO.VALOR_AUSENTE,
    'la cita existe, pero el valor no sale de ella: es una invención con coartada')
  assert.equal(r.evidencia, 'Desconocido')
})

test('T3-medido-2 · la EDAD propagada a los tres resonadores no puede anclar como "tres"', () => {
  // El modelo devolvió: MRI x3 con antiguedad 8.
  // La fuente dice "UNO de los resonadores parece de unos ocho años".
  // No hay cita en la fuente que sostenga "los tres tienen ocho años".
  const r = anclar({ valor: 8, cita: 'los tres resonadores tienen ocho anos' }, FUENTE_MEDIDA)
  assert.equal(r.anclado, false)
  assert.equal(r.motivo, MOTIVO.CITA_AUSENTE,
    'esa frase no está en la fuente: el modelo la construyó')
})

test('T3-medido-3 · "parece de unos ocho años" es ESTIMADO, jamás Confirmado', () => {
  // El modelo devolvió confianza "Confirmado" sobre un "parece".
  const r = anclar({ valor: 8, cita: 'parece de unos ocho anos' }, FUENTE_MEDIDA)
  assert.equal(r.anclado, true, 'la cita sí existe y el valor está en ella')
  assert.equal(r.evidencia, 'Estimado',
    '"parece" y "unos" son atenuadores: el sistema no puede afirmar más que la fuente')
})

test('T3-medido-4 · lo que SÍ es verdad, ancla y se conserva', () => {
  const r = anclar({ valor: 'Siemens', cita: 'tres resonadores magneticos Siemens' }, FUENTE_MEDIDA)
  assert.equal(r.anclado, true)
  assert.equal(r.valor, 'Siemens')
  assert.equal(r.evidencia, 'Reportado', 'sin atenuador ni afirmador explícito')
})

test('T3-medido-5 · el país que NADIE dijo no ancla', () => {
  // El caso original del corpus: el modelo inventó pais:"Colombia".
  const r = anclar({ valor: 'Colombia', cita: 'en Colombia' }, FUENTE_MEDIDA)
  assert.equal(r.anclado, false)
  assert.equal(r.motivo, MOTIVO.CITA_AUSENTE)
})

// ═════════════════════════════════════════════════════════════════════
//  Los cinco motivos de rechazo — uno por cada uno
// ═════════════════════════════════════════════════════════════════════

const F = 'El recibo del IDAAN es del 12 de marzo de 2026 por 45.30 balboas.'

test('T3-01 · sin cita → SIN_CITA', () => {
  assert.equal(anclar({ valor: 'IDAAN', cita: '' }, F).motivo, MOTIVO.SIN_CITA)
  assert.equal(anclar({ valor: 'IDAAN', cita: '   ' }, F).motivo, MOTIVO.SIN_CITA)
  assert.equal(anclar({ valor: 'IDAAN' }, F).motivo, MOTIVO.SIN_CITA)
})

test('T3-02 · cita que no está en la fuente → CITA_AUSENTE', () => {
  assert.equal(anclar({ valor: 'ETESA', cita: 'el recibo de ETESA' }, F).motivo, MOTIVO.CITA_AUSENTE)
})

test('T3-03 · valor que no está en su cita → VALOR_AUSENTE', () => {
  assert.equal(anclar({ valor: 'ETESA', cita: 'El recibo del IDAAN' }, F).motivo, MOTIVO.VALOR_AUSENTE)
})

test('T3-04 · sin valor → VALOR_VACIO', () => {
  for (const v of [null, undefined, '']) {
    assert.equal(anclar({ valor: v, cita: 'IDAAN' }, F).motivo, MOTIVO.VALOR_VACIO)
  }
  assert.equal(anclar(null, F).motivo, MOTIVO.VALOR_VACIO)
  assert.equal(anclar('texto suelto', F).motivo, MOTIVO.VALOR_VACIO)
})

test('T3-05 · lo correcto ancla', () => {
  const r = anclar({ valor: 'IDAAN', cita: 'El recibo del IDAAN' }, F)
  assert.equal(r.anclado, true)
  assert.equal(r.motivo, MOTIVO.ANCLADO)
})

// ═════════════════════════════════════════════════════════════════════
//  Normalización — anclar sin abrir la puerta a casi-coincidencias
// ═════════════════════════════════════════════════════════════════════

test('T3-06 · las tildes y las mayúsculas no impiden anclar', () => {
  const f = 'El titular es JUAN PÉREZ GONZÁLEZ, cédula 8-123-456.'
  assert.ok(citaEstaEnFuente('Juan Pérez González', f))
  assert.ok(citaEstaEnFuente('juan perez gonzalez', f),
    'el modelo reescribe con otra capitalización: es el mismo dato')
})

test('T3-07 · la puntuación no impide anclar', () => {
  const f = 'Cédula: 8-123-456. Emitida el 01/02/2020.'
  assert.ok(citaEstaEnFuente('Cedula 8 123 456', f))
})

test('T3-08 · pero NO hay coincidencia difusa: parecido no es igual', () => {
  const f = 'El titular es Juan Pérez.'
  assert.ok(!citaEstaEnFuente('Juan Peres', f),
    'una letra de diferencia es otra persona. Fuzzy matching dejaría pasar invenciones')
  assert.ok(!citaEstaEnFuente('Juan Pérez Gómez', f))
})

test('T3-09 · normalizar es idempotente y no revienta con basura', () => {
  assert.equal(normalizar(normalizar('  ÁÉÍ,, óú  ')), normalizar('  ÁÉÍ,, óú  '))
  assert.equal(normalizar(null), '')
  assert.equal(normalizar(42), '')
  assert.equal(normalizar(undefined), '')
})

// ═════════════════════════════════════════════════════════════════════
//  Números: "tres" y 3 son el mismo dato
// ═════════════════════════════════════════════════════════════════════

test('T3-10 · un número ancla contra su forma escrita', () => {
  assert.ok(valorEstaEnCita(3, 'tres resonadores'))
  assert.ok(valorEstaEnCita(8, 'unos ocho anos'))
  assert.ok(valorEstaEnCita(2, 'dos ecografos'))
})

test('T3-11 · un número ancla contra su dígito', () => {
  assert.ok(valorEstaEnCita(45.30, 'por 45.30 balboas'))
  assert.ok(valorEstaEnCita(2026, 'marzo de 2026'))
})

test('T3-12 · un número que no está en la cita NO ancla', () => {
  assert.ok(!valorEstaEnCita(5, 'tres resonadores'),
    'el error más caro: cantidades que el modelo cambia')
  assert.ok(!valorEstaEnCita(1, 'tres resonadores'),
    'exactamente el fallo medido: dijo cantidad 1 sobre "tres resonadores"')
})

// ═════════════════════════════════════════════════════════════════════
//  El grado de evidencia — determinista, no autoevaluación del modelo
// ═════════════════════════════════════════════════════════════════════

test('T3-13 · los atenuadores degradan a Estimado', () => {
  for (const frase of [
    'parece de unos ocho anos', 'creo que son tres', 'aproximadamente 40 balboas',
    'alrededor de cinco', 'quizas dos', 'mas o menos diez'
  ]) {
    assert.equal(gradoDeEvidencia(frase, frase), 'Estimado', `"${frase}" debería ser Estimado`)
  }
})

test('T3-14 · los afirmadores permiten llegar a Confirmado', () => {
  for (const frase of [
    'segun el documento son ocho', 'consta en el certificado', 'esta firmado y sellado'
  ]) {
    assert.equal(gradoDeEvidencia(frase, frase), 'Confirmado')
  }
})

test('T3-15 · una afirmación llana es Reportado — ni más ni menos', () => {
  assert.equal(gradoDeEvidencia('tres resonadores', 'tres resonadores'), 'Reportado')
})

test('T3-16 · el atenuador gana al afirmador: ante la duda, se baja', () => {
  const f = 'segun el documento parece que son ocho'
  assert.equal(gradoDeEvidencia(f, f), 'Estimado',
    'si hay cualquier señal de incertidumbre, el sistema no puede afirmar')
})

// ═════════════════════════════════════════════════════════════════════
//  Promoción — el invariante O3: nunca baja en silencio
// ═════════════════════════════════════════════════════════════════════

test('T3-17 · promover sube, nunca baja', () => {
  assert.equal(promover('Estimado', 'Confirmado'), 'Confirmado')
  assert.equal(promover('Confirmado', 'Estimado'), 'Confirmado',
    'invariante O4: bajar exige registrar una contradicción, no ocurre en silencio')
  assert.equal(promover('Desconocido', 'Reportado'), 'Reportado')
  assert.equal(promover('Reportado', 'Reportado'), 'Reportado')
})

test('T3-18 · un grado inventado no promueve nada', () => {
  assert.equal(promover('Reportado', 'Segurísimo'), 'Reportado',
    'un grado fuera de la escala vale 0 y no puede subir a nadie')
})

// ═════════════════════════════════════════════════════════════════════
//  Determinismo — el argumento del video
// ═════════════════════════════════════════════════════════════════════

test('T3-19 · anclar es determinista: mil corridas, resultado idéntico', () => {
  const campo = { valor: 8, cita: 'parece de unos ocho anos' }
  const primero = JSON.stringify(anclar(campo, FUENTE_MEDIDA))
  for (let i = 0; i < 1000; i++) {
    assert.equal(JSON.stringify(anclar(campo, FUENTE_MEDIDA)), primero)
  }
})

test('T3-20 · el resultado es inmutable: nadie lo cambia después de decidido', () => {
  const r = anclar({ valor: 'IDAAN', cita: 'El recibo del IDAAN' }, F)
  assert.throws(() => { r.anclado = false }, TypeError)
})

test('T3-21 · los decimales anclan con punto o con coma', () => {
  // Bug real encontrado por T3-11: normalizar() quita la puntuación, así que
  // "45.30" pasa a "45 30", mientras String(45.30) en JS da "45.3".
  // La comparación es numérica, no textual.
  assert.ok(valorEstaEnCita(45.30, 'por 45.30 balboas'))
  assert.ok(valorEstaEnCita(45.30, 'por 45,30 balboas'), 'coma decimal, uso latinoamericano')
  assert.ok(valorEstaEnCita(1250,  'salario de 1250 al mes'))
  assert.ok(!valorEstaEnCita(45.31, 'por 45.30 balboas'), 'un céntimo de diferencia es otro monto')
})
