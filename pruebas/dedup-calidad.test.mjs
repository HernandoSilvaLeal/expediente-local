// pruebas/dedup-calidad.test.mjs — T13 y T14
//
// Los dos módulos que cierran el núcleo. Ninguno de los dos usa IA:
// deduplicar es comparar claves, y repreguntar es leer el esquema.
//
// Corre sin modelo, sin red y sin el SDK.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { cargarEsquema } from '../core/esquema.mjs'
import { abrirExpediente } from '../core/expediente.mjs'
import { claveDe, comparar, buscarDuplicado, agrupar, VEREDICTO } from '../core/dedup.mjs'
import { calidad, preguntasPendientes, siguientePregunta, MOTIVO_PREGUNTA } from '../core/calidad.mjs'

const ESQ = cargarEsquema('instancias/banca/esquema.json')
import { FUENTE_ART18, expedienteArt18 } from './fixtures.mjs'

// Ver pruebas/fixtures.mjs: el expediente de referencia vive en un solo sitio
// desde que el esquema se amplió al artículo 18 del Acuerdo 1-2026.
const FUENTE = FUENTE_ART18

const dirs = []
function expedienteCon (id, extraido, fuente = FUENTE) {
  const dir = mkdtempSync(join(tmpdir(), 'expediente-dd-')); dirs.push(dir)
  let n = 0
  const exp = abrirExpediente({
    ruta: join(dir, 'e.jsonl'), esquema: ESQ, id,
    ahora: () => `2026-09-10T13:${String(n++).padStart(2, '0')}:00.000Z`
  })
  exp.capturar(fuente)
  exp.asentar(extraido)
  return exp.leer()
}
const limpiar = () => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) }

const COMPLETO = expedienteArt18()

// ═════════════════════════════════════════════════════════════════════
//  T13 · DEDUPLICACIÓN
// ═════════════════════════════════════════════════════════════════════

test('T13-01 · la clave natural sale del esquema, no del código', () => {
  try {
    assert.deepEqual([...ESQ.claveNatural], ['titular.cedula'])
    const e = expedienteCon('EXP-A', COMPLETO)
    assert.equal(claveDe(e, ESQ), '8 123 456', 'normalizada: los guiones no son el dato')
  } finally { limpiar() }
})

test('T13-02 · un campo RECHAZADO no puede servir de clave', () => {
  // Deduplicar por un dato que el sistema rechazó sería usar como identidad
  // justo lo que no se pudo probar.
  try {
    const e = expedienteCon('EXP-B', {
      ...COMPLETO,
      titular: { ...COMPLETO.titular, cedula: { valor: '8-999-999', cita: 'cédula 8-999-999' } }
    })
    assert.equal(claveDe(e, ESQ), null)
  } finally { limpiar() }
})

test('T13-03 · dos expedientes con la MISMA cédula y sin contradicciones → DUPLICADO', () => {
  try {
    const a = expedienteCon('EXP-A', COMPLETO)
    const b = expedienteCon('EXP-B', COMPLETO)
    const r = comparar(a, b, ESQ)
    assert.equal(r.veredicto, VEREDICTO.DUPLICADO)
    assert.equal(r.exigeHumano, false)
    assert.ok(r.coincidencias.length >= 4)
  } finally { limpiar() }
})

test('T13-04 · ⭐ G9 · misma cédula pero se CONTRADICEN → EN_CONFLICTO, y decide una persona', () => {
  // El corazón de G9: no se elige uno, no se promedia. Promediar dos fuentes que
  // se contradicen fabrica un dato que nadie dijo.
  try {
    const fuenteB = 'El titular es Juan Pérez Gómez, cédula 8-123-456. ' +
                    'Presenta el recibo del IDAAN del 12 de marzo de 2026 por 45.30 balboas.'
    const a = expedienteCon('EXP-A', COMPLETO)
    const b = expedienteCon('EXP-B', {
      ...COMPLETO,
      titular: {
        nombre: { valor: 'Juan Pérez Gómez', cita: 'El titular es Juan Pérez Gómez' },
        cedula: { valor: '8-123-456', cita: 'cédula 8-123-456' }
      }
    }, fuenteB)

    const r = comparar(a, b, ESQ)
    assert.equal(r.veredicto, VEREDICTO.EN_CONFLICTO)
    assert.equal(r.exigeHumano, true, 'es política de riesgo, no técnica')

    // Y da EXACTAMENTE lo que una persona necesita para decidir en diez segundos
    const d = r.discrepancias.find(x => x.ruta === 'titular.nombre')
    assert.ok(d, 'la discrepancia tiene que estar señalada')
    assert.equal(d.a, 'Juan Pérez González')
    assert.equal(d.b, 'Juan Pérez Gómez')
    assert.ok(d.citaA && d.citaB, 'con las DOS citas: sin ellas no se puede arbitrar')
  } finally { limpiar() }
})

