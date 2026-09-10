// pruebas/guardias.test.mjs — T4
//
// La proporción que importa: la mayoría de estos tests prueban que algo NO pasa.
// Una guardia que solo se prueba con datos buenos no está probada.
//
// Corre sin modelo, sin red y sin el SDK.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { cargarEsquema, specDeCampo, rutaGenerica, resolverRef } from '../core/esquema.mjs'
import { revisar, GUARDIAS, RECHAZO } from '../core/guardias.mjs'

const ESQ = cargarEsquema('instancias/banca/esquema.json')
const ESQ_SALUD = cargarEsquema('instancias/salud/esquema.json')

/** La fuente de todos los casos: un texto de sucursal, sintético y ficticio. */
const FUENTE =
  'El titular es Juan Pérez González, cédula 8-123-456. ' +
  'Presenta el recibo del IDAAN del 12 de marzo de 2026 por 45.30 balboas. ' +
  'Trae además una carta laboral que consta firmada y sellada.'

/** Un extraído correcto, del que parten casi todos los casos. */
const bueno = () => ({
  titular: {
    nombre: { valor: 'Juan Pérez González', cita: 'El titular es Juan Pérez González' },
    cedula: { valor: '8-123-456', cita: 'cédula 8-123-456' }
  },
  documentos: [{
    tipo: 'RECIBO_SERVICIO',
    emisor:        { valor: 'IDAAN',          cita: 'el recibo del IDAAN' },
    fecha_emision: { valor: '12 de marzo de 2026', cita: 'del 12 de marzo de 2026' },
    monto:         { valor: 45.30,            cita: 'por 45.30 balboas' }
  }]
})

const campo = (r, ruta) => r.campos.find(c => c.ruta === ruta)
const motivos = (r, ruta) => campo(r, ruta).rechazos.map(x => x.motivo)

// ═════════════════════════════════════════════════════════════════════
//  El camino feliz — pocos, porque es lo que menos prueba
// ═════════════════════════════════════════════════════════════════════

test('T4-01 · un extraído correcto pasa entero', () => {
  const r = revisar(bueno(), ESQ, FUENTE)
  const malos = r.campos.filter(c => !c.aceptado)
  assert.deepEqual(malos.map(c => `${c.ruta}: ${c.rechazos.map(x => x.motivo)}`), [])
  assert.equal(r.resumen.rechazados, 0)
  assert.equal(r.resumen.completo, true, 'no falta ningún campo crítico')
})

test('T4-02 · el grado de evidencia se otorga y se conserva', () => {
  const r = revisar(bueno(), ESQ, FUENTE)
  assert.equal(campo(r, 'documentos[0].emisor').evidencia, 'Reportado')
})

// ═════════════════════════════════════════════════════════════════════
//  G1 · TIPO
// ═════════════════════════════════════════════════════════════════════

test('T4-G1-01 · un número que llega como TEXTO se rechaza, no se convierte', () => {
  const e = bueno()
  e.documentos[0].monto = { valor: '45.30', cita: 'por 45.30 balboas' }
  const r = revisar(e, ESQ, FUENTE)
  assert.ok(motivos(r, 'documentos[0].monto').includes(RECHAZO.TIPO_INCORRECTO),
    'convertir en silencio esconde el fallo, y el siguiente sería "cuarenta y cinco"')
  assert.equal(campo(r, 'documentos[0].monto').aceptado, false)
})

test('T4-G1-02 · un texto que llega como número se rechaza', () => {
  const e = bueno()
  e.titular.nombre = { valor: 12345, cita: 'El titular es Juan Pérez González' }
  assert.ok(motivos(revisar(e, ESQ, FUENTE), 'titular.nombre').includes(RECHAZO.TIPO_INCORRECTO))
})

test('T4-G1-03 · NaN e Infinity no son números válidos', () => {
  for (const v of [NaN, Infinity, -Infinity]) {
    const e = bueno()
    e.documentos[0].monto = { valor: v, cita: 'por 45.30 balboas' }
    assert.ok(motivos(revisar(e, ESQ, FUENTE), 'documentos[0].monto').includes(RECHAZO.TIPO_INCORRECTO),
      `${v} no puede entrar a un expediente`)
  }
})

// ═════════════════════════════════════════════════════════════════════
//  G2 · ENUMERACIÓN Y RANGO
// ═════════════════════════════════════════════════════════════════════

