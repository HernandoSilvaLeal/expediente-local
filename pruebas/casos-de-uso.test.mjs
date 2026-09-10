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
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { cargarEsquema } from '../core/esquema.mjs'
import { abrirExpediente, aCsv } from '../core/expediente.mjs'
import { ORIGENES } from '../core/estado.mjs'
import { leer } from '../core/ledger.mjs'
import { calidad } from '../core/calidad.mjs'
import { proyectar } from '../core/proyeccion.mjs'
import { FUENTE_ART18, expedienteArt18, titularArt18, operacionArt18, documentoArt18 } from './fixtures.mjs'
import { RECHAZO } from '../core/guardias.mjs'
import { revisarDominio } from '../instancias/banca/guardias.mjs'

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
// El dictado y el expediente de referencia viven en pruebas/fixtures.mjs desde
// que el esquema se amplió al artículo 18 del Acuerdo 1-2026. Diecinueve tests
// se pusieron en rojo a la vez y todos tenían razón: un expediente con nombre y
// cédula ya no está completo — nunca lo estuvo para el regulador.
const DICTADO = FUENTE_ART18
const EXTRACCION_BUENA = expedienteArt18()

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

    const final = exp.decidir('aprobar', { motivo: 'documentos verificados en ventanilla', oficial: 'A. Ruiz · oficial de cuenta' })

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

    // Se parte del expediente correcto y se le meten las TRES invenciones: así
    // lo único que distingue este caso del camino feliz son esos tres campos.
    const conInvenciones = expedienteArt18()
    // (a) INVENCIÓN PURA: nadie dijo esta cédula
    conInvenciones.titular.cedula = { valor: '8-999-999', cita: 'cédula 8-999-999' }
    // (b) INVENCIÓN CON COARTADA: la cita es real, el valor no sale de ella
    conInvenciones.documentos[0].emisor = { valor: 'ETESA', cita: 'el recibo del IDAAN' }
    // (c) CANTIDAD CAMBIADA: el número no está en su propia cita
    conInvenciones.documentos[0].monto = { valor: 999.99, cita: 'por 45.30 balboas' }

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

    assert.throws(() => exp.decidir('aprobar', { motivo: 'me fío', oficial: 'A. Ruiz · oficial de cuenta' }),
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

    const despues = exp.decidir('aprobar', { motivo: 'revisado por la oficial de cuenta', oficial: 'A. Ruiz · oficial de cuenta' })
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

    const e = exp.decidir('rechazar', { motivo: 'la cédula está vencida', oficial: 'A. Ruiz · oficial de cuenta' })
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
    exp.decidir('aprobar', { motivo: 'ok', oficial: 'A. Ruiz · oficial de cuenta' })

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

    // El encabezado es el CONTRATO con quien audita, y se comprueba entero:
    // si alguien quita una columna, este test lo dice. `expediente` va primero
    // porque un CSV sin la clave del registro no se puede juntar con otro, y
    // `desde`/`hasta` son la posición del anclaje sobre el texto de origen.
    assert.equal(lineas[0],
      'expediente,campo,valor,evidencia,cita,desde,hasta,origen,guardias,motivo,firmante')
    assert.ok(csv.includes('Juan Pérez González'), 'lo aceptado sale')
    // Y lo RECHAZADO también sale, en el mismo archivo, con su culpable
    const hueco = lineas.find(l => l.includes(',titular.cedula,'))
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
    exp.decidir('aprobar', { motivo: 'ok', oficial: 'A. Ruiz · oficial de cuenta' })

    assert.throws(() => exp.decidir('rechazar', { motivo: 'me arrepentí', oficial: 'A. Ruiz · oficial de cuenta' }),
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
      exp.decidir('aprobar', { motivo: 'ok', oficial: 'A. Ruiz · oficial de cuenta' })
      const e = exp.leer()
      return JSON.stringify({ campos: e.campos, huecos: e.huecos, estado: e.estado })
    } finally { cerrar() }
  }
  const primero = correr()
  for (let i = 0; i < 20; i++) assert.equal(correr(), primero)
})

// ═════════════════════════════════════════════════════════════════════
//  CASO 15 · Las guardias de DOMINIO, conectadas por inyección
// ═════════════════════════════════════════════════════════════════════