test('T13-05 · cédulas distintas → DISTINTO', () => {
  try {
    const f2 = 'El titular es Ana Ruiz, cédula 3-777-888.'
    const a = expedienteCon('EXP-A', COMPLETO)
    const b = expedienteCon('EXP-B', {
      titular: {
        nombre: { valor: 'Ana Ruiz', cita: 'El titular es Ana Ruiz' },
        cedula: { valor: '3-777-888', cita: 'cédula 3-777-888' }
      },
      documentos: []
    }, f2)
    assert.equal(comparar(a, b, ESQ).veredicto, VEREDICTO.DISTINTO)
  } finally { limpiar() }
})

test('T13-06 · sin clave anclada, el veredicto es INDECIDIBLE, no "distinto"', () => {
  // Decir "distinto" cuando no se sabe es afirmar de más, y crearía expedientes
  // duplicados en silencio.
  try {
    const a = expedienteCon('EXP-A', COMPLETO)
    const b = expedienteCon('EXP-B', {
      ...COMPLETO,
      titular: { ...COMPLETO.titular, cedula: { valor: '8-000-000', cita: 'cédula 8-000-000' } }
    })
    assert.equal(comparar(a, b, ESQ).veredicto, VEREDICTO.INDECIDIBLE)
  } finally { limpiar() }
})

test('T13-07 · que falte un campo NO es contradecir', () => {
  try {
    const f2 = 'El titular es Juan Pérez González, cédula 8-123-456.'
    const a = expedienteCon('EXP-A', COMPLETO)
    const b = expedienteCon('EXP-B', { titular: COMPLETO.titular, documentos: [] }, f2)
    const r = comparar(a, b, ESQ)
    assert.equal(r.veredicto, VEREDICTO.DUPLICADO, 'silencio no es desacuerdo')
    assert.equal(r.discrepancias.length, 0)
  } finally { limpiar() }
})

test('T13-08 · buscarDuplicado se salta el propio expediente', () => {
  try {
    const a = expedienteCon('EXP-A', COMPLETO)
    assert.equal(buscarDuplicado(a, [a], ESQ), null, 'nadie es duplicado de sí mismo')
  } finally { limpiar() }
})

test('T13-09 · agrupar es determinista y separa los que no tienen clave', () => {
  try {
    const a = expedienteCon('EXP-A', COMPLETO)
    const b = expedienteCon('EXP-B', COMPLETO)
    const c = expedienteCon('EXP-C', {
      ...COMPLETO,
      titular: { ...COMPLETO.titular, cedula: { valor: '8-999-999', cita: 'cédula 8-999-999' } }
    })
    const g = agrupar([a, b, c], ESQ)
    assert.deepEqual([...g.sinClave], ['EXP-C'], 'no es basura: es lo que hay que mirar a mano')
    assert.equal(g.conDuplicados.length, 1)
    assert.deepEqual([...g.grupos['8 123 456']], ['EXP-A', 'EXP-B'])

    // Mismo conjunto en otro orden → mismo agrupamiento
    assert.equal(JSON.stringify(agrupar([c, b, a], ESQ).grupos), JSON.stringify(g.grupos))
  } finally { limpiar() }
})

test('T13-10 · dedup NO fusiona, NO elige y NO promedia', async () => {
  const mod = await import('../core/dedup.mjs')
  for (const prohibido of ['fusionar', 'merge', 'elegir', 'promediar', 'resolver', 'unificar']) {
    assert.equal(mod[prohibido], undefined,
      `dedup expone "${prohibido}": resolver un conflicto automáticamente es tomar una decisión de riesgo`)
  }
})

// ═════════════════════════════════════════════════════════════════════
//  T14 · CALIDAD Y REPREGUNTA — CERO IA
// ═════════════════════════════════════════════════════════════════════

test('T14-01 · un expediente completo puntúa completitud 1 y puede cerrar', () => {
  try {
    const q = calidad(expedienteCon('EXP-A', COMPLETO), ESQ)
    assert.equal(q.completitud, 1)
    assert.equal(q.puedeCerrar, true)
    assert.equal(q.criticosAusentes.length, 0)
  } finally { limpiar() }
})

test('T14-02 · completitud y respaldo se publican POR SEPARADO', () => {
  // Un expediente completo y flojo de evidencia NO es lo mismo que uno
  // incompleto y bien respaldado. Fundirlos en un número esconde la diferencia.
  try {
    const q = calidad(expedienteCon('EXP-A', COMPLETO), ESQ)
    assert.ok(q.completitud >= 0 && q.completitud <= 1)
    assert.ok(q.respaldo >= 0 && q.respaldo <= 1)
    assert.notEqual(q.completitud, q.respaldo, 'son dos ejes, no uno')
  } finally { limpiar() }
})

test('T14-03 · sin la cédula, NO puede cerrar', () => {
  try {
    const q = calidad(expedienteCon('EXP-A', {
      ...COMPLETO,
      titular: { ...COMPLETO.titular, cedula: { valor: '8-999-999', cita: 'cédula 8-999-999' } }
    }), ESQ)
    assert.equal(q.puedeCerrar, false)
    assert.ok(q.criticosAusentes.includes('titular.cedula'))
  } finally { limpiar() }
})

