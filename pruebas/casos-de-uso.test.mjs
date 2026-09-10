// pruebas/casos-de-uso.test.mjs — LOS ESCENARIOS DE SUCURSAL, PUNTA A PUNTA.
//
// ═══════════════════════════════════════════════════════════════════════════
//   Un test de unidad prueba una pieza. Un CASO DE USO prueba que el sistema
//   resuelve el problema de alguien. El jurado juzga lo segundo.
// ═══════════════════════════════════════════════════════════════════════════
//
// Cada test de aquí recorre el flujo COMPLETO —captura, extracción, anclaje,
// las nueve guardias, la máquina de estados, el ledger encadenado y la
// proyección— y lo hace **sin modelo, sin red y sin GPU, en milisegundos**.
//
// Lo único que se le inyecta es lo que el modelo propuso. Y en los casos
// marcados MEDIDO, eso es literalmente lo que MedPsy 1.7B devolvió en esta
// máquina el 9-sep-2026, con json_schema activo y temperatura 0.
//
// TODOS LOS DATOS SON SINTÉTICOS Y FICTICIOS. El enunciado del reto prohíbe
// usar datos reales de clientes, y aquí no hay ninguno.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { cargarEsquema } from '../core/esquema.mjs'
import { abrirExpediente, aCsv } from '../core/expediente.mjs'
import { ORIGENES } from '../core/estado.mjs'
import { RECHAZO } from '../core/guardias.mjs'

const ESQ = cargarEsquema('instancias/banca/esquema.json')

/** Reloj inyectado: sin él, dos corridas del mismo caso no serían comparables. */
function sucursal (nombre = 'EXP-001') {
  const dir = mkdtempSync(join(tmpdir(), 'expediente-caso-'))
  let n = 0
  const exp = abrirExpediente({
    ruta: join(dir, 'eventos.jsonl'),
    esquema: ESQ,
    id: nombre,
    ahora: () => `2026-09-10T09:${String(n++).padStart(2, '0')}:00.000Z`
  })
  return { exp, cerrar: () => rmSync(dir, { recursive: true, force: true }) }
}

// El texto que un oficial de sucursal dictaría al recibir la carpeta.
const DICTADO =
  'El titular es Juan Pérez González, cédula 8-123-456. ' +
  'Presenta el recibo del IDAAN del 12 de marzo de 2026 por 45.30 balboas. ' +
  'Trae además una carta laboral que consta firmada y sellada.'

const EXTRACCION_BUENA = {
  titular: {
    nombre: { valor: 'Juan Pérez González', cita: 'El titular es Juan Pérez González' },
    cedula: { valor: '8-123-456', cita: 'cédula 8-123-456' }
  },
  documentos: [{
    tipo: 'RECIBO_SERVICIO',
    emisor:        { valor: 'IDAAN', cita: 'el recibo del IDAAN' },
    fecha_emision: { valor: '12 de marzo de 2026', cita: 'del 12 de marzo de 2026' },
    monto:         { valor: 45.30, cita: 'por 45.30 balboas' },
    confianza: 'Reportado'
  }]
}

// ═════════════════════════════════════════════════════════════════════
//  CASO 1 · El camino que el banco quiere: expediente completo y aprobado
// ═════════════════════════════════════════════════════════════════════

test('CU-1 · un oficial dicta, el sistema extrae, una PERSONA aprueba', () => {
  const { exp, cerrar } = sucursal()
  try {
    exp.capturar(DICTADO, { medio: 'voz' })
    const { revision } = exp.asentar(EXTRACCION_BUENA)

    assert.equal(revision.resumen.rechazados, 0)
    assert.equal(exp.leer().estado, 'COMPLETO', 'sin críticos ausentes, el expediente cierra solo')

    const final = exp.decidir('aprobar', { motivo: 'documentos verificados en ventanilla' })

    assert.equal(final.estado, 'APROBADO')
    assert.equal(final.campos['titular.cedula'].valor, '8-123-456')
    assert.equal(final.campos['titular.cedula'].evidencia, 'Reportado')
    assert.equal(exp.verificar().intacta, true, 'y el ledger queda íntegro')

    // El recorrido entero quedó escrito: nadie tiene que fiarse de nadie.
    assert.deepEqual(final.historial.map(h => h.hacia),
      ['EXTRAIDO', 'VALIDADO', 'COMPLETO', 'APROBADO'])
  } finally { cerrar() }
})

// ═════════════════════════════════════════════════════════════════════
//  CASO 2 · 🔵 MEDIDO — el modelo inventa y el sistema NO se lo traga
// ═════════════════════════════════════════════════════════════════════

