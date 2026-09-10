// pruebas/guardias-banca.test.mjs — G6, G7, G8
//
// Las guardias que SÍ saben qué es un banco. Y una que NO existe, con su motivo.
//
// Corre sin modelo, sin red y sin el SDK.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  validarCedula, interpretarFecha, vigencia, cuadra,
  revisarDominio, GUARDIAS_BANCA, PROVINCIAS, PREFIJOS, RECHAZO_BANCA
} from '../instancias/banca/guardias.mjs'

// ═════════════════════════════════════════════════════════════════════
//  ⚠️ LO QUE NO SE IMPLEMENTÓ, Y POR QUÉ
// ═════════════════════════════════════════════════════════════════════

test('GB-00 · NO existe una guardia de "dígito verificador", y es deliberado', async () => {
  // El plan anunciaba una guardia de dígito verificador de la cédula panameña,
  // descrita como «aritmética pura» y pensada para anunciarse en cámara.
  //
  // Al ir a escribirla no había algoritmo ni fuente oficial: Panamá no publica
  // un dígito de control verificable en el número de cédula. Inventar una
  // aritmética creíble habría rechazado cédulas de personas reales, y se habría
  // anunciado ante un jurado panameño que sabe que eso no existe.
  //
  // Este test fija la decisión para que nadie la revierta sin leer el porqué.
  const mod = await import('../instancias/banca/guardias.mjs')
  for (const inventado of ['digitoVerificador', 'checkDigit', 'validarDigito', 'calcularDigito']) {
    assert.equal(mod[inventado], undefined,
      `existe "${inventado}": si apareció el algoritmo con fuente oficial, hay que decir de dónde salió`)
  }
  const src = readFileSync(new URL('../instancias/banca/guardias.mjs', import.meta.url), 'utf8')
  assert.match(src, /no publica un dígito de control/,
    'el archivo tiene que explicar por qué esa guardia no está')
})

// ═════════════════════════════════════════════════════════════════════
//  G6 · LA CÉDULA
// ═════════════════════════════════════════════════════════════════════

test('GB-G6-01 · las cédulas bien formadas pasan', () => {
  for (const c of ['8-123-456', '1-45-6789', '13-1-1', 'PE-123-456', 'E-88-999', 'N-12-345', '8-NT-1-234']) {
    const r = validarCedula(c)
    assert.equal(r.valida, true, `"${c}" debería ser válida: ${r.detalle ?? ''}`)
  }
})

test('GB-G6-02 · ⭐ una provincia que NO EXISTE se rechaza, y se dice cuál', () => {
  // El caso que atrapa errores de OCR de verdad: leer un 8 como un 0, o
  // un 1 como un 7, produce una provincia inexistente.
  for (const [c, n] of [['0-123-456', 0], ['14-123-456', 14], ['99-1-1', 99]]) {
    const r = validarCedula(c)
    assert.equal(r.valida, false)
    assert.equal(r.motivo, RECHAZO_BANCA.PROVINCIA_INEXISTENTE)
    assert.match(r.detalle, new RegExp(`provincia ${n}`),
      'decir CUÁL provincia no existe es lo que convierte el error en algo que se arregla')
  }
})

test('GB-G6-03 · un prefijo inventado se rechaza', () => {
  const r = validarCedula('XX-123-456')
  assert.equal(r.valida, false)
  assert.match(r.detalle, /no es un prefijo/)
  assert.match(r.detalle, /PE/, 'el error tiene que enumerar los que sí valen')
})

test('GB-G6-04 · lo que no tiene forma de cédula se rechaza', () => {
  for (const c of ['', '   ', 'abc', '12345678', '8', '8-1-2-3-4-5']) {
    assert.equal(validarCedula(c).valida, false, `"${c}" no puede pasar`)
  }
})

test('GB-G6-05 · la cédula válida dice de qué provincia es', () => {
  assert.equal(validarCedula('8-123-456').provincia, 'Panamá')
  assert.equal(validarCedula('4-1-1').provincia, 'Chiriquí')
  assert.equal(validarCedula('13-1-1').provincia, 'Panamá Oeste')
  assert.equal(validarCedula('PE-1-1').provincia, PREFIJOS.PE)
})