test('T14-04 · ⭐ se pregunta PRIMERO por lo crítico', () => {
  try {
    const e = expedienteCon('EXP-A', {
      ...COMPLETO,
      titular: { ...COMPLETO.titular, cedula: { valor: '8-999-999', cita: 'cédula 8-999-999' } },
      documentos: [{ ...COMPLETO.documentos[0], emisor: { valor: 'ETESA', cita: 'el recibo del IDAAN' } }]
    })
    const p = siguientePregunta(e, ESQ)
    assert.equal(p.ruta, 'titular.cedula', 'el crítico va antes que el opcional')
    assert.equal(p.critico, true)
  } finally { limpiar() }
})

test('T14-05 · la pregunta dice QUÉ falló, no solo qué falta', () => {
  try {
    const e = expedienteCon('EXP-A', {
      ...COMPLETO,
      titular: { ...COMPLETO.titular, cedula: { valor: '8-999-999', cita: 'cédula 8-999-999' } }
    })
    const p = siguientePregunta(e, ESQ)
    assert.equal(p.motivo, MOTIVO_PREGUNTA.RECHAZADO)
    assert.match(p.detalle, /G3/)
    assert.match(p.pregunta, /no aparece literalmente/,
      'decirle al oficial POR QUÉ falló es lo que hace que la segunda vez salga bien')
    assert.match(p.pregunta, /dictarlo tal cual/)
  } finally { limpiar() }
})

test('T14-06 · el orden de las preguntas es ESTABLE y auditable', () => {
  // Alfabético dentro de cada nivel, no por "importancia percibida": eso sería
  // un criterio que nadie puede discutir.
  try {
    const e = expedienteCon('EXP-A', {
      titular: { nombre: { valor: 'Juan Pérez González', cita: 'El titular es Juan Pérez González' } },
      documentos: []
    })
    const uno = preguntasPendientes(e, ESQ).map(p => p.ruta)
    for (let i = 0; i < 20; i++) {
      assert.deepEqual(preguntasPendientes(e, ESQ).map(p => p.ruta), uno)
    }
    assert.ok(uno.length > 0)
  } finally { limpiar() }
})

test('T14-07 · un expediente completo no tiene nada que preguntar', () => {
  try {
    assert.equal(siguientePregunta(expedienteCon('EXP-A', COMPLETO), ESQ), null)
  } finally { limpiar() }
})

test('T14-08 · la repregunta es una PLANTILLA, no texto generado', () => {
  // Un oficial de sucursal lee esto en pantalla. Que sea siempre igual se
  // aprende; un texto distinto cada vez obliga a leerlo entero otra vez.
  try {
    const hacer = () => siguientePregunta(expedienteCon('EXP-A', {
      ...COMPLETO,
      titular: { ...COMPLETO.titular, cedula: { valor: '8-999-999', cita: 'cédula 8-999-999' } }
    }), ESQ).pregunta
    const primera = hacer()
    for (let i = 0; i < 10; i++) assert.equal(hacer(), primera)
  } finally { limpiar() }
})

test('T14-09 · calidad es SÍNCRONA, así que no pudo consultar a nadie', () => {
  // ── LA TERCERA VEZ QUE CAIGO EN EL MISMO SITIO ────────────────────────────
  // Este test buscaba /@qvac/ en el fuente de calidad.mjs y fallaba, porque
  // encontraba la mención dentro del comentario que dice «PROHIBIDO importar
  // @qvac/sdk». Es EXACTAMENTE el falso positivo que ya tuvo el grep de la
  // frontera y la comparación de unidades de G4. Buscar cadenas en código
  // fuente no sirve, y a la tercera conviene aprenderlo.
  //
  // La prueba estructural es mejor y no se puede engañar: una función que
  // consulta un modelo TIENE que ser asíncrona. Estas no lo son, así que no
  // hay ninguna llamada esperando dentro. Y la frontera 95/5 cubre el import.
  assert.notEqual(calidad.constructor.name, 'AsyncFunction')
  assert.notEqual(preguntasPendientes.constructor.name, 'AsyncFunction')
  assert.notEqual(siguientePregunta.constructor.name, 'AsyncFunction')

  const r = siguientePregunta({ campos: {}, huecos: {} }, ESQ)
  assert.ok(!(r instanceof Promise), 'devuelve el resultado, no una promesa de tenerlo')
})

test('T14-10 · calidad y preguntas aguantan un expediente vacío', () => {
  for (const basura of [null, undefined, {}, { campos: {} }]) {
    assert.doesNotThrow(() => calidad(basura, ESQ))
    assert.doesNotThrow(() => preguntasPendientes(basura, ESQ))
  }
  assert.equal(calidad({}, ESQ).puedeCerrar, false)
})