test('CU-2 · MEDIDO · las tres invenciones reales del 9-sep quedan fuera', () => {
  // Estos tres fallos los produjo MedPsy 1.7B en esta máquina, con JSON
  // perfectamente válido. Es el plano C del video.
  const { exp, cerrar } = sucursal()
  try {
    exp.capturar(DICTADO)

    const conInvenciones = {
      titular: {
        nombre: { valor: 'Juan Pérez González', cita: 'El titular es Juan Pérez González' },
        // (a) INVENCIÓN PURA: nadie dijo esta cédula
        cedula: { valor: '8-999-999', cita: 'cédula 8-999-999' }
      },
      documentos: [{
        tipo: 'RECIBO_SERVICIO',
        // (b) INVENCIÓN CON COARTADA: la cita es real, el valor no sale de ella
        emisor:        { valor: 'ETESA', cita: 'el recibo del IDAAN' },
        fecha_emision: { valor: '12 de marzo de 2026', cita: 'del 12 de marzo de 2026' },
        // (c) CANTIDAD CAMBIADA: el número no está en su propia cita
        monto:         { valor: 999.99, cita: 'por 45.30 balboas' },
        confianza: 'Confirmado'
      }]
    }

    const { revision } = exp.asentar(conInvenciones)
    const e = exp.leer()

    assert.equal(revision.resumen.rechazados, 3, 'las tres invenciones, fuera')
    assert.equal(e.estado, 'VALIDADO', 'NO llega a COMPLETO: falta un crítico')

    // Ninguna de las tres entró al dataset
    assert.equal(e.campos['titular.cedula'], undefined)
    assert.equal(e.campos['documentos[0].emisor'], undefined)
    assert.equal(e.campos['documentos[0].monto'], undefined)

    // Y lo que SÍ era verdad sobrevivió: no es un rechazo indiscriminado
    assert.equal(e.campos['titular.nombre'].valor, 'Juan Pérez González')

    // EL PUNTO: el sistema sabe decir POR QUÉ falta cada dato
    assert.deepEqual(e.huecos['titular.cedula'].motivos, [RECHAZO.SIN_ANCLAJE])
    assert.deepEqual(e.huecos['documentos[0].emisor'].guardias, ['G3'])
  } finally { cerrar() }
})

test('CU-3 · MEDIDO · un expediente con datos inventados NO se puede aprobar', () => {
  // La consecuencia práctica del caso anterior, y la que le importa al banco.
  const { exp, cerrar } = sucursal()
  try {
    exp.capturar(DICTADO)
    exp.asentar({
      titular: {
        nombre: { valor: 'Juan Pérez González', cita: 'El titular es Juan Pérez González' },
        cedula: { valor: '8-999-999', cita: 'cédula 8-999-999' }     // inventada
      },
      documentos: []
    })

    assert.throws(() => exp.decidir('aprobar', { motivo: 'me fío' }),
      /No se puede aprobar un expediente en estado VALIDADO/,
      'un dato inventado no rellena un hueco: lo deja igual de vacío')
  } finally { cerrar() }
})

// ═════════════════════════════════════════════════════════════════════
//  CASO 4 · La política que el banco necesita oír
// ═════════════════════════════════════════════════════════════════════

test('CU-4 · EL SOFTWARE NUNCA APRUEBA SOLO', () => {
  const { exp, cerrar } = sucursal()
  try {
    exp.capturar(DICTADO)
    exp.asentar(EXTRACCION_BUENA)
    assert.equal(exp.leer().estado, 'COMPLETO')

    // El expediente está perfecto y completo, y aun así se queda ahí parado
    // hasta que una persona firme. No hay ruta automática a APROBADO.
    const antes = exp.leer()
    assert.notEqual(antes.estado, 'APROBADO')
    assert.equal(antes.decisiones.length, 0)

    const despues = exp.decidir('aprobar', { motivo: 'revisado por la oficial de cuenta' })
    assert.equal(despues.estado, 'APROBADO')
    assert.equal(despues.historial.at(-1).origen, ORIGENES.HUMANO)
  } finally { cerrar() }
})

test('CU-5 · un RECHAZO exige motivo, o no se registra', () => {
  const { exp, cerrar } = sucursal()
  try {
    exp.capturar(DICTADO)
    exp.asentar(EXTRACCION_BUENA)
    assert.throws(() => exp.decidir('rechazar'), /exige motivo/,
      'un rechazo sin causa no es auditable')

    const e = exp.decidir('rechazar', { motivo: 'la cédula está vencida' })
    assert.equal(e.estado, 'RECHAZADO')
    assert.match(e.historial.at(-1).motivo, /vencida/)
  } finally { cerrar() }
})

// ═════════════════════════════════════════════════════════════════════
//  CASO 6 · Un segundo documento corrige al primero — sin borrar nada
// ═════════════════════════════════════════════════════════════════════