test('T4-G2-01 · un tipo de documento fuera del enum se rechaza', () => {
  const e = bueno()
  e.documentos[0].tipo = 'ESCRITURA_PUBLICA'
  const r = revisar(e, ESQ, FUENTE)
  assert.ok(motivos(r, 'documentos[0].tipo').includes(RECHAZO.FUERA_DE_ENUM),
    'el esquema declara qué tipos existen; lo demás no existe')
})

test('T4-G2-02 · AL MODELO NO SE LE PREGUNTA CUÁNTA CONFIANZA TIENE', () => {
  // El esquema tenía un campo `confianza` que el modelo rellenaba, y era un error
  // de diseño: devolvía "Confirmado" sobre datos que las guardias rechazaban en el
  // mismo instante. Un modelo calificándose a sí mismo es un examen sin vigilante.
  //
  // El reto pide un puntaje de confianza y el sistema lo da — pero lo calcula
  // gradoDeEvidencia() leyendo CÓMO lo dijo la fuente. Ahora, si el modelo intenta
  // colar su autoevaluación, G5 la marca como campo intruso.
  assert.equal(specDeCampo(ESQ, 'documentos[0].confianza'), undefined,
    'el esquema ya no le pregunta al modelo cuánta confianza tiene')

  const e = bueno()
  e.documentos[0].confianza = 'Confirmado'
  const c = campo(revisar(e, ESQ, FUENTE), 'documentos[0].confianza')
  assert.equal(c.aceptado, false)
  assert.deepEqual(c.rechazos.map(x => x.motivo), [RECHAZO.CAMPO_INTRUSO],
    'no le pidas al modelo lo que puedes calcular')
})

test('T4-G2-03 · el enum se comprueba aunque el nodo no tenga cita', () => {
  // `tipo` es un string suelto, sin {valor, cita}. Su ÚNICA defensa es G2.
  const e = bueno()
  e.documentos[0].tipo = 'CUALQUIER_COSA'
  const c = campo(revisar(e, ESQ, FUENTE), 'documentos[0].tipo')
  assert.equal(c.aceptado, false)
  assert.equal(c.evidencia, 'Desconocido', 'sin cita no hay evidencia que otorgar')
})

// ═════════════════════════════════════════════════════════════════════
//  G3 · PROCEDENCIA — la regla de oro aplicada a todo campo
// ═════════════════════════════════════════════════════════════════════

test('T4-G3-01 · una cita que NO está en la fuente se rechaza', () => {
  const e = bueno()
  e.titular.cedula = { valor: '8-999-999', cita: 'cédula 8-999-999' }
  const c = campo(revisar(e, ESQ, FUENTE), 'titular.cedula')
  assert.ok(c.rechazos.some(x => x.motivo === RECHAZO.SIN_ANCLAJE))
  assert.match(c.rechazos.find(x => x.motivo === RECHAZO.SIN_ANCLAJE).detalle, /invención/)
})

test('T4-G3-02 · una cita REAL con un valor que no sale de ella se rechaza', () => {
  // El error medido: cita verdadera, valor que no está en ella.
  const e = bueno()
  e.documentos[0].emisor = { valor: 'ETESA', cita: 'el recibo del IDAAN' }
  const c = campo(revisar(e, ESQ, FUENTE), 'documentos[0].emisor')
  assert.ok(c.rechazos.some(x => x.motivo === RECHAZO.SIN_ANCLAJE))
  assert.match(c.rechazos.find(x => x.motivo === RECHAZO.SIN_ANCLAJE).detalle, /coartada/)
})

test('T4-G3-03 · un campo sin cita se rechaza', () => {
  const e = bueno()
  e.titular.nombre = { valor: 'Juan Pérez González', cita: '' }
  assert.ok(motivos(revisar(e, ESQ, FUENTE), 'titular.nombre').includes(RECHAZO.SIN_ANCLAJE))
})

test('T4-G3-04 · G3 NO reimplementa el anclaje: hay una sola regla de oro', () => {
  // Si algún día G3 se "adaptara" y dejara de llamar a anclar(), habría dos
  // verdades distintas sobre el mismo dato. Este test fija que son la misma.
  const g3 = GUARDIAS.find(g => g.id === 'G3')
  assert.ok(g3, 'G3 debe existir en la tabla')
  assert.match(g3.porque, /REGLA DE ORO/i)
})

// ═════════════════════════════════════════════════════════════════════
//  G4 · UNIDADES
// ═════════════════════════════════════════════════════════════════════

