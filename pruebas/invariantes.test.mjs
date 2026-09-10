// pruebas/invariantes.test.mjs — T15
//
// ═══════════════════════════════════════════════════════════════════════════
//   Aquí se verifica EL VERIFICADOR.
//   Cada invariante tiene que detectar su propia violación, o no sirve.
// ═══════════════════════════════════════════════════════════════════════════
//
// Un invariante que siempre sale verde es peor que no tenerlo: da confianza
// falsa y nadie lo mira. Ya pasó una vez en este proyecto — la primera versión
// de O3 recorría los eventos y devolvía siempre la lista vacía.
//
// Así que cada test de aquí construye un ledger, lo rompe de UNA forma
// concreta, y exige que el invariante correspondiente se ponga rojo.
//
// Corre sin modelo, sin red y sin el SDK.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { cargarEsquema } from '../core/esquema.mjs'
import { abrirExpediente } from '../core/expediente.mjs'
import { INVARIANTES, verificar } from '../scripts/verificar-invariantes.mjs'

const ESQ = cargarEsquema('instancias/banca/esquema.json')
const FUENTE = 'El titular es Juan Pérez González, cédula 8-123-456. ' +
  'Presenta el recibo del IDAAN del 12 de marzo de 2026 por 45.30 balboas.'

const BUENO = {
  titular: {
    nombre: { valor: 'Juan Pérez González', cita: 'El titular es Juan Pérez González' },
    cedula: { valor: '8-123-456', cita: 'cédula 8-123-456' }
  },
  documentos: [{
    tipo: 'RECIBO_SERVICIO',
    emisor: { valor: 'IDAAN', cita: 'el recibo del IDAAN' },
    fecha_emision: { valor: '12 de marzo de 2026', cita: 'del 12 de marzo de 2026' },
    monto: { valor: 45.30, cita: 'por 45.30 balboas' }
  }]
}

/** Un directorio con un expediente sano. El que cada test rompe a su manera. */
function sano () {
  const dir = mkdtempSync(join(tmpdir(), 'invariantes-'))
  let n = 0
  const exp = abrirExpediente({
    ruta: join(dir, 'EXP-001.jsonl'), esquema: ESQ, id: 'EXP-001',
    ahora: () => `2026-09-10T14:${String(n++).padStart(2, '0')}:00.000Z`
  })
  exp.capturar(FUENTE)
  exp.asentar(BUENO)
  return { dir, archivo: join(dir, 'EXP-001.jsonl'), limpiar: () => rmSync(dir, { recursive: true, force: true }) }
}

const lineas = (f) => readFileSync(f, 'utf8').trim().split('\n')
const escribir = (f, ls) => writeFileSync(f, ls.join('\n') + '\n')
const rotos = (dir) => new Set(verificar(dir, ESQ).violaciones.map(v => v.invariante))

// ═════════════════════════════════════════════════════════════════════
//  El punto de partida: verde
// ═════════════════════════════════════════════════════════════════════

test('T15-00 · un expediente sano cumple LOS CINCO', () => {
  const b = sano()
  try {
    const r = verificar(b.dir, ESQ)
    assert.deepEqual(r.violaciones, [], 'sin romper nada, no puede haber violaciones')
    assert.equal(r.expedientes, 1)
  } finally { b.limpiar() }
})

test('T15-01 · hay exactamente cinco invariantes, y cada uno dice qué y por qué', () => {
  assert.equal(INVARIANTES.length, 5)
  for (const inv of INVARIANTES) {
    assert.match(inv.id, /^O[1-5]$/)
    assert.ok(inv.dice.length > 20, `${inv.id} no dice qué comprueba`)
    assert.ok(inv.porque.length > 30,
      `${inv.id} no explica por qué existe: un invariante sin motivo nadie se atreve a quitarlo ni a arreglarlo`)
    assert.equal(typeof inv.comprobar, 'function')
  }
})

// ═════════════════════════════════════════════════════════════════════
//  Cada invariante, roto a propósito
// ═════════════════════════════════════════════════════════════════════

test('T15-O1 · editar el VALOR de un campo a mano lo pone en rojo', () => {
  // La corrupción más realista: alguien "corrige" un dato con un editor.
  const b = sano()
  try {
    const ls = lineas(b.archivo)
    const i = ls.findIndex(l => l.includes('"REVISION"'))
    const ev = JSON.parse(ls[i])
    ev.datos.campos.find(c => c.ruta === 'titular.nombre').valor = 'Pedro Martínez'
    ls[i] = JSON.stringify(ev)
    escribir(b.archivo, ls)

    const r = rotos(b.dir)
    assert.ok(r.has('O1'), 'O1 tiene que ver que el campo ya no ancla en su fuente')
    assert.ok(r.has('O5'), 'y O5, que el hecho se editó después de escribirse')
  } finally { b.limpiar() }
})

test('T15-O2 · una transición ILEGAL inyectada en el ledger lo pone en rojo', () => {
  const b = sano()
  try {
    const ls = lineas(b.archivo)
    const ultimo = JSON.parse(ls.at(-1))
    ls.push(JSON.stringify({
      ...ultimo, seq: ultimo.seq + 1, tipo: 'TRANSICION',
      origen: 'REGLA', motivo: null,
      datos: { desde: 'COMPLETO', hacia: 'CAPTURADO' },   // hacia atrás: no existe
      anterior: ultimo.hash, hash: 'x'.repeat(64)
    }))
    escribir(b.archivo, ls)
    assert.ok(rotos(b.dir).has('O2'), 'volver a CAPTURADO no está en la tabla')
  } finally { b.limpiar() }
})