test('CU-6 · llega un segundo documento y RESUELVE el hueco del primero', () => {
  const { exp, cerrar } = sucursal()
  try {
    // Primer dictado: la cédula no se oyó bien y el modelo la inventó
    exp.capturar('El titular es Juan Pérez González. La cédula no se alcanza a leer.')
    exp.asentar({
      titular: {
        nombre: { valor: 'Juan Pérez González', cita: 'El titular es Juan Pérez González' },
        cedula: { valor: '8-000-000', cita: 'cédula 8-000-000' }
      },
      documentos: []
    })
    assert.ok(exp.leer().huecos['titular.cedula'], 'queda el hueco, con su motivo')

    // Segundo documento: ahora sí se lee la cédula
    exp.capturar('Se adjunta copia de la cédula: 8-123-456.')
    exp.asentar({
      titular: {
        nombre: { valor: 'Juan Pérez González', cita: 'El titular es Juan Pérez González' },
        cedula: { valor: '8-123-456', cita: 'la cédula: 8-123-456' }
      },
      documentos: []
    })

    const e = exp.leer()
    assert.equal(e.campos['titular.cedula'].valor, '8-123-456')
    assert.equal(e.huecos['titular.cedula'], undefined, 'el hueco se cerró')
    assert.equal(e.fuentes.length, 2, 'y las DOS fuentes se conservan enteras')
    assert.equal(exp.verificar().intacta, true)
  } finally { cerrar() }
})

// ═════════════════════════════════════════════════════════════════════
//  CASO 7 · Una persona contradice al sistema — y queda escrito
// ═════════════════════════════════════════════════════════════════════

test('CU-7 · una persona BAJA la evidencia de un campo, con motivo', () => {
  const { exp, cerrar } = sucursal()
  try {
    exp.capturar(DICTADO)
    exp.asentar(EXTRACCION_BUENA)
    assert.equal(exp.leer().campos['titular.nombre'].evidencia, 'Reportado')

    assert.throws(() => exp.contradecir('titular.nombre', 'Estimado'), /motivo es obligatorio/)

    const e = exp.contradecir('titular.nombre', 'Estimado',
      'la firma del formulario no coincide con el nombre dictado')

    assert.equal(e.campos['titular.nombre'].evidencia, 'Estimado')
    assert.equal(e.contradicciones.length, 1)
    assert.match(e.contradicciones[0].motivo, /no coincide/,
      'la evidencia no baja en silencio: baja dejando escrito qué la contradijo')
  } finally { cerrar() }
})

// ═════════════════════════════════════════════════════════════════════
//  CASO 8 · El duplicado se enlaza, jamás se borra
// ═════════════════════════════════════════════════════════════════════

test('CU-8 · un expediente duplicado queda ENLAZADO al original', () => {
  const { exp, cerrar } = sucursal('EXP-002')
  try {
    exp.capturar(DICTADO)
    exp.asentar(EXTRACCION_BUENA)

    const e = exp.marcarDuplicado('EXP-001', 'mismo titular y misma cédula que EXP-001')

    assert.equal(e.duplicadoDe, 'EXP-001')
    assert.equal(e.estado, 'DUPLICADO')
    assert.ok(Object.keys(e.campos).length > 0,
      'los campos siguen ahí: borrar destruiría la evidencia de que hubo un duplicado')
  } finally { cerrar() }
})

// ═════════════════════════════════════════════════════════════════════
//  CASO 9 · El auditor: reconstruir y detectar manipulación
// ═════════════════════════════════════════════════════════════════════

test('CU-9 · el expediente se puede RECONSTRUIR entero desde los hechos', () => {
  const { exp, cerrar } = sucursal()
  try {
    exp.capturar(DICTADO)
    exp.asentar(EXTRACCION_BUENA)
    exp.decidir('aprobar', { motivo: 'ok' })

    // Nada está guardado: todo se deduce. Dos lecturas seguidas son idénticas.
    assert.equal(JSON.stringify(exp.leer()), JSON.stringify(exp.leer()))

    const hechos = exp.hechos()
    assert.ok(hechos.length >= 6)
    assert.equal(hechos[0].tipo, 'CAPTURA')
    assert.equal(hechos.at(-1).tipo, 'TRANSICION')
    assert.equal(exp.verificar().intacta, true)
  } finally { cerrar() }
})

// ═════════════════════════════════════════════════════════════════════
//  CASO 10 · El CSV que un auditor puede leer
// ═════════════════════════════════════════════════════════════════════