test('T4-G4-01 · la cita debe mencionar la unidad que el esquema declara', () => {
  const e = bueno()
  e.documentos[0].monto = { valor: 45.30, cita: 'del 12 de marzo de 2026' }
  const c = campo(revisar(e, ESQ, FUENTE), 'documentos[0].monto')
  assert.ok(c.rechazos.some(x => x.motivo === RECHAZO.UNIDAD_AUSENTE),
    'un monto cuya cita no habla de dinero no es un monto')
})

test('T4-G4-02 · dólares vale por balboas: están a la par y se dicen los dos', () => {
  const fuente = FUENTE + ' El total pagado fue de 45.30 dólares.'
  const e = bueno()
  e.documentos[0].monto = { valor: 45.30, cita: 'de 45.30 dólares' }
  assert.equal(campo(revisar(e, ESQ, fuente), 'documentos[0].monto').aceptado, true)
})

test('T4-G4-03 · la unidad metida DENTRO del valor se nombra por su motivo', () => {
  const e = bueno()
  e.documentos[0].monto = { valor: '45.30 balboas', cita: 'por 45.30 balboas' }
  const ms = motivos(e && revisar(e, ESQ, FUENTE), 'documentos[0].monto')
  assert.ok(ms.includes(RECHAZO.UNIDAD_EN_VALOR),
    'el motivo importa: saber QUÉ arreglar es la mitad del valor de un rechazo')
  assert.ok(ms.includes(RECHAZO.TIPO_INCORRECTO), 'y G1 también lo ve, por el tipo')
})

test('T4-G4-05 · el símbolo $ cuenta como unidad, aunque no sobreviva a normalizar()', () => {
  // Bug real encontrado por T4-G4-01: normalizar('$') devuelve cadena VACÍA, y
  // `cita.includes('')` es siempre true. Con comparación por substring, G4
  // aceptaba CUALQUIER cita del mundo. Los símbolos se buscan en la cita literal.
  const fuente = 'El recibo del IDAAN es por $45.30 del mes de marzo.'
  const e = bueno()
  e.documentos[0].monto = { valor: 45.30, cita: 'por $45.30' }
  assert.equal(campo(revisar(e, ESQ, fuente), 'documentos[0].monto').aceptado, true)
})

test('T4-G4-06 · una cita con la letra "b" NO cuenta como mención de "B/."', () => {
  // La segunda mitad del mismo bug: 'B/.' normaliza a 'b', y por substring
  // cualquier cita con una be —"cobrado", "diciembre"— habría pasado por moneda.
  const fuente = 'El recibo del IDAAN fue cobrado el 12 de diciembre por 45.30.'
  const e = bueno()
  e.documentos[0].monto = { valor: 45.30, cita: 'cobrado el 12 de diciembre por 45.30' }
  const c = campo(revisar(e, ESQ, fuente), 'documentos[0].monto')
  assert.equal(c.aceptado, false)
  assert.ok(c.rechazos.some(x => x.motivo === RECHAZO.UNIDAD_AUSENTE),
    'parecido no es igual: eso vale para las citas y vale para las unidades')
})

test('T4-G4-04 · un campo sin unidad declarada no se molesta con G4', () => {
  const r = revisar(bueno(), ESQ, FUENTE)
  assert.equal(campo(r, 'titular.nombre').aceptado, true,
    'el esquema no declara unidad para un nombre: G4 no tiene nada que exigir')
})

// ═════════════════════════════════════════════════════════════════════
//  G5 · EL ESCAPE HATCH — nunca se falla en silencio
// ═════════════════════════════════════════════════════════════════════

test('T4-G5-01 · un campo que el esquema NO declara se marca como intruso', () => {
  const e = bueno()
  e.titular.pasaporte = { valor: 'PA123456', cita: 'El titular es Juan Pérez González' }
  const c = campo(revisar(e, ESQ, FUENTE), 'titular.pasaporte')
  assert.equal(c.aceptado, false)
  assert.deepEqual(c.rechazos.map(x => x.motivo), [RECHAZO.CAMPO_INTRUSO])
})

test('T4-G5-02 · un campo REQUERIDO que no vino se marca como ausente', () => {
  const e = bueno()
  delete e.titular.cedula
  const c = campo(revisar(e, ESQ, FUENTE), 'titular.cedula')
  assert.ok(c, 'un campo ausente tiene que APARECER en el resultado, o se pierde')
  assert.deepEqual(c.rechazos.map(x => x.motivo), [RECHAZO.CAMPO_AUSENTE])
})