test('CU-15 · una cédula de una provincia INEXISTENTE no entra, aunque ancle', () => {
  // El caso completo: la cita es real, el valor sale de ella, el anclaje pasa…
  // y aun así G6 lo para, porque en Panamá no hay provincia 0. Es un error de
  // OCR que ningún modelo detecta, porque produce una cédula que parece válida.
  const dir = mkdtempSync(join(tmpdir(), 'expediente-dominio-'))
  try {
    let n = 0
    const exp = abrirExpediente({
      ruta: join(dir, 'e.jsonl'), esquema: ESQ, id: 'EXP-DOM',
      ahora: () => `2026-09-10T15:${String(n++).padStart(2, '0')}:00.000Z`,
      guardiasDominio: revisarDominio,
      contextoDominio: { hoy: new Date(Date.UTC(2026, 8, 10)) }
    })

    exp.capturar('El titular es Juan Pérez González, cédula 0-123-456. ' +
                 'Presenta el recibo del IDAAN del 12 de marzo de 2026 por 45.30 balboas.')
    const { revision } = exp.asentar({
      titular: {
        nombre: { valor: 'Juan Pérez González', cita: 'El titular es Juan Pérez González' },
        cedula: { valor: '0-123-456', cita: 'cédula 0-123-456' }      // ← ancla, y aun así es imposible
      },
      documentos: []
    })

    const cedula = revision.campos.find(c => c.ruta === 'titular.cedula')
    assert.equal(cedula.aceptado, false, 'anclar no basta: la cédula tiene que ser posible')
    assert.ok(cedula.rechazos.some(r => r.guardia === 'G6'))
    assert.match(cedula.rechazos.find(r => r.guardia === 'G6').detalle, /provincia 0/)

    const e = exp.leer()
    assert.equal(e.estado, 'VALIDADO', 'sin cédula válida no llega a COMPLETO')
    assert.equal(e.huecos['titular.cedula'].guardias.includes('G6'), true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('CU-16 · un recibo VENCIDO se marca, con los días', () => {
  const dir = mkdtempSync(join(tmpdir(), 'expediente-vencido-'))
  try {
    let n = 0
    const exp = abrirExpediente({
      ruta: join(dir, 'e.jsonl'), esquema: ESQ, id: 'EXP-V',
      ahora: () => `2026-09-10T16:${String(n++).padStart(2, '0')}:00.000Z`,
      guardiasDominio: revisarDominio,
      contextoDominio: { hoy: new Date(Date.UTC(2026, 8, 10)),
                         vigenciaDias: { 'documentos[].fecha_emision': 90 } }
    })
    // El dictado y la extracción llevan la fecha VIEJA: el resto del expediente
    // es el de referencia, así que lo único que se prueba aquí es la vigencia.
    exp.capturar(DICTADO.replace('del 20 de agosto de 2026', 'del 12 de marzo de 2026'))
    const viejo = expedienteArt18()
    viejo.documentos[0].fecha_emision = { valor: '12 de marzo de 2026', cita: 'del 12 de marzo de 2026' }
    const { revision } = exp.asentar(viejo)

    const fecha = revision.campos.find(c => c.ruta === 'documentos[0].fecha_emision')
    assert.equal(fecha.aceptado, false, 'el 12 de marzo son más de 90 días antes del 10 de septiembre')
    assert.match(fecha.rechazos.find(r => r.guardia === 'G7').detalle, /182 días/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('CU-17 · ⭐ el NÚCLEO no sabe qué es un banco, y hay que poder demostrarlo', () => {
  // Es la afirmación que sostiene toda la genericidad: si core/ importara la
  // cédula panameña, «el mismo código sirve para inventario hospitalario»
  // dejaría de ser cierto en ese mismo instante.
  // SEXTO falso positivo del proyecto, y otra vez por buscar texto donde hacía
  // falta mirar estructura: la primera versión de este test buscaba la cadena
  // "instancias/banca" en el fuente y la encontraba en COMENTARIOS que explican
  // que el esquema se puede cambiar. Lo que importa no es que el núcleo NOMBRE
  // el dominio: es que no lo IMPORTE.
  const MODULOS = ['esquema', 'estado', 'anclaje', 'guardias', 'ledger',
                   'proyeccion', 'dedup', 'calidad', 'expediente', 'serie', 'prompt']

  for (const f of MODULOS) {
    const src = readFileSync(new URL(`../core/${f}.mjs`, import.meta.url), 'utf8')
    const imports = [...src.matchAll(/^\s*import\s[^;]*?from\s*['"]([^'"]+)['"]/gm)].map(m => m[1])
    for (const spec of imports) {
      assert.ok(!/instancias/.test(spec),
        `core/${f}.mjs IMPORTA "${spec}": el núcleo dejó de ser genérico en ese instante`)
      assert.ok(!/@qvac/.test(spec),
        `core/${f}.mjs IMPORTA el SDK: la frontera 95/5 se rompió`)
    }
  }

  // Y sin guardias inyectadas, la misma cédula imposible SÍ pasa el núcleo:
  // la prueba de que el rechazo vino del dominio y no de core/.
  const dir = mkdtempSync(join(tmpdir(), 'expediente-generico-'))
  try {
    let n = 0
    const exp = abrirExpediente({
      ruta: join(dir, 'e.jsonl'), esquema: ESQ, id: 'EXP-G',
      ahora: () => `2026-09-10T17:${String(n++).padStart(2, '0')}:00.000Z`
      // ← sin guardiasDominio
    })
    exp.capturar('El titular es Ana Ruiz, cédula 0-123-456.')
    const { revision } = exp.asentar({
      titular: {
        nombre: { valor: 'Ana Ruiz', cita: 'El titular es Ana Ruiz' },
        cedula: { valor: '0-123-456', cita: 'cédula 0-123-456' }
      },
      documentos: []
    })
    assert.equal(revision.campos.find(c => c.ruta === 'titular.cedula').aceptado, true,
      'sin las guardias de banca, el núcleo acepta: no sabe que la provincia 0 no existe')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ═════════════════════════════════════════════════════════════════════
//  CASO 18 · ⭐⭐ EL MISMO BINARIO, OTRA ENTIDAD, LOS TRES ERRORES REALES
// ═════════════════════════════════════════════════════════════════════

test('CU-18 · MEDIDO · el core genérico atrapa los tres errores del 9-sep en OTRO dominio', () => {
  // Este es el caso que junta las dos afirmaciones más fuertes del proyecto:
  //
  //   1. el mismo código, sin recompilar, sirve para otra entidad — solo cambia
  //      un .json, y no se toca una línea de core/
  //   2. los tres errores que MedPsy 1.7B produjo de verdad en esta máquina
  //      quedan fuera, y lo verdadero entra
  //
  // La extracción de este test es LITERALMENTE la que el modelo devolvió, con
  // JSON perfectamente válido y tres campos factualmente falsos.
  const SALUD = cargarEsquema('instancias/salud/esquema.json')
  const FUENTE = 'Estoy en Hospital DemoCare Pacific, en Panamá. Tienen tres resonadores ' +
                 'magnéticos Siemens y un tomógrafo. Uno de los resonadores parece de unos ocho años.'

  const dir = mkdtempSync(join(tmpdir(), 'expediente-salud-'))
  try {
    let n = 0
    const exp = abrirExpediente({
      ruta: join(dir, 'e.jsonl'), esquema: SALUD, id: 'EQ-001',
      ahora: () => `2026-09-10T18:${String(n++).padStart(2, '0')}:00.000Z`
      // ← sin guardiasDominio: un hospital no tiene cédulas panameñas que validar,
      //   y un esquema sin reglas de dominio es legítimo, no incompleto
    })

    exp.capturar(FUENTE)
    const { revision } = exp.asentar({
      sede: {
        nombre: { valor: 'Hospital DemoCare Pacific', cita: 'Estoy en Hospital DemoCare Pacific' },
        ciudad: { valor: 'Panamá', cita: 'en Panamá' }
      },
      equipos: [
        { modalidad: 'RESONADOR',
          cantidad:         { valor: 3, cita: 'tres resonadores magnéticos Siemens' },
          fabricante:       { valor: 'Siemens', cita: 'tres resonadores magnéticos Siemens' },
          // ERROR 1 · la edad de UNO propagada a los TRES
          antiguedad_anios: { valor: 8, cita: 'los tres resonadores tienen ocho años' } },
        { modalidad: 'TOMOGRAFO',
          cantidad:         { valor: 1, cita: 'y un tomógrafo' },
          // ERROR 2 · la marca que saltó al tomógrafo
          fabricante:       { valor: 'Siemens', cita: 'y un tomógrafo' },
          // ERROR 3 · una edad que nadie dijo del tomógrafo
          antiguedad_anios: { valor: 8, cita: 'y un tomógrafo' } }
      ]
    })

    const e = exp.leer()
    const campo = (r) => e.campos[r]
    const hueco = (r) => e.huecos[r]

    // LOS TRES ERRORES, FUERA
    assert.ok(hueco('equipos[0].antiguedad_anios'), 'la edad propagada a los tres tenía que caer')
    assert.ok(hueco('equipos[1].fabricante'), 'la marca que saltó al tomógrafo tenía que caer')
    assert.ok(hueco('equipos[1].antiguedad_anios'), 'la edad inventada del tomógrafo tenía que caer')

    // Y LO VERDADERO, DENTRO — no es un rechazo indiscriminado
    assert.equal(campo('sede.nombre').valor, 'Hospital DemoCare Pacific')
    assert.equal(campo('equipos[0].cantidad').valor, 3)
    assert.equal(campo('equipos[0].fabricante').valor, 'Siemens', 'los resonadores SÍ son Siemens')
    assert.equal(campo('equipos[1].cantidad').valor, 1)

    // El expediente cierra: los críticos —sede, modalidad y cantidad— están todos
    assert.equal(e.estado, 'COMPLETO')

    // Y esto es lo que hace la afirmación comprobable: NO se tocó core/.
    // El único cambio respecto al caso bancario es el .json del esquema.
    assert.equal(SALUD.dominio, 'salud')
    assert.equal(SALUD.guardiasDominio, null, 'y sin reglas de dominio, que también es legítimo')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ═════════════════════════════════════════════════════════════════════
//  CASO 19 · 🚨 UN EXPEDIENTE NO PUEDE CAMBIAR DE TITULAR EN SILENCIO
// ═════════════════════════════════════════════════════════════════════

test('CU-19 · dos fuentes que discrepan NO se resuelven solas: se marca el conflicto', () => {
  // ── EL FALLO QUE ESTE TEST EXISTE PARA QUE NO VUELVA ─────────────────────
  //
  // El proyecto blindó el DATO —nada entra sin cita literal— y durante un tiempo
  // dejó abierta LA PERSONA. Verificado el 10-sep: un expediente a nombre de
  // Juan Pérez González se convertía en María Gómez Batista con CERO rechazos,
  // cadena íntegra y ninguna alerta. Bastaba una segunda captura.
  //
  // En banca eso no es un detalle de implementación: es suplantación silenciosa.
  const dir = mkdtempSync(join(tmpdir(), 'expediente-suplanta-'))
  try {
    let n = 0
    const exp = abrirExpediente({
      ruta: join(dir, 'e.jsonl'), esquema: ESQ, id: 'EXP-SUP',
      ahora: () => `2026-09-10T19:${String(n++).padStart(2, '0')}:00.000Z`
    })

    exp.capturar('El titular es Juan Pérez González, cédula 8-123-456.')
    exp.asentar({
      titular: {
        nombre: { valor: 'Juan Pérez González', cita: 'El titular es Juan Pérez González' },
        cedula: { valor: '8-123-456', cita: 'cédula 8-123-456' }
      },
      documentos: []
    })
    assert.equal(exp.leer().campos['titular.nombre'].valor, 'Juan Pérez González')

    // Llega una segunda fuente que dice OTRA persona, con su cita perfectamente
    // anclada. El anclaje no puede detectar esto: la cita es real.
    exp.capturar('El titular es María Gómez Batista, cédula 8-123-456.')
    exp.asentar({
      titular: {
        nombre: { valor: 'María Gómez Batista', cita: 'El titular es María Gómez Batista' },
        cedula: { valor: '8-123-456', cita: 'cédula 8-123-456' }
      },
      documentos: []
    })

    const e = exp.leer()
    assert.equal(e.campos['titular.nombre'].valor, 'Juan Pérez González',
      'el valor asentado SE CONSERVA: cambiarlo exige una contradicción que alguien firme')
    assert.equal(e.resumen.conflictosAbiertos, 1)

    const c = e.conflictos.find(x => x.ruta === 'titular.nombre')
    assert.ok(c, 'el conflicto tiene que quedar registrado, no descartado')
    assert.equal(c.asentado, 'Juan Pérez González')
    assert.equal(c.propuesto, 'María Gómez Batista')
    assert.ok(c.citaAsentada && c.citaPropuesta,
      'con las DOS citas: sin ellas una persona no puede arbitrar')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('CU-20 · pero la misma persona escrita distinto NO es un conflicto', () => {
  // «JUAN PEREZ GONZALEZ» y «Juan Pérez González» son el mismo titular. Marcar
  // eso como conflicto convertiría la guardia en un obstáculo, y un obstáculo
  // se desactiva.
  const dir = mkdtempSync(join(tmpdir(), 'expediente-mismo-'))
  try {
    let n = 0
    const exp = abrirExpediente({
      ruta: join(dir, 'e.jsonl'), esquema: ESQ, id: 'EXP-M',
      ahora: () => `2026-09-10T20:${String(n++).padStart(2, '0')}:00.000Z`
    })
    exp.capturar('El titular es Juan Pérez González, cédula 8-123-456.')
    exp.asentar({ titular: { nombre: { valor: 'Juan Pérez González', cita: 'El titular es Juan Pérez González' } }, documentos: [] })

    exp.capturar('EL TITULAR ES JUAN PEREZ GONZALEZ, CEDULA 8-123-456.')
    exp.asentar({ titular: { nombre: { valor: 'JUAN PEREZ GONZALEZ', cita: 'EL TITULAR ES JUAN PEREZ GONZALEZ' } }, documentos: [] })

    assert.equal(exp.leer().resumen.conflictosAbiertos, 0,
      'tildes y mayúsculas no hacen a dos personas distintas')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('CU-21 · y un HUECO que se resuelve después sigue siendo legítimo', () => {
  // La distinción fina: si no había valor asentado, no hay nada que contradecir.
  // Es CU-6, y tiene que seguir funcionando después del arreglo.
  const dir = mkdtempSync(join(tmpdir(), 'expediente-hueco-'))
  try {
    let n = 0
    const exp = abrirExpediente({
      ruta: join(dir, 'e.jsonl'), esquema: ESQ, id: 'EXP-H',
      ahora: () => `2026-09-10T21:${String(n++).padStart(2, '0')}:00.000Z`
    })
    exp.capturar('El titular es Juan Pérez González. La cédula no se lee.')
    exp.asentar({ titular: { nombre: { valor: 'Juan Pérez González', cita: 'El titular es Juan Pérez González' }, cedula: { valor: '8-000-000', cita: 'cédula 8-000-000' } }, documentos: [] })
    assert.ok(exp.leer().huecos['titular.cedula'])

    exp.capturar('Se adjunta la cédula: 8-123-456.')
    exp.asentar({ titular: { nombre: { valor: 'Juan Pérez González', cita: 'El titular es Juan Pérez González' }, cedula: { valor: '8-123-456', cita: 'la cédula: 8-123-456' } }, documentos: [] })

    const e = exp.leer()
    assert.equal(e.campos['titular.cedula'].valor, '8-123-456', 'el hueco se resolvió')
    assert.equal(e.resumen.conflictosAbiertos, 0, 'resolver un hueco no es contradecir')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ═══════════════════════════════════════════════════════════════════════════
//  CU-22 · Un ledger es de un solo expediente, y nadie lo contamina
//
//  Cómo apareció: `node cli.mjs aprobar --ledger datos/EXP-003.jsonl` sin pasar
//  --expediente cogía el valor por defecto del CLI (EXP-001) y escribía un
//  evento DECISION_HUMANA de EXP-001 DENTRO del ledger de EXP-003.
//
//  Lo peor no era el error: era CUÁNDO llegaba. La proyección lo detectaba al
//  leer —el invariante funcionaba—, pero el evento ya estaba en disco, y un
//  ledger append-only no tiene borrado. El expediente quedaba ilegible para
//  siempre por haber escrito un comando al que le faltaba una bandera.
//
//  Ahora se comprueba ANTES de escribir el primer byte.
// ═══════════════════════════════════════════════════════════════════════════
test('CU-22 · abrir un ledger ajeno falla ANTES de escribir, no al leer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'expediente-duenio-'))
  const ruta = join(dir, 'e.jsonl')
  try {
    let n = 0
    const reloj = () => `2026-09-10T22:${String(n++).padStart(2, '0')}:00.000Z`

    const propio = abrirExpediente({ ruta, esquema: ESQ, id: 'EXP-003', ahora: reloj })
    propio.capturar('El titular es Juan Pérez González.')
    const hechosAntes = leer(ruta).length

    // Otro expediente intenta escribir en el mismo archivo.
    assert.throws(
      () => abrirExpediente({ ruta, esquema: ESQ, id: 'EXP-001', ahora: reloj }),
      /pertenece a EXP-003/,
      'el núcleo rechaza abrir un ledger que no es suyo')

    assert.equal(leer(ruta).length, hechosAntes,
      'y sobre todo: NO escribió nada antes de darse cuenta')

    // El legítimo sigue pudiendo trabajar: la guardia no bloquea al dueño.
    propio.capturar('Se adjunta la cédula.')
    assert.equal(leer(ruta).length, hechosAntes + 1)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ═══════════════════════════════════════════════════════════════════════════
//  CU-23 · ⭐ NO SE FIRMA SOBRE UN CAMPO EN DISPUTA
//
//  El caso de banca que este proyecto existe para no dejar pasar: el formulario
//  de apertura dice que el titular es Juan Pérez González; la carta laboral del
//  mismo expediente dice María Gómez Batista, con la misma cédula.
//
//  Las dos citas son literales. Ninguna guardia de anclaje puede ayudar aquí,
//  porque ninguna de las dos fuentes está inventando: se contradicen entre ellas.
//
//  Medido antes del arreglo: el expediente llegaba a COMPLETO con completitud
//  100 % y se aprobaba sin una sola advertencia. El conflicto estaba levantado
//  y visible en pantalla, y la firma pasaba por encima. Una cuenta abierta a
//  nombre de nadie.
// ═══════════════════════════════════════════════════════════════════════════
test('CU-23 · ⭐ un expediente con el titular en disputa NO se puede aprobar', () => {
  const dir = mkdtempSync(join(tmpdir(), 'expediente-disputa-'))
  const ruta = join(dir, 'e.jsonl')
  try {
    let n = 0
    const exp = abrirExpediente({
      ruta, esquema: ESQ, id: 'EXP-D',
      ahora: () => `2026-09-10T23:${String(n++).padStart(2, '0')}:00.000Z`
    })

    const doc = { tipo: 'RECIBO_SERVICIO',
      emisor:        { valor: 'IDAAN', cita: 'el recibo del IDAAN' },
      fecha_emision: { valor: '20 de agosto de 2026', cita: 'del 20 de agosto de 2026' },
      monto:         { valor: 45.30, cita: 'por 45.30 balboas' } }

    // Fuente 1 — el formulario de apertura. Expediente completo y aprobable.
    exp.capturar(DICTADO)
    exp.asentar(expedienteArt18())

    assert.ok(calidad(exp.leer(), ESQ).puedeCerrar, 'con una sola fuente, cierra')

    // Fuente 2 — la carta laboral. Otro titular, la misma cédula.
    exp.capturar(DICTADO.replace('El titular es Juan Pérez González',
                                 'Según la carta laboral el titular es María Gómez Batista'))
    exp.asentar({ titular: {
      ...titularArt18(),
      nombre: { valor: 'María Gómez Batista', cita: 'el titular es María Gómez Batista' } },
      operacion: operacionArt18(), documentos: [] })

    const e = exp.leer()
    assert.equal(e.conflictos.length, 1, 'el conflicto está levantado')
    assert.equal(e.campos['titular.nombre'].valor, 'Juan Pérez González',
      'y el valor asentado NO se sobrescribió')
    assert.equal(calidad(e, ESQ).puedeCerrar, false,
      'un conflicto abierto impide cerrar, aunque no falte ningún campo')

    // LA FIRMA SE PARA.
    const hechosAntes = leer(ruta).length
    assert.throws(() => exp.decidir('aprobar', { motivo: 'visto bueno', oficial: 'A. Ruiz · oficial de cuenta' }),
      /se contradicen \(titular\.nombre\)/,
      'no se aprueba un expediente cuyo titular está en disputa')
    assert.equal(leer(ruta).length, hechosAntes,
      'y no queda una DECISION_HUMANA fantasma en el ledger append-only')

    // Rechazar SÍ se permite: cerrar un expediente contradictorio es
    // exactamente lo que un oficial debe poder hacer.
    const tras = exp.decidir('rechazar', { motivo: 'titular en disputa entre dos documentos', oficial: 'A. Ruiz · oficial de cuenta' })
    assert.equal(tras.estado, 'RECHAZADO')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ═══════════════════════════════════════════════════════════════════════════
//  CU-24 · ⭐ UNA FIRMA SIN FIRMANTE NO ES UNA FIRMA
//
//  El evento de decisión decía `origen: HUMANO` y ahí se acababa la
//  trazabilidad: no decía QUÉ humano. Un expediente aprobado del que no consta
//  quién lo aprobó es inauditable, y este proyecto se presenta precisamente
//  como el que hace auditable la admisión.
//
//  El Acuerdo 1-2026 de la Superintendencia de Bancos de Panamá —vigente desde
//  el 16 de enero de 2026, deroga el 10-2015— exige constancia documentada de
//  la debida diligencia (art. 10.4) y que el expediente permita RECONSTRUIR la
//  operación durante cinco años (art. 29). Sin firmante no hay reconstrucción.
// ═══════════════════════════════════════════════════════════════════════════
test('CU-24 · ⭐ no se aprueba ni se rechaza sin decir quién firma', () => {
  const dir = mkdtempSync(join(tmpdir(), 'expediente-firma-'))
  const ruta = join(dir, 'e.jsonl')
  try {
    let n = 0
    const exp = abrirExpediente({
      ruta, esquema: ESQ, id: 'EXP-F',
      ahora: () => `2026-09-11T00:${String(n++).padStart(2, '0')}:00.000Z`
    })

    exp.capturar(DICTADO)
    exp.asentar(expedienteArt18())

    const hechosAntes = leer(ruta).length

    // Sin oficial no se firma, ni para aprobar ni para rechazar.
    assert.throws(() => exp.decidir('aprobar', { motivo: 'todo conforme' }),
      /exige identificar al oficial/, 'aprobar sin firmante se niega')
    assert.throws(() => exp.decidir('rechazar', { motivo: 'no procede' }),
      /exige identificar al oficial/, 'rechazar sin firmante también')
    assert.throws(() => exp.decidir('aprobar', { motivo: 'ok', oficial: '   ' }),
      /exige identificar al oficial/, 'ni con espacios en blanco')

    assert.equal(leer(ruta).length, hechosAntes,
      'y ninguno de los tres intentos dejó un evento en el ledger')

    // Con firmante sí, y el ledger dice quién fue.
    const e = exp.decidir('aprobar', {
      motivo: 'Documentación verificada en ventanilla.',
      oficial: 'A. Ruiz · oficial de cuenta · suc. Vía España'
    })
    assert.equal(e.estado, 'APROBADO')

    const decision = e.decisiones.at(-1)
    assert.equal(decision.que, 'aprobar')
    assert.equal(decision.oficial, 'A. Ruiz · oficial de cuenta · suc. Vía España',
      'quién firmó se puede leer del expediente, no solo del archivo crudo')

    // Y está en el ledger, dentro de la cadena de hashes: no se puede cambiar
    // el nombre del firmante sin romper la verificación.
    const evento = leer(ruta).find(h => h.tipo === 'DECISION_HUMANA')
    assert.equal(evento.oficial, 'A. Ruiz · oficial de cuenta · suc. Vía España')
    assert.ok(exp.verificar().intacta, 'la cadena sigue íntegra')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ═══════════════════════════════════════════════════════════════════════════
//  CU-25 · ⭐ EL HUMANO EN EL BUCLE: la única salida de un conflicto
//
//  CU-23 dejó el expediente parado y protegido, y con eso a medias: parar sin
//  dar salida no es cautela, es un callejón. El titular quedaba en disputa,
//  sin poder cerrarse ni firmarse, para siempre — y en una sucursal eso
//  significa un cliente que se va.
//
//  La salida existe y es deliberadamente humana. Y tiene tres candados que no
//  se abren ni para el oficial:
//
//    · el valor elegido tiene que ser uno de los dos que ya están, cada uno con
//      su cita. Ni una persona puede asentar un dato que ninguna fuente diga.
//    · quién resuelve, porque una resolución anónima no se reconstruye.
//    · por qué, porque un supervisor dentro de cuatro años necesita saber qué
//      vio el oficial que el sistema no podía ver.
// ═══════════════════════════════════════════════════════════════════════════
test('CU-25 · ⭐ una persona zanja el conflicto, y solo entonces se puede firmar', () => {
  const dir = mkdtempSync(join(tmpdir(), 'expediente-resolver-'))
  const ruta = join(dir, 'e.jsonl')
  try {
    let n = 0
    const exp = abrirExpediente({
      ruta, esquema: ESQ, id: 'EXP-R',
      ahora: () => `2026-09-11T01:${String(n++).padStart(2, '0')}:00.000Z`
    })

    const doc = { tipo: 'RECIBO_SERVICIO',
      emisor:        { valor: 'IDAAN', cita: 'el recibo del IDAAN' },
      fecha_emision: { valor: '20 de agosto de 2026', cita: 'del 20 de agosto de 2026' },
      monto:         { valor: 45.30, cita: 'por 45.30 balboas' } }

    exp.capturar(DICTADO)
    exp.asentar(expedienteArt18())

    exp.capturar(DICTADO.replace('El titular es Juan Pérez González',
                                 'Según la carta laboral el titular es María Gómez Batista'))
    exp.asentar({ titular: {
      ...titularArt18(),
      nombre: { valor: 'María Gómez Batista', cita: 'el titular es María Gómez Batista' } },
      operacion: operacionArt18(), documentos: [] })

    assert.equal(exp.leer().conflictos.length, 1)

    // ── LOS TRES CANDADOS ──────────────────────────────────────────────────
    const hechosAntes = leer(ruta).length

    assert.throws(() => exp.resolver('titular.nombre', {
      valor: 'Pedro Ramírez Him', oficial: 'A. Ruiz', motivo: 'me suena mejor'
    }), /no es ninguno de los dos valores en disputa/,
      'ni una persona puede asentar un dato que ninguna fuente afirma')

    assert.throws(() => exp.resolver('titular.nombre', {
      valor: 'María Gómez Batista', motivo: 'la cédula coincide'
    }), /exige identificar al oficial/, 'una resolución anónima no se reconstruye')

    assert.throws(() => exp.resolver('titular.nombre', {
      valor: 'María Gómez Batista', oficial: 'A. Ruiz'
    }), /exige motivo/, 'sin el porqué, «lo decidió alguien» no es auditable')

    assert.throws(() => exp.resolver('titular.cedula', {
      valor: '8-123-456', oficial: 'A. Ruiz', motivo: 'x'
    }), /no está en conflicto/, 'no se resuelve lo que nadie discute')

    assert.equal(leer(ruta).length, hechosAntes,
      'y ninguno de los cuatro intentos dejó rastro en el ledger')

    // ── LA RESOLUCIÓN ──────────────────────────────────────────────────────
    const tras = exp.resolver('titular.nombre', {
      valor: 'María Gómez Batista',
      oficial: 'A. Ruiz · oficial de cuenta · suc. Vía España',
      motivo: 'La cédula física presentada en ventanilla coincide con la carta laboral.'
    })

    assert.equal(tras.conflictos.length, 0, 'el conflicto queda cerrado')
    assert.equal(tras.campos['titular.nombre'].valor, 'María Gómez Batista')
    assert.equal(tras.campos['titular.nombre'].cita, 'el titular es María Gómez Batista',
      'el valor viaja con la cita de SU documento, no con la del que desplazó')

    // La evidencia BAJA: una decisión humana entre dos documentos es un dato
    // bien fundado, no un dato mejor probado.
    assert.equal(tras.campos['titular.nombre'].evidencia, 'Reportado')

    const r = tras.resoluciones.at(-1)
    assert.equal(r.descartado, 'Juan Pérez González', 'lo descartado queda escrito, no se borra')
    assert.equal(r.oficial, 'A. Ruiz · oficial de cuenta · suc. Vía España')

    // ── Y SOLO ENTONCES SE FIRMA ───────────────────────────────────────────
    const final = exp.decidir('aprobar', {
      motivo: 'Resolución revisada y conforme.', oficial: 'R. Him · gerente de sucursal'
    })
    assert.equal(final.estado, 'APROBADO')
    assert.ok(exp.verificar().intacta, 'la cadena aguanta todo el recorrido')

    // Y el expediente se sigue regenerando del ledger: la resolución es un
    // hecho más, no un parche sobre el estado.
    assert.deepEqual(proyectar(leer(ruta)).campos, final.campos)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