test('GB-G6-06 · las trece provincias están, y ni una más', () => {
  assert.equal(Object.keys(PROVINCIAS).length, 13)
  assert.equal(PROVINCIAS[10], 'Guna Yala')
  assert.equal(PROVINCIAS[12], 'Ngäbe-Buglé')
  assert.throws(() => { PROVINCIAS[14] = 'inventada' }, TypeError)
})

// ═════════════════════════════════════════════════════════════════════
//  G7 · LA VIGENCIA
// ═════════════════════════════════════════════════════════════════════

const HOY = new Date(Date.UTC(2026, 8, 10))    // 10-sep-2026

test('GB-G7-01 · entiende las fechas como las escribe la gente', () => {
  for (const t of ['12 de marzo de 2026', '12/03/2026', '12-03-2026', '2026-03-12']) {
    const f = interpretarFecha(t)
    assert.ok(f, `no entendió "${t}"`)
    assert.equal(f.getUTCFullYear(), 2026)
    assert.equal(f.getUTCMonth(), 2)
    assert.equal(f.getUTCDate(), 12)
  }
})

test('GB-G7-02 · una fecha que NO EXISTE no se interpreta', () => {
  // El 31 de febrero es un error de lectura, no una fecha rara.
  for (const t of ['31 de febrero de 2026', '31/02/2026', '2026-02-30', '45/13/2026']) {
    assert.equal(interpretarFecha(t), null, `"${t}" no debería interpretarse`)
  }
})

test('GB-G7-03 · lo que no se entiende NO se rechaza: se dice que no se entendió', () => {
  // Rechazar por no comprender convierte una guardia en un obstáculo.
  const r = vigencia('el mes pasado más o menos', { hoy: HOY })
  assert.equal(r.conocida, false)
  assert.match(r.detalle, /no se pudo interpretar/)
})

test('GB-G7-04 · un recibo reciente está vigente', () => {
  const r = vigencia('20 de agosto de 2026', { hoy: HOY })
  assert.equal(r.vigente, true)
  assert.equal(r.dias, 21)
})

test('GB-G7-05 · un recibo de hace más de 90 días está VENCIDO', () => {
  const r = vigencia('12 de marzo de 2026', { hoy: HOY })
  assert.equal(r.vigente, false)
  assert.equal(r.motivo, RECHAZO_BANCA.DOCUMENTO_VENCIDO)
  assert.match(r.detalle, /182 días/)
  assert.match(r.detalle, /máximo para admisión es 90/)
})

test('GB-G7-06 · una fecha en el FUTURO es un error, no un documento muy nuevo', () => {
  const r = vigencia('20 de diciembre de 2026', { hoy: HOY })
  assert.equal(r.vigente, false)
  assert.equal(r.motivo, RECHAZO_BANCA.FECHA_IMPOSIBLE)
  assert.match(r.detalle, /FUTURO/)
})

test('GB-G7-07 · vigencia EXIGE que se le pase `hoy`', () => {
  // Una guardia que llama a new Date() por su cuenta da un resultado distinto
  // mañana con los mismos datos, y entonces O5 deja de cumplirse sin que nadie
  // lo note hasta el día del jurado.
  assert.throws(() => vigencia('12 de marzo de 2026'), /la fecha se recibe, no se inventa/)
})

test('GB-G7-08 · el plazo es configurable, no una constante escondida', () => {
  assert.equal(vigencia('12 de marzo de 2026', { hoy: HOY, diasMaximos: 365 }).vigente, true)
  assert.equal(vigencia('12 de marzo de 2026', { hoy: HOY, diasMaximos: 30 }).vigente, false)
})

// ═════════════════════════════════════════════════════════════════════
//  G8 · LA ARITMÉTICA
// ═════════════════════════════════════════════════════════════════════

test('GB-G8-01 · lo que cuadra, cuadra', () => {
  assert.equal(cuadra(1000, 12, 12000).cuadra, true)
  assert.equal(cuadra(1250.50, 2, 2501).cuadra, true)
})

test('GB-G8-02 · lo que NO cuadra se señala, con los dos números', () => {
  const r = cuadra(1000, 12, 15000)
  assert.equal(r.cuadra, false)
  assert.equal(r.motivo, RECHAZO_BANCA.ARITMETICA_INCOHERENTE)
  assert.match(r.detalle, /1000 × 12 = 12000/)
  assert.match(r.detalle, /dice 15000/,
    'enseñar los dos números es lo que permite a una persona decidir cuál es el bueno')
})