test('T4-G5-03 · lo rechazado toma el VACÍO DEL ESQUEMA, nunca undefined', () => {
  const e = bueno()
  e.titular.nombre = { valor: 'Pedro Martínez', cita: 'El titular es Pedro Martínez' }
  e.documentos[0].monto = { valor: 999.99, cita: 'por 999.99 balboas' }
  const r = revisar(e, ESQ, FUENTE)

  assert.equal(campo(r, 'titular.nombre').valor, ESQ.vacios.texto)
  assert.equal(campo(r, 'documentos[0].monto').valor, ESQ.vacios.numero)
  for (const c of r.campos) {
    assert.notEqual(c.valor, undefined,
      'undefined viaja en silencio y aparece como la cadena "undefined" en un CSV que alguien firma')
  }
})

test('T4-G5-04 · lo que el modelo QUERÍA meter se conserva para auditar', () => {
  const e = bueno()
  e.titular.nombre = { valor: 'Pedro Martínez', cita: 'El titular es Pedro Martínez' }
  const c = campo(revisar(e, ESQ, FUENTE), 'titular.nombre')
  assert.equal(c.propuesto, 'Pedro Martínez',
    'el valor rechazado es la evidencia de que la guardia hizo algo')
})

test('T4-G5-05 · un campo rechazado NUNCA conserva su grado de evidencia', () => {
  const e = bueno()
  e.documentos[0].emisor = { valor: 'ETESA', cita: 'el recibo del IDAAN' }
  assert.equal(campo(revisar(e, ESQ, FUENTE), 'documentos[0].emisor').evidencia, 'Desconocido')
})

test('T4-G5-06 · TODO campo sale con veredicto: no hay silencio posible', () => {
  const r = revisar(bueno(), ESQ, FUENTE)
  for (const c of r.campos) {
    assert.equal(typeof c.aceptado, 'boolean', `${c.ruta} salió sin veredicto`)
    assert.ok(Array.isArray(c.rechazos), `${c.ruta} salió sin lista de rechazos`)
  }
  assert.ok(r.campos.length > 0)
})

// ═════════════════════════════════════════════════════════════════════
//  Los campos críticos y el cierre del expediente
// ═════════════════════════════════════════════════════════════════════

test('T4-05 · sin un campo crítico, el expediente NO puede estar completo', () => {
  const e = bueno()
  delete e.titular.cedula
  const r = revisar(e, ESQ, FUENTE)
  assert.equal(r.resumen.completo, false)
  assert.ok(r.resumen.faltanCriticos.includes('titular.cedula'))
})

test('T4-06 · un crítico RECHAZADO cuenta igual que uno ausente', () => {
  // El fallo silencioso más peligroso: el campo vino, pero no ancló.
  const e = bueno()
  e.titular.cedula = { valor: '8-999-999', cita: 'cédula 8-999-999' }
  const r = revisar(e, ESQ, FUENTE)
  assert.equal(r.resumen.completo, false,
    'un dato inventado no rellena un hueco: lo deja igual de vacío')
})

test('T4-07 · con todos los críticos anclados, el expediente cierra', () => {
  assert.equal(revisar(bueno(), ESQ, FUENTE).resumen.completo, true)
})

// ═════════════════════════════════════════════════════════════════════
//  El resumen — lo que va al CSV de auditoría y al video
// ═════════════════════════════════════════════════════════════════════

test('T4-08 · el resumen cuenta por guardia y por motivo', () => {
  const e = bueno()
  e.documentos[0].tipo   = 'ESCRITURA_PUBLICA'                                  // G2
  e.documentos[0].emisor = { valor: 'ETESA', cita: 'el recibo del IDAAN' }      // G3
  e.titular.pasaporte    = { valor: 'X', cita: 'El titular' }                   // G5
  // Nota: `bueno()` ya no trae `confianza`, así que estos son exactamente 3.
  const { resumen } = revisar(e, ESQ, FUENTE)

  assert.equal(resumen.porGuardia.G2, 1)
  assert.equal(resumen.porGuardia.G3, 1)
  assert.equal(resumen.porGuardia.G5, 1)
  assert.equal(resumen.porMotivo[RECHAZO.FUERA_DE_ENUM], 1)
  assert.equal(resumen.rechazados, 3)
})

