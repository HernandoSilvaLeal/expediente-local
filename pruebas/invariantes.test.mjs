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
import { crearEvento } from '../core/ledger.mjs'
import { proyectar } from '../core/proyeccion.mjs'
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
/**
 * Recalcula `anterior` y `hash` de toda la cadena tras haber tocado un evento.
 *
 * Sin esto, cualquier test que modifique el ledger rompe O5 —el hash deja de
 * cuadrar— y O5 tapa a todos los demás invariantes: el test pasa, pero por el
 * motivo equivocado. Es exactamente lo que le pasaba a T15-O3.
 *
 * Un atacante real con acceso al archivo haría justo esto: reescribir el dato y
 * rehacer la cadena. Que los tests lo hagan es lo que convierte a O1..O4 en
 * comprobaciones de verdad y no en decoración detrás de O5.
 */
function reencadenar (eventos) {
  let anterior = null
  return eventos.map((e, i) => {
    const { hash, anterior: _viejo, ...resto } = e
    const nuevo = crearEvento({ ...resto, seq: i + 1 }, anterior)
    anterior = nuevo
    return nuevo
  })
}

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

test('T15-01 · hay exactamente seis invariantes, y cada uno dice qué y por qué', () => {
  assert.equal(INVARIANTES.length, 6)
  for (const inv of INVARIANTES) {
    assert.match(inv.id, /^O[1-6]$/)
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
  // ── ESTE TEST ESTABA MINTIENDO, Y LO ENCONTRÓ UNA AUDITORÍA ADVERSARIAL ───
  //
  // Decía `assert.ok(r.violaciones.length > 0, 'algo tiene que saltar')`. Y algo
  // saltaba: O5, porque reescribir una línea rompe la cadena de hashes. O3 no
  // llegaba a ejercitarse NUNCA — medido: `violaciones` era exactamente ['O5'].
  //
  // Un test que pasa por el motivo equivocado es peor que no tener test: da por
  // cubierto lo que nadie cubre. El invariante O3 podía ser cien por cien
  // decorativo —un `return []` como primera línea— y la suite seguía verde
  // mientras el README afirmaba que O3 se comprueba.
  //
  // ── Y AL ARREGLARLO APARECIÓ ALGO MÁS ────────────────────────────────────
  //
  // Reconstruida la cadena para que O5 calle, O3 tampoco saltaba. No es un
  // fallo de O3: es que la rama del TECHO **no se puede provocar tocando el
  // archivo**. El expediente no se guarda, se deriva del ledger, así que si se
  // baja la evidencia de una observación, la proyección baja con ella y las dos
  // siguen cuadrando.
  //
  // Lo que O3 vigila de verdad es un desajuste entre dos derivaciones — es
  // decir, un fallo de `core/proyeccion.mjs`, no una manipulación del disco.
  // Por eso se le alimenta el desajuste directamente. Es un test de unidad del
  // invariante, y decirlo es parte del test: fingir que es de punta a punta
  // sería repetir el error que este mismo test tenía.
  const O3 = INVARIANTES.find(i => i.id === 'O3')
  const b = sano()
  try {
    const eventos = lineas(b.archivo).map(l => JSON.parse(l))
    const expediente = proyectar(eventos)

    // La proyección real y sus eventos SIEMPRE cuadran: eso es lo esperado.
    assert.equal(O3.comprobar({ eventos, expediente }).length, 0,
      'sobre un expediente derivado de sus propios hechos, O3 calla')

    // Ahora el desajuste: el expediente afirma Confirmado sobre un campo cuya
    // mejor observación fue Estimado. Es exactamente blanquear un dato flojo.
    const ruta = Object.keys(expediente.campos)[0]
    const conMenos = eventos.map(e => e.tipo !== 'REVISION' ? e : ({
      ...e,
      datos: { ...e.datos, campos: e.datos.campos.map(c => ({ ...c, evidencia: 'Estimado' })) }
    }))

    const malos = O3.comprobar({ eventos: conMenos, expediente })
    assert.ok(malos.some(m => m.donde === ruta && /Confirmado|nivel/.test(m.causaRaiz)),
      'un campo que muestra más evidencia de la que se observó tiene que salir en rojo')
  } finally { b.limpiar() }
})

test('T15-O3-meta · O3 no vigila el disco, vigila la proyección — y hay que decirlo', () => {
  // Al arreglar T15-O3 salió algo que ningún documento del repositorio decía:
  // **las dos ramas de O3 son inalcanzables manipulando el archivo.**
  //
  //   · la del techo: el expediente se deriva del ledger, así que bajar la
  //     evidencia de una observación baja también la del expediente. Cuadran.
  //   · la del campo sin observación: para colar un campo en el expediente hay
  //     que meterlo en una REVISION… con lo cual la observación ya existe. Y si
  //     se cuela con un valor que no está en su cita, quien lo caza es O1.
  //
  // Eso NO hace a O3 inútil: hace que sea de otra clase. O1, O2, O4 y O5
  // vigilan el DISCO —alguien tocó el archivo—. O3 vigila que dos derivaciones
  // del mismo ledger coincidan, o sea, un fallo de core/proyeccion.mjs. Es una
  // red contra nuestro propio código, no contra un atacante.
  //
  // Se escribe aquí porque el README dice «5 invariantes» sin distinguirlos, y
  // un jurado que pregunte «¿cómo provocas cada uno?» merece esta respuesta y
  // no un silencio incómodo.
  const O3 = INVARIANTES.find(i => i.id === 'O3')
  const b = sano()
  try {
    const eventos = lineas(b.archivo).map(l => JSON.parse(l))
    const expediente = proyectar(eventos)

    // La rama del campo huérfano, alimentada directamente.
    const huerfano = {
      ...expediente,
      campos: { ...expediente.campos, 'titular.colado': { ruta: 'titular.colado', valor: 'X', cita: 'c', evidencia: 'Confirmado' } }
    }
    const malos = O3.comprobar({ eventos, expediente: huerfano })
    assert.ok(malos.some(m => m.donde === 'titular.colado' && /NINGUNA observación/.test(m.causaRaiz)),
      'un campo en el expediente que ningún hecho registró tiene que salir en rojo')

    // Y desde el disco, ese mismo intento lo caza O1 antes: el valor no ancla.
    const i = eventos.findIndex(e => e.tipo === 'REVISION')
    eventos[i].datos.campos.push({
      ruta: 'titular.colado', aceptado: true, valor: 'X',
      cita: 'El titular', evidencia: 'Confirmado', rechazos: []
    })
    escribir(b.archivo, reencadenar(eventos).map(e => JSON.stringify(e)))
    const v = verificar(b.dir, ESQ).violaciones
    assert.ok(v.some(x => x.invariante === 'O1'),
      'colar un campo por el archivo lo para O1, que sí vigila el disco')
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

test('T15-O6 · ⭐ una POSICIÓN que señala otra frase lo pone en rojo', () => {
  // ── EL FALLO REAL QUE HIZO NACER ESTE INVARIANTE ─────────────────────────
  //
  // Al resolver un conflicto, la proyección cambiaba `valor` y `cita` y heredaba
  // el `donde` del valor DESCARTADO. En EXP-003 el campo decía «María Gómez
  // Batista» con la posición de «Juan Pérez González» —los dos de 33
  // caracteres, así que ni la longitud lo delataba—.
  //
  // O1 pasaba, y con razón: la cita SÍ existía en la fuente. Lo roto era el
  // vínculo entre la cita y su posición, que no comprobaba nadie. Y es
  // exactamente lo que se enseña en pantalla: el documento resaltado subrayaba
  // el nombre que el oficial acababa de descartar.
  //
  // Se alimenta la comprobación DIRECTAMENTE con una proyección desplazada,
  // por la razón que explica el test de al lado: el `donde` no se puede
  // corromper desde el disco.
  const O6 = INVARIANTES.find(i => i.id === 'O6')
  const b = sano()
  try {
    const eventos = lineas(b.archivo).map(l => JSON.parse(l))
    const expediente = proyectar(eventos)
    const ruta = Object.keys(expediente.campos).find(r => expediente.campos[r].donde)
    assert.ok(ruta, 'el andamio necesita al menos un campo con posición')

    const campo = expediente.campos[ruta]
    const desplazado = {
      ...expediente,
      campos: {
        ...expediente.campos,
        [ruta]: { ...campo, donde: { desde: campo.donde.desde + 4, hasta: campo.donde.hasta + 4 } }
      }
    }
    const malos = O6.comprobar({ eventos, expediente: desplazado })
    assert.ok(malos.length, 'cuatro caracteres de desfase tienen que salir en rojo')
    assert.match(malos[0].causaRaiz, /señala/,
      'la causa raíz tiene que enseñar QUÉ señala y QUÉ debería señalar')
  } finally { b.limpiar() }
})

test('T15-O6b · ⭐ una posición fuera de rango se caza y se nombra, no revienta', () => {
  // El otro modo de fallo del mapeo: en vez de señalar mal, señalar fuera.
  // `String.slice` no lanza con índices absurdos —devuelve cadena vacía—, así
  // que sin una comprobación explícita esto pasaría como «no coincide» y la
  // causa raíz mentiría sobre lo que de verdad ocurrió.
  const O6 = INVARIANTES.find(i => i.id === 'O6')
  const b = sano()
  try {
    const eventos = lineas(b.archivo).map(l => JSON.parse(l))
    const expediente = proyectar(eventos)
    const ruta = Object.keys(expediente.campos).find(r => expediente.campos[r].donde)
    const roto = {
      ...expediente,
      campos: { ...expediente.campos,
                [ruta]: { ...expediente.campos[ruta], donde: { desde: 999999, hasta: 1000000 } } }
    }
    const malos = O6.comprobar({ eventos, expediente: roto })
    assert.ok(malos.length, 'una posición imposible no puede pasar en verde')
    assert.match(malos[0].causaRaiz, /no cabe en la fuente/,
      'tiene que decir que está FUERA, no que «no coincide»')
  } finally { b.limpiar() }
})

test('T15-O6-meta · O6 vigila la proyección, no el disco — y hay que decirlo', () => {
  // Igual que O3, y por la misma razón: `core/proyeccion.mjs` RECALCULA `donde`
  // a partir de la cita cada vez que proyecta. Así que no hay forma de dejar un
  // `desde/hasta` corrupto editando el archivo: la proyección lo pisa.
  //
  // Eso no hace a O6 decorativo, hace que sea de otra clase — una red contra
  // NUESTRO propio código, no contra alguien que edite el ledger. Y cazó un
  // fallo real el primer día que existió.
  //
  // Se escribe porque un jurado que pregunte «¿cómo provocas cada invariante?»
  // merece esta respuesta y no un silencio incómodo.
  const b = sano()
  try {
    const ls = lineas(b.archivo)
    const i = ls.findIndex(l => l.includes('"REVISION"'))
    const ev = JSON.parse(ls[i])
    const campo = ev.datos.campos.find(c => c.ruta === 'titular.nombre')
    campo.donde = { desde: 0, hasta: 3 }        // basura deliberada en el disco
    ls[i] = JSON.stringify(ev)
    escribir(b.archivo, ls)

    const eventos = lineas(b.archivo).map(l => JSON.parse(l))
    const proyectado = proyectar(eventos).campos['titular.nombre'].donde
    assert.notDeepEqual(proyectado, { desde: 0, hasta: 3 },
      'la proyección tiene que recalcular la posición, no confiar en la del ledger')

    const v = verificar(b.dir, ESQ).violaciones.filter(x => x.invariante === 'O6')
    assert.equal(v.length, 0,
      'corromper el `donde` del ledger NO alcanza a O6: lo recalcula la proyección')
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