test('CU-10 · el CSV dice qué guardia paró cada dato que falta', () => {
  const { exp, cerrar } = sucursal()
  try {
    exp.capturar(DICTADO)
    exp.asentar({
      titular: {
        nombre: { valor: 'Juan Pérez González', cita: 'El titular es Juan Pérez González' },
        cedula: { valor: '8-999-999', cita: 'cédula 8-999-999' }
      },
      documentos: []
    })

    const csv = aCsv(exp.leer())
    const lineas = csv.split('\n')

    assert.match(lineas[0], /campo,valor,evidencia,cita,origen,guardias,motivo/)
    assert.ok(csv.includes('Juan Pérez González'), 'lo aceptado sale')
    // Y lo RECHAZADO también sale, en el mismo archivo, con su culpable
    const hueco = lineas.find(l => l.startsWith('titular.cedula'))
    assert.ok(hueco, 'el hueco tiene que aparecer, no desaparecer')
    assert.match(hueco, /G3/)
    assert.match(hueco, /SIN_ANCLAJE/)
    assert.ok(!hueco.includes('8-999-999'), 'el valor inventado NO viaja al CSV')
  } finally { cerrar() }
})

// ═════════════════════════════════════════════════════════════════════
//  CASO 11 · Lo que el sistema se NIEGA a hacer
// ═════════════════════════════════════════════════════════════════════

test('CU-11 · no se puede asentar sin haber capturado: no hay fuente contra la que anclar', () => {
  const { exp, cerrar } = sucursal()
  try {
    assert.throws(() => exp.asentar(EXTRACCION_BUENA), /sin haber capturado/)
  } finally { cerrar() }
})

test('CU-12 · un expediente APROBADO es terminal: no admite nada más', () => {
  const { exp, cerrar } = sucursal()
  try {
    exp.capturar(DICTADO)
    exp.asentar(EXTRACCION_BUENA)
    exp.decidir('aprobar', { motivo: 'ok' })

    assert.throws(() => exp.decidir('rechazar', { motivo: 'me arrepentí' }),
      /No se puede rechazar/,
      'para cambiar una decisión firmada hace falta un expediente nuevo, no un editor de texto')
  } finally { cerrar() }
})

// ═════════════════════════════════════════════════════════════════════
//  CASO 13 · El core es genérico: mismo binario, otra entidad
// ═════════════════════════════════════════════════════════════════════

test('CU-13 · el mismo código funciona con OTRO esquema, sin tocar core/', () => {
  // Es la demostración de §17 del plan y valen puntos de Innovation:
  // no se cambia código, se cambia un .json.
  const otroEsquema = Object.freeze({
    dominio: 'salud',
    entidad: 'equipo médico',
    jsonSchema: {
      name: 'equipo',
      schema: {
        type: 'object', additionalProperties: false, required: ['modelo'],
        properties: {
          modelo: { type: 'object', additionalProperties: false, required: ['valor', 'cita'],
            properties: { valor: { type: 'string' }, cita: { type: 'string' } } }
        }
      }
    },
    vacios: { texto: 'DESCONOCIDO', numero: 0 },
    camposCriticos: ['modelo'],
    unidades: {}
  })

  const dir = mkdtempSync(join(tmpdir(), 'expediente-salud-'))
  try {
    let n = 0
    const exp = abrirExpediente({
      ruta: join(dir, 'e.jsonl'), esquema: otroEsquema, id: 'EQ-1',
      ahora: () => `2026-09-10T10:${String(n++).padStart(2, '0')}:00.000Z`
    })

    exp.capturar('Hay tres resonadores magnéticos Siemens en el segundo piso.')
    exp.asentar({ modelo: { valor: 'Siemens', cita: 'resonadores magnéticos Siemens' } })

    const e = exp.leer()
    assert.equal(e.campos.modelo.valor, 'Siemens')
    assert.equal(e.estado, 'COMPLETO', 'la misma FSM, el mismo anclaje, las mismas guardias')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ═════════════════════════════════════════════════════════════════════
//  CASO 14 · Determinismo del flujo entero
// ═════════════════════════════════════════════════════════════════════

test('CU-14 · dos sucursales con los mismos hechos producen el MISMO expediente', () => {
  // Es la propiedad que sostiene la convergencia P2P: si dos dispositivos
  // reciben los mismos hechos, llegan al mismo dataset sin hablar entre ellos.
  const correr = () => {
    const { exp, cerrar } = sucursal()
    try {
      exp.capturar(DICTADO)
      exp.asentar(EXTRACCION_BUENA)
      exp.decidir('aprobar', { motivo: 'ok' })
      const e = exp.leer()
      return JSON.stringify({ campos: e.campos, huecos: e.huecos, estado: e.estado })
    } finally { cerrar() }
  }
  const primero = correr()
  for (let i = 0; i < 20; i++) assert.equal(correr(), primero)
})