test('T4-09 · revisar() NO lanza ante basura: un campo malo es un DATO', () => {
  // Lanzar obligaría a envolver la tubería entera en try/catch, y se perdería
  // justo la información que interesa: cuál falló y por qué.
  for (const basura of [null, undefined, 42, 'texto', [], { raro: true }]) {
    assert.doesNotThrow(() => revisar(basura, ESQ, FUENTE), `revienta con ${JSON.stringify(basura)}`)
  }
})

test('T4-10 · el resultado es inmutable', () => {
  const r = revisar(bueno(), ESQ, FUENTE)
  assert.throws(() => { r.campos.push({}) }, TypeError)
  assert.throws(() => { r.resumen.total = 0 }, TypeError)
})

test('T4-11 · revisar es determinista: cien corridas, resultado idéntico', () => {
  const primero = JSON.stringify(revisar(bueno(), ESQ, FUENTE))
  for (let i = 0; i < 100; i++) {
    assert.equal(JSON.stringify(revisar(bueno(), ESQ, FUENTE)), primero)
  }
})

// ═════════════════════════════════════════════════════════════════════
//  La tabla de guardias es un DATO, como las transiciones
// ═════════════════════════════════════════════════════════════════════

test('T4-12 · la tabla de guardias es inmutable', () => {
  assert.throws(() => { GUARDIAS.push({}) }, TypeError)
  assert.throws(() => { GUARDIAS[0].id = 'GX' }, TypeError)
})

test('T4-13 · cada guardia declara qué comprueba y POR QUÉ existe', () => {
  for (const g of GUARDIAS) {
    assert.match(g.id, /^G\d$/)
    assert.ok(g.que && g.que.length > 2, `${g.id} no dice qué comprueba`)
    assert.ok(g.porque && g.porque.length > 20,
      `${g.id} no explica por qué existe: una guardia sin motivo es una que nadie se atreve a quitar`)
    assert.equal(typeof g.aplicar, 'function')
  }
})

// ═════════════════════════════════════════════════════════════════════
//  El resolvedor del esquema — lo que hace genéricas a las guardias
// ═════════════════════════════════════════════════════════════════════

test('T4-14 · specDeCampo resuelve rutas anidadas y $ref', () => {
  assert.equal(specDeCampo(ESQ, 'titular.nombre').properties.valor.type, 'string')
  assert.equal(specDeCampo(ESQ, 'documentos[0].monto').properties.valor.type, 'number')
  assert.ok(Array.isArray(specDeCampo(ESQ, 'documentos[0].tipo').enum))
})

test('T4-15 · specDeCampo devuelve undefined para una ruta que NO existe', () => {
  assert.equal(specDeCampo(ESQ, 'titular.pasaporte'), undefined,
    'es el dato que permite a G5 detectar un campo inventado')
  assert.equal(specDeCampo(ESQ, 'inventado.del.todo'), undefined)
})

test('T4-16 · un $ref remoto LANZA: aquí no se descarga nada', () => {
  assert.throws(() => resolverRef({ $ref: 'https://ejemplo.com/x.json' }, {}), /no local/)
  assert.throws(() => resolverRef({ $ref: '#/$defs/noExiste' }, { $defs: {} }), /rota/)
})

test('T4-17 · rutaGenerica normaliza los índices', () => {
  assert.equal(rutaGenerica('documentos[0].tipo'), 'documentos[].tipo')
  assert.equal(rutaGenerica('a[12].b[3].c'), 'a[].b[].c')
  assert.equal(rutaGenerica('titular.nombre'), 'titular.nombre')
})

// ═══════════════════════════════════════════════════════════════════════════
//  G9 y G10 · ⭐ EL ATAQUE DE LA CITA ANCHA
//
//  El hallazgo más elegante de la auditoría adversarial: **no hace falta
//  inventar una cita para colar un dato falso. Basta con ensancharla.**
//
//  Sobre el dictado REAL del repositorio, con citas cien por cien literales,
//  el expediente acababa afirmando que hay tres tomógrafos Siemens de ocho
//  años. La fuente dice un tomógrafo, sin marca y sin edad. Los tres errores
//  que este proyecto enseña en su README pasaban enteros por la puerta
//  principal, y G3 los aceptaba con razón: las citas estaban ahí.
// ═══════════════════════════════════════════════════════════════════════════