test('GB-G8-03 · se tolera el redondeo, porque los documentos reales redondean', () => {
  assert.equal(cuadra(1000, 12, 12100).cuadra, true, '0,8 % de desvío: es redondeo')
  assert.equal(cuadra(1000, 12, 13000).cuadra, false, '8 % ya no es redondeo')
})

test('GB-G8-04 · la tolerancia es un dato, no una constante escondida', () => {
  assert.equal(cuadra(1000, 12, 13000, { toleranciaRelativa: 0.10 }).cuadra, true)
})

test('GB-G8-05 · sin los tres números, no se comprueba nada', () => {
  for (const args of [[null, 12, 100], [1000, undefined, 100], [1000, 12, 'mucho']]) {
    assert.equal(cuadra(...args).comprobable, false)
  }
})

test('GB-G8-06 · G8 NO corrige: señala', async () => {
  // Corregir sería decidir cuál de los dos documentos miente, y eso es
  // exactamente lo que G9 dice que no se hace solo.
  const mod = await import('../instancias/banca/guardias.mjs')
  for (const prohibido of ['corregir', 'ajustar', 'reconciliar', 'fix']) {
    assert.equal(mod[prohibido], undefined)
  }
})

// ═════════════════════════════════════════════════════════════════════
//  La tabla y la aplicación
// ═════════════════════════════════════════════════════════════════════

test('GB-01 · la tabla de dominio es inmutable y cada guardia explica su porqué', () => {
  assert.throws(() => { GUARDIAS_BANCA.push({}) }, TypeError)
  for (const g of GUARDIAS_BANCA) {
    assert.match(g.id, /^G[6-8]$/)
    assert.ok(g.porque.length > 30, `${g.id} no explica por qué existe`)
  }
})

test('GB-02 · revisarDominio aplica G6 sobre la cédula y solo sobre ella', () => {
  const mala = revisarDominio({ ruta: 'titular.cedula', valor: '99-1-1' })
  assert.equal(mala.length, 1)
  assert.equal(mala[0].guardia, 'G6')

  const buena = revisarDominio({ ruta: 'titular.cedula', valor: '8-123-456' })
  assert.deepEqual([...buena], [])

  const otra = revisarDominio({ ruta: 'titular.nombre', valor: '99-1-1' })
  assert.deepEqual([...otra], [], 'un nombre no se valida como cédula')
})

test('GB-03 · G7 se calla si no se le da reloj, Y si el esquema no dice que caduque', () => {
  const campo = { ruta: 'documentos[0].fecha_emision', valor: '12 de marzo de 2020' }
  const PLAZOS = { vigenciaDias: { 'documentos[].fecha_emision': 90 } }

  assert.deepEqual([...revisarDominio(campo, PLAZOS)], [],
    'sin `hoy` inyectado, G7 no opina')

  // Y esta es la segunda mitad, que se añadió cuando el esquema creció al
  // artículo 18: G7 decidía por el NOMBRE del campo —cualquier ruta con la
  // palabra «fecha»—, así que `titular.fecha_nacimiento` salía rechazada como
  // DOCUMENTO VENCIDO. Una persona nacida en 1988 no está vencida.
  assert.deepEqual([...revisarDominio(campo, { hoy: HOY })], [],
    'sin plazo declarado en el esquema, G7 tampoco opina: lo que no se declara, no caduca')

  const con = revisarDominio(campo, { hoy: HOY, ...PLAZOS })
  assert.equal(con.length, 1)
  assert.equal(con[0].guardia, 'G7')

  // Un nacimiento nunca vence, y ahora es el esquema quien lo dice.
  assert.deepEqual(
    [...revisarDominio({ ruta: 'titular.fecha_nacimiento', valor: '14 de marzo de 1988' }, { hoy: HOY, ...PLAZOS })],
    [], 'una fecha de nacimiento no es un documento que caduque')
})

test('GB-04 · las guardias de dominio son deterministas', () => {
  const hacer = () => JSON.stringify(revisarDominio(
    { ruta: 'titular.cedula', valor: '0-1-1' }, { hoy: HOY }))
  const primero = hacer()
  for (let i = 0; i < 50; i++) assert.equal(hacer(), primero)
})