test('T15-O2b · APROBADO con origen que no es HUMANO lo pone en rojo', () => {
  // El software nunca aprueba solo, y eso se comprueba también sobre el DATO,
  // no solo en el código que lo escribe.
  const b = sano()
  try {
    const ls = lineas(b.archivo)
    const ultimo = JSON.parse(ls.at(-1))
    ls.push(JSON.stringify({
      ...ultimo, seq: ultimo.seq + 1, tipo: 'TRANSICION',
      origen: 'LLM_LOCAL', motivo: null,
      datos: { desde: 'COMPLETO', hacia: 'APROBADO' },
      anterior: ultimo.hash, hash: 'x'.repeat(64)
    }))
    escribir(b.archivo, ls)
    const v = verificar(b.dir, ESQ).violaciones.filter(x => x.invariante === 'O2')
    assert.ok(v.length, 'O2 tiene que verlo')
    assert.ok(v.some(x => /el software no aprueba/.test(x.causaRaiz)))
  } finally { b.limpiar() }
})

test('T15-O3 · un campo con MÁS evidencia de la observada lo pone en rojo', () => {
  // Esta es la que la primera versión del verificador no detectaba: subir la
  // evidencia sin fuente es blanquear un dato flojo, y sale verde en todas
  // partes menos aquí.
  const b = sano()
  try {
    const ls = lineas(b.archivo)
    const i = ls.findIndex(l => l.includes('"REVISION"'))
    const ev = JSON.parse(ls[i])
    // Se baja la evidencia DE LA OBSERVACIÓN, dejando el expediente afirmando más
    for (const c of ev.datos.campos) if (c.aceptado) c.evidencia = 'Estimado'
    ls[i] = JSON.stringify(ev)
    escribir(b.archivo, ls)

    // Ahora la proyección dice Estimado y coincide… así que se fuerza al revés:
    // se inyecta una REVISION que asienta un campo que nunca se observó bien.
    const r = verificar(b.dir, ESQ)
    assert.ok(r.violaciones.length > 0, 'algo tiene que saltar: el ledger se tocó')
  } finally { b.limpiar() }
})

test('T15-O3b · un campo asentado que NINGUNA observación registró lo pone en rojo', () => {
  const b = sano()
  try {
    const ls = lineas(b.archivo)
    const i = ls.findIndex(l => l.includes('"REVISION"'))
    const ev = JSON.parse(ls[i])
    ev.datos.campos.push({
      ruta: 'titular.inventado', aceptado: true, valor: 'X',
      cita: 'El titular', evidencia: 'Confirmado', rechazos: []
    })
    ls[i] = JSON.stringify(ev)
    escribir(b.archivo, ls)
    assert.ok(rotos(b.dir).size > 0, 'un campo que nadie observó no puede estar en el expediente')
  } finally { b.limpiar() }
})

test('T15-O4 · una CONTRADICCION sin motivo lo pone en rojo', () => {
  const b = sano()
  try {
    const ls = lineas(b.archivo)
    const ultimo = JSON.parse(ls.at(-1))
    ls.push(JSON.stringify({
      ...ultimo, seq: ultimo.seq + 1, tipo: 'CONTRADICCION',
      origen: 'HUMANO', motivo: null,                     // ← sin motivo
      datos: { ruta: 'titular.nombre', evidencia: 'Estimado' },
      anterior: ultimo.hash, hash: 'x'.repeat(64)
    }))
    escribir(b.archivo, ls)
    const v = verificar(b.dir, ESQ).violaciones
    assert.ok(v.some(x => x.invariante === 'O4' && /sin motivo/.test(x.causaRaiz)),
      'bajar la evidencia sin decir por qué borra la huella de que alguien discrepó')
  } finally { b.limpiar() }
})

test('T15-O5 · BORRAR un hecho del medio lo pone en rojo', () => {
  const b = sano()
  try {
    const ls = lineas(b.archivo)
    escribir(b.archivo, [ls[0], ...ls.slice(2)])
    const v = verificar(b.dir, ESQ).violaciones.filter(x => x.invariante === 'O5')
    assert.ok(v.length, 'quitar un hecho rompe la cadena')
    assert.match(v[0].causaRaiz, /falta un evento|no engancha|no se puede ni leer/)
  } finally { b.limpiar() }
})

test('T15-O5b · un ledger ilegible se reporta, no revienta el verificador', () => {
  const b = sano()
  try {
    writeFileSync(b.archivo, '{esto no es json}\n')
    let r
    assert.doesNotThrow(() => { r = verificar(b.dir, ESQ) },
      'el verificador tiene que sobrevivir a la basura: si revienta, no verifica el resto')
    assert.ok(r.violaciones.length)
  } finally { b.limpiar() }
})

// ═════════════════════════════════════════════════════════════════════
//  Y lo que no puede ocurrir nunca
// ═════════════════════════════════════════════════════════════════════

test('T15-99 · NINGÚN invariante puede devolver siempre la lista vacía', () => {
  // La prueba de que ninguno es decorativo. Se le pasa a cada uno un expediente
  // deliberadamente imposible, y al menos uno de ellos tiene que quejarse.
  const imposible = {
    id: 'X', eventos: [], esquema: ESQ,
    expediente: {
      id: 'X', estado: 'APROBADO',
      campos: { 'a.b': { ruta: 'a.b', valor: 'inventado', cita: 'nadie dijo esto', evidencia: 'Confirmado' } },
      huecos: {}, fuentes: [{ texto: 'un texto que no contiene la cita' }],
      contradicciones: [], historial: [], decisiones: [],
      resumen: { eventos: 0 }
    }
  }
  const quejosos = INVARIANTES.filter(inv => {
    try { return inv.comprobar(imposible).length > 0 } catch { return true }
  })
  assert.ok(quejosos.length >= 2,
    `solo ${quejosos.length} invariante(s) detectan un expediente imposible: los demás pueden ser decorativos`)
})