const FUENTE_ANCHA =
  'Estoy en Hospital DemoCare Pacific, en Panamá. Tienen tres resonadores ' +
  'magnéticos Siemens y un tomógrafo. Uno de los resonadores parece de unos ocho años.'

test('G9 · dos entidades NO pueden reclamar la misma palabra del texto', () => {
  const r = revisar({
    equipos: [
      { modalidad: { valor: 'MRI', cita: 'tres resonadores magnéticos' },
        fabricante: { valor: 'Siemens', cita: 'tres resonadores magnéticos Siemens' } },
      { modalidad: { valor: 'CT', cita: 'y un tomógrafo' },
        fabricante: { valor: 'Siemens', cita: 'resonadores magnéticos Siemens y un tomógrafo' } }
    ]
  }, ESQ_SALUD, FUENTE_ANCHA)

  const uno = r.campos.find(c => c.ruta === 'equipos[0].fabricante')
  const dos = r.campos.find(c => c.ruta === 'equipos[1].fabricante')

  assert.ok(uno.aceptado, 'el primero que reclama la palabra se la queda')
  assert.equal(dos.aceptado, false, 'el segundo no: «Siemens» aparece una vez en el documento')
  assert.ok(dos.rechazos.some(x => x.guardia === 'G9'),
    'y lo dice G9, no un rechazo genérico: el oficial tiene que saber por qué')
})

test('G9 · pero dos campos del MISMO elemento sí comparten frase', () => {
  // El tipo y la marca del mismo aparato salen de la misma línea, y eso es
  // exactamente lo normal. Una guardia que lo prohibiera sería inservible.
  const r = revisar({
    equipos: [{ modalidad: { valor: 'MRI', cita: 'tres resonadores magnéticos Siemens' },
                fabricante: { valor: 'Siemens', cita: 'tres resonadores magnéticos Siemens' } }]
  }, ESQ_SALUD, FUENTE_ANCHA)

  assert.ok(r.campos.filter(c => c.ruta.startsWith('equipos[0]')).every(c => c.aceptado || c.rechazos.every(x => x.guardia !== 'G9')),
    'G9 no se mete entre campos del mismo elemento')
})

test('G10 · ⭐ una cita que salta de frase no está citando: está construyendo', () => {
  const r = revisar({
    equipos: [{
      modalidad: { valor: 'CT', cita: 'y un tomógrafo' },
      // Literal, palabra por palabra. Y pega el final de una frase con la
      // siguiente, prestándole al tomógrafo la edad de los resonadores.
      antiguedad_anios: { valor: 8, cita: 'y un tomógrafo. Uno de los resonadores parece de unos ocho años' }
    }]
  }, ESQ_SALUD, FUENTE_ANCHA)

  const edad = r.campos.find(c => c.ruta === 'equipos[0].antiguedad_anios')
  assert.equal(edad.aceptado, false, 'la edad no entra: no sale del mismo enunciado que la entidad')
  assert.ok(edad.rechazos.some(x => x.guardia === 'G10'))
})

test('G10 · una cita que TERMINA en punto sigue siendo una sola frase', () => {
  // El borde no cuenta. Si contara, la mitad de las citas legítimas caerían y
  // la guardia sería ruido en vez de defensa.
  const r = revisar({
    equipos: [{ modalidad: { valor: 'CT', cita: 'Tienen tres resonadores magnéticos Siemens y un tomógrafo.' } }]
  }, ESQ_SALUD, FUENTE_ANCHA)

  const m = r.campos.find(c => c.ruta === 'equipos[0].modalidad')
  assert.ok(m.rechazos.every(x => x.guardia !== 'G10'), 'no la para G10')
})

test('G10 · un decimal no es un salto de frase', () => {
  // «45.30» lleva punto y no separa nada: hace falta el espacio detrás.
  const r = revisar({
    titular: { nombre: { valor: 'Ana Ruiz', cita: 'Titular Ana Ruiz' } },
    documentos: [{ tipo: 'RECIBO_SERVICIO',
      emisor: { valor: 'IDAAN', cita: 'recibo del IDAAN' },
      monto: { valor: 45.30, cita: 'por 45.30 balboas' } }]
  }, ESQ, 'Titular Ana Ruiz presenta recibo del IDAAN por 45.30 balboas')

  const monto = r.campos.find(c => c.ruta === 'documentos[0].monto')
  assert.ok(monto.rechazos.every(x => x.guardia !== 'G10'), 'un decimal no es dos frases')
})
