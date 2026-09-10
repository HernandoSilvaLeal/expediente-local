#!/usr/bin/env node
// scripts/metricas.mjs — EL PROYECTO SE MIDE A SÍ MISMO.
//
// ═══════════════════════════════════════════════════════════════════════════
//   Un indicador que se escribe a mano es una opinión.
//   Aquí todo número sale de ejecutar algo o de leer el código.
// ═══════════════════════════════════════════════════════════════════════════
//
// Por qué existe:
//   «Completion» vale 10 puntos y «Technical» 35, y las dos se juzgan sobre lo
//   que se puede COMPROBAR. Este archivo es el comando que lo comprueba: corre
//   los tests de verdad, cuenta desde el código de verdad, y publica el número
//   aunque salga feo.
//
//   Las casillas que no se pueden medir por comando (el video, el formulario)
//   NO se marcan aquí a mano: viven en audit/puertas.json y se distinguen en
//   la salida como declaradas, no medidas. La distinción es el punto.
//
// Uso:
//   node scripts/metricas.mjs            tablero legible
//   node scripts/metricas.mjs --json     el mismo dato, para otro programa
//   node scripts/metricas.mjs --breve    solo el resumen de una línea
//
// Sin dependencias. Corre sin modelo, sin red y sin el SDK.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const rel = (p) => relative(RAIZ, p)

// ═══════════════════════════════════════════════════════════════════════════
//  LAS DEFINICIONES — visibles, porque un indicador sin definición se manipula
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Un test cuenta como DE RECHAZO si su nombre afirma que algo NO se puede.
 * Se declara la lista completa: quien lea la salida puede discutir el criterio,
 * que es justo lo que un criterio oculto impide.
 */
const MARCAS_DE_RECHAZO = Object.freeze([
  'lanza', 'ilegal', 'rechaz', 'ausente', 'vacio', 'vacío', 'inventad',
  'no ancla', 'no puede', 'no se', 'no está', 'no esta', 'no cuenta',
  'no promueve', 'no revienta', 'no impide', 'sin cita', 'sin motivo',
  'sin valor', 'jamás', 'jamas', 'nunca', 'no hay', ' no ', 'falla'
])

/** Módulos del núcleo que el plan exige. Lo que falta se ve, no se olvida. */
const NUCLEO_EXIGIDO = Object.freeze([
  ['core/esquema.mjs', 'el esquema es un dato, no código'],
  ['core/estado.mjs', 'FSM del registro'],
  ['core/anclaje.mjs', 'la regla de oro'],
  ['core/guardias.mjs', 'G1..G5 de núcleo'],
  ['core/ledger.mjs', 'append-only'],
  ['core/dedup.mjs', 'duplicado enlazado, no borrado'],
  ['core/calidad.mjs', 'repregunta determinista'],
  ['core/proyeccion.mjs', 'el dataset se regenera del ledger']
])

// ═══════════════════════════════════════════════════════════════════════════
//  MEDICIÓN 1 · el código
// ═══════════════════════════════════════════════════════════════════════════

function archivosJs (dir, acc = []) {
  let entradas
  try { entradas = readdirSync(dir) } catch { return acc }
  for (const e of entradas) {
    const p = join(dir, e)
    if (e === 'node_modules' || e.startsWith('.')) continue
    if (statSync(p).isDirectory()) archivosJs(p, acc)
    else if (/\.m?js$/.test(e)) acc.push(p)
  }
  return acc
}

/**
 * Cuenta líneas separando código de comentario.
 * Heurística de línea, declarada: es comentario la línea cuyo primer carácter
 * no-blanco abre o continúa un comentario. No pretende ser un parser; pretende
 * ser reproducible.
 */
function contarLineas (ruta) {
  const lineas = readFileSync(ruta, 'utf8').split('\n')
  let codigo = 0, comentario = 0, blanco = 0, enBloque = false
  for (const l of lineas) {
    const t = l.trim()
    if (enBloque)            { comentario++; if (t.includes('*/')) enBloque = false; continue }
    if (t === '')            { blanco++; continue }
    if (t.startsWith('//'))  { comentario++; continue }
    if (t.startsWith('/*'))  { comentario++; if (!t.includes('*/')) enBloque = true; continue }
    if (t.startsWith('*'))   { comentario++; continue }
    codigo++
  }
  return { total: lineas.length, codigo, comentario, blanco }
}

/** ¿Tiene el archivo una cabecera que explique POR QUÉ EXISTE? */
function tieneCabeceraDeIntencion (ruta) {
  const primeras = readFileSync(ruta, 'utf8').split('\n').slice(0, 45)
  const comentadas = primeras.filter(l => /^\s*(\/\/|\/\*|\*)/.test(l)).length
  return comentadas >= 8
}

function medirCodigo () {
  const zonas = ['core', 'ia', 'malla', 'ui', 'scripts', 'instancias']
  const modulos = []
  for (const z of zonas) {
    for (const abs of archivosSeguros(join(RAIZ, z))) {
      const c = contarLineas(abs)
      const src = readFileSync(abs, 'utf8')
      modulos.push({
        zona: z,
        archivo: rel(abs),
        ...c,
        densidadComentario: c.codigo ? +(c.comentario / c.codigo).toFixed(2) : 0,
        intencion: tieneCabeceraDeIntencion(abs),
        congelados: (src.match(/Object\.freeze/g) ?? []).length,
        exports: (src.match(/^export /gm) ?? []).length
      })
    }
  }
  return modulos
}

// Alias defensivo: si algún día el directorio no existe, no revienta el tablero.
function archivosSeguros (dir) {
  return existsSync(dir) ? archivosJs(dir) : []
}

// ═══════════════════════════════════════════════════════════════════════════
//  MEDICIÓN 2 · los tests, CORRIÉNDOLOS de verdad
// ═══════════════════════════════════════════════════════════════════════════

function medirPruebas () {
  const suites = archivosSeguros(join(RAIZ, 'pruebas')).filter(a => a.endsWith('.test.mjs'))
  if (suites.length === 0) return { suites: 0, casos: 0, pass: 0, fail: 0, rechazo: 0, felicidad: 0, ratio: 0, escritos: 0, porSuite: [], fallidos: [] }

  let tap = ''
  try {
    tap = execFileSync(process.execPath,
      ['--test', '--test-reporter=tap', ...suites.map(s => rel(s))],
      { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 })
  } catch (e) {
    tap = (e.stdout ?? '') + (e.stderr ?? '')   // hay fallos: el TAP igual sirve
  }

  // Solo los casos hoja: el TAP anida "ok N - <suite>" al final de cada archivo.
  const nombresSuite = new Set(suites.map(s => rel(s)))
  const casos = []
  for (const linea of tap.split('\n')) {
    const m = /^\s*(not ok|ok)\s+\d+\s+-\s+(.*)$/.exec(linea)
    if (!m) continue
    const nombre = m[2].trim()
    if (nombresSuite.has(nombre)) continue        // es el agregado del archivo
    casos.push({ nombre, ok: m[1] === 'ok' })
  }

  const esRechazo = (n) => {
    const b = n.toLowerCase()
    return MARCAS_DE_RECHAZO.some(m => b.includes(m))
  }

  const rechazo = casos.filter(c => esRechazo(c.nombre)).length
  const felicidad = casos.length - rechazo
  const fail = casos.filter(c => !c.ok).length

  // Por suite: cuántos `test(` están ESCRITOS en el archivo. No coincide con los
  // ejecutados, y eso es información: la diferencia son los tests generados en
  // bucle desde la propia tabla de transiciones.
  const porSuite = suites.map(s => ({
    archivo: rel(s),
    escritos: (readFileSync(s, 'utf8').match(/^\s*test\(/gm) ?? []).length
  }))

  return {
    suites: suites.length,
    casos: casos.length,
    pass: casos.length - fail,
    fail,
    rechazo,
    felicidad,
    ratio: felicidad ? +(rechazo / felicidad).toFixed(1) : 0,
    escritos: porSuite.reduce((a, s) => a + s.escritos, 0),
    porSuite,
    fallidos: casos.filter(c => !c.ok).map(c => c.nombre)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  MEDICIÓN 3 · la FSM, leída del propio código
// ═══════════════════════════════════════════════════════════════════════════

async function medirFsm () {
  const ruta = join(RAIZ, 'core/estado.mjs')
  if (!existsSync(ruta)) return null
  const { TRANSICIONES, SOLO_HUMANO, EXIGEN_MOTIVO } = await import(ruta)
  const estados = Object.keys(TRANSICIONES).length
  const legales = Object.values(TRANSICIONES).reduce((a, d) => a + d.length, 0)
  const combinaciones = estados ** 2
  return {
    estados,
    legales,
    combinaciones,
    ilegales: combinaciones - legales,
    terminales: Object.values(TRANSICIONES).filter(d => d.length === 0).length,
    soloHumano: SOLO_HUMANO.length,
    exigenMotivo: EXIGEN_MOTIVO.length,
    superficieCerrada: +((combinaciones - legales) / combinaciones * 100).toFixed(1)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  MEDICIÓN 4 · la frontera 95/5
// ═══════════════════════════════════════════════════════════════════════════

function medirFrontera () {
  try {
    execFileSync(process.execPath, ['scripts/verificar-frontera.mjs'],
      { cwd: RAIZ, stdio: 'ignore', timeout: 30_000 })
    return { intacta: true }
  } catch {
    return { intacta: false }
  }
}

/** Cuántas cajas del sistema tocan un modelo. Es EL número del pitch. */
function medirRelacionSoftwareIa () {
  const nucleo = archivosSeguros(join(RAIZ, 'core')).length
  const malla  = archivosSeguros(join(RAIZ, 'malla')).filter(a => !a.includes('node_modules')).length
  const ui     = archivosSeguros(join(RAIZ, 'ui')).length
  const ia     = archivosSeguros(join(RAIZ, 'ia')).length
  const total  = nucleo + malla + ui + ia
  return {
    total, conModelo: ia, sinModelo: total - ia,
    porcentajeDeterminista: total ? +((total - ia) / total * 100).toFixed(1) : 0,
    // Mientras ia/ esté vacío el porcentaje sale 100 y no significa nada: el
    // sistema todavía no infiere. Decirlo en voz alta antes de que lo diga el
    // jurado es la diferencia entre un indicador y una mentira con decimales.
    concluyente: ia > 0
  }
}

/**
 * Corre scripts/verificar-entrega.mjs y devuelve qué puertas pasaron.
 *
 * Existe para MOVER CASILLAS DE DECLARADAS A MEDIDAS. Cada vez que algo que se
 * marcaba a mano pasa a verificarse por comando, el tablero vale un poco más.
 * El movimiento contrario nunca es aceptable.
 */
function medirEntrega () {
  let salida = ''
  try {
    salida = execFileSync(process.execPath, ['scripts/verificar-entrega.mjs'],
      { cwd: RAIZ, encoding: 'utf8', timeout: 300_000 })
  } catch (e) { salida = (e.stdout ?? '') + (e.stderr ?? '') }

  const paso = (fragmento) => {
    const linea = salida.split('\n').find(l => l.includes(fragmento))
    return Boolean(linea && linea.includes('PASS'))
  }
  return {
    corrio: salida.includes('VERIFICACIÓN DE ENTREGA'),
    rutasAbsolutas:  paso('rutas absolutas'),
    jergaInterna:    paso('jerga interna'),
    placeholders:    paso('placeholders'),
    basePreexistente: paso('base preexistente'),
    licencia:        paso('LICENSE'),
    depsFijadas:     paso('dependencias declaradas'),
    smoke:           paso('smoke sale con JSON')
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  MEDICIÓN 5 · las puertas
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cada casilla tiene un `medir` (una función) o una `clave` (declarada a mano
 * en audit/puertas.json). Nunca las dos. Una casilla automática NO se puede
 * marcar a mano: ese es el punto de todo el archivo.
 */
function definirPuertas (m) {
  const hay = (p) => existsSync(join(RAIZ, p))
  const declaradas = leerDeclaradas()

  const auto = (nombre, ok, evidencia) => ({ nombre, tipo: 'medida', ok, evidencia })
  const decl = (nombre, clave, comando) => ({
    nombre, tipo: 'declarada', clave, comando,
    ok: declaradas[clave] === true
  })

  return {
    BRONCE: {
      corte: '10-sep 14:00',
      consecuencia: 'si no cierra, PLATA se cancela entera',
      casillas: [
        auto('los tests deterministas pasan', m.pruebas.fail === 0 && m.pruebas.casos > 0, `${m.pruebas.pass}/${m.pruebas.casos}`),
        auto('la frontera 95/5 aguanta', m.frontera.intacta, 'core/ sin @qvac/sdk'),
        auto('core/esquema.mjs', hay('core/esquema.mjs')),
        auto('core/estado.mjs', hay('core/estado.mjs')),
        auto('core/anclaje.mjs', hay('core/anclaje.mjs')),
        auto('core/guardias.mjs', hay('core/guardias.mjs')),
        auto('core/ledger.mjs', hay('core/ledger.mjs')),
        auto('ia/extraer.mjs — el único que toca el SDK', hay('ia/extraer.mjs')),
        auto('cli.mjs punta a punta', hay('cli.mjs')),
        auto('casos de uso de sucursal, punta a punta', contarCasosDeUso() >= 6,
             contarCasosDeUso() ? `${contarCasosDeUso()} escenarios` : ''),
        auto('el smoke recorre el flujo completo y sale JSON', m.entrega.smoke, 'npm run smoke'),
        decl('el smoke corre DENTRO de unshare -rn', 'bronce_sin_red', 'unshare -rn bash -c "npm run smoke"'),
        decl('README con los 4 pasos de instalación medidos', 'bronce_readme_instalacion', 'seguirlo en máquina limpia')
      ]
    },
    PLATA: {
      corte: '10-sep 17:00',
      consecuencia: 'se entrega igual a las 20:00; PLATA es margen, no requisito',
      casillas: [
        auto('core/dedup.mjs', hay('core/dedup.mjs')),
        auto('core/calidad.mjs', hay('core/calidad.mjs')),
        auto('core/proyeccion.mjs', hay('core/proyeccion.mjs')),
        auto('verificar-invariantes O1..O5', hay('scripts/verificar-invariantes.mjs')),
        auto('UI servida por node:http', hay('ui/servidor.mjs')),
        auto('los 4 badges de evidencia', hay('ui/index.html')),
        decl('los 13 casos oficiales, número CRUDO publicado', 'plata_casos_crudo', 'npm run audit:casos'),
        decl('los 9 artefactos de audit/ regenerados', 'plata_audit_all', 'npm run audit:all')
      ]
    },
    ORO: {
      corte: '11-sep 02:00 — CÓDIGO CONGELADO',
      consecuencia: 'nada de ORO justifica llegar tarde',
      casillas: [
        auto('malla/campo.mjs — par sin SDK', hay('malla/campo.mjs')),
        auto('malla/motor.mjs — el que infiere', hay('malla/motor.mjs')),
        decl('P2P entre DOS MÁQUINAS FÍSICAS sin internet', 'oro_p2p_fisico', 'R-01, hotspot del celular'),
        decl('voz encima de la misma vía de texto', 'oro_voz', 'node cli.mjs capturar --audio'),
        decl('delegación: el portátil sin SDK recibe inferencia', 'oro_delegacion', 'malla/campo.mjs contra motor'),
        decl('el core corriendo sobre un SEGUNDO dominio', 'oro_segundo_dominio', 'instancias/salud/')
      ]
    },
    DESCALIFICA: {
      corte: '11-sep 08:00 — sin prórroga',
      consecuencia: 'CADA UNA, POR SÍ SOLA, ANULA TODO EL TRABAJO',
      casillas: [
        auto('README existe', hay('README.md')),
        auto('LICENSE existe', hay('LICENSE')),
        // Estas cinco EMPEZARON siendo declaradas a mano y ahora las verifica
        // scripts/verificar-entrega.mjs. Mover casillas en esta dirección es el
        // único progreso real del tablero; el movimiento contrario, nunca.
        auto('§13 base preexistente en el README', m.entrega.basePreexistente, 'art. 11c'),
        auto('cero rutas absolutas de esta máquina', m.entrega.rutasAbsolutas, 'medido'),
        auto('cero jerga interna en el repo público', m.entrega.jergaInterna, 'medido'),
        auto('cero placeholders sin rellenar', m.entrega.placeholders, 'medido'),
        auto('dependencias fijadas, sin ^ ni ~', m.entrega.depsFijadas, '@qvac/sdk 0.18.2 exacta'),
        decl('video ≤ 5:00 medido con ffprobe', 'desc_video_duracion', 'ffprobe -show_entries format=duration'),
        decl('video accesible en incógnito Y desde el móvil', 'desc_video_acceso', 'no listado, nunca privado'),
        decl('repo público, abierto sin sesión', 'desc_repo_publico', 'incógnito sobre la URL'),
        decl('clon limpio arranca siguiendo el README', 'desc_clon_limpio', 'HOME=/tmp/juez git clone && npm ci && npm run smoke'),
        decl('formulario enviado y reabierto para confirmar', 'desc_formulario', 'captura del envío')
      ]
    }
  }
}

function leerDeclaradas () {
  const p = join(RAIZ, 'audit/puertas.json')
  if (!existsSync(p)) return {}
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return {} }
}

// ═══════════════════════════════════════════════════════════════════════════
//  MEDICIÓN 6 · lo cualitativo, hecho contable
// ═══════════════════════════════════════════════════════════════════════════

function medirCualidad (modulos, pruebas) {
  const delNucleo = modulos.filter(m => m.zona === 'core')
  const conIntencion = delNucleo.filter(m => m.intencion).length
  const totalCod = modulos.reduce((a, m) => a + m.codigo, 0)
  const totalCom = modulos.reduce((a, m) => a + m.comentario, 0)

  return [
    { indicador: 'Tests que prueban que algo NO se puede',
      valor: `${pruebas.rechazo} de ${pruebas.casos}`,
      meta: '≥ 60 %',
      ok: pruebas.casos > 0 && pruebas.rechazo / pruebas.casos >= 0.6,
      porque: 'probar el camino feliz no demuestra nada: la superficie que importa es la que se rechaza' },

    { indicador: 'Ratio rechazo : camino feliz',
      valor: `${pruebas.ratio} : 1`,
      meta: '≥ 2,0 : 1',
      ok: pruebas.ratio >= 2,
      porque: 'si hay más tests de que funciona que de que falla, el sistema no está probado' },

    { indicador: 'Módulos del núcleo que explican POR QUÉ existen',
      valor: `${conIntencion} de ${delNucleo.length}`,
      meta: 'todos',
      ok: delNucleo.length > 0 && conIntencion === delNucleo.length,
      porque: 'el jurado lee el código; un archivo sin porqué es un archivo que no defiende nada' },

    { indicador: 'Densidad de explicación (comentario ÷ código)',
      valor: totalCod ? `${(totalCom / totalCod).toFixed(2)}` : '—',
      meta: '≥ 0,40',
      ok: totalCod > 0 && totalCom / totalCod >= 0.4,
      porque: 'lo que se documenta al escribirlo sobrevive a las 3 de la mañana' },

    { indicador: 'Casos de uso REALES medidos en máquina, no inventados',
      valor: `${pruebas.casos ? contarMedidos() : 0} tests atados a un error observado`,
      meta: '≥ 3',
      ok: contarMedidos() >= 3,
      porque: 'un test inventado prueba mi imaginación; uno medido prueba el sistema' },

    { indicador: 'Estructuras inmutables (Object.freeze)',
      valor: `${modulos.reduce((a, m) => a + m.congelados, 0)}`,
      meta: '> 0 en todo dato exportado',
      ok: modulos.reduce((a, m) => a + m.congelados, 0) > 0,
      porque: 'una tabla de transiciones mutable es una FSM decorativa' },

    { indicador: 'Casos de uso probados punta a punta',
      valor: `${contarCasosDeUso()} escenarios de sucursal`,
      meta: '≥ 6',
      ok: contarCasosDeUso() >= 6,
      porque: 'los tests de unidad prueban piezas; un caso de uso prueba que el ' +
              'sistema resuelve el problema de alguien. El jurado juzga lo segundo' }
  ]
}

/**
 * Un CASO DE USO no es un test de unidad: recorre el sistema completo con un
 * escenario que un oficial de sucursal reconocería. Viven separados a propósito,
 * en pruebas/casos-de-uso.test.mjs, para que se puedan contar y enseñar.
 */
function contarCasosDeUso () {
  const p = join(RAIZ, 'pruebas/casos-de-uso.test.mjs')
  if (!existsSync(p)) return 0
  return (readFileSync(p, 'utf8').match(/^\s*test\(/gm) ?? []).length
}

function contarMedidos () {
  let n = 0
  for (const a of archivosSeguros(join(RAIZ, 'pruebas'))) {
    n += (readFileSync(a, 'utf8').match(/test\('[^']*medido/g) ?? []).length
  }
  return n
}

// ═══════════════════════════════════════════════════════════════════════════
//  El tablero
// ═══════════════════════════════════════════════════════════════════════════

const V = '\x1b[0;32m', R = '\x1b[0;31m', A = '\x1b[0;33m'
const C = '\x1b[0;36m', G = '\x1b[0;90m', B = '\x1b[1m', N = '\x1b[0m'

function barra (hechas, total, ancho = 22) {
  const llenas = total ? Math.round(hechas / total * ancho) : 0
  return '█'.repeat(llenas) + '░'.repeat(ancho - llenas)
}

async function main () {
  const argv = process.argv.slice(2)
  const modulos = medirCodigo()
  const pruebas = medirPruebas()
  const fsm = await medirFsm()
  const frontera = medirFrontera()
  const proporcion = medirRelacionSoftwareIa()
  const entrega = medirEntrega()
  const m = { modulos, pruebas, fsm, frontera, proporcion, entrega }
  const puertas = definirPuertas(m)
  const cualidad = medirCualidad(modulos, pruebas)

  const nucleoHecho = NUCLEO_EXIGIDO.filter(([f]) => existsSync(join(RAIZ, f)))

  const dato = {
    fecha: new Date().toISOString(),
    entregable: {
      modulos: modulos.length,
      lineasCodigo: modulos.reduce((a, x) => a + x.codigo, 0),
      lineasComentario: modulos.reduce((a, x) => a + x.comentario, 0),
      nucleo: { hecho: nucleoHecho.length, exigido: NUCLEO_EXIGIDO.length }
    },
    pruebas, fsm, frontera, proporcion, entrega, cualidad,
    puertas: Object.fromEntries(Object.entries(puertas).map(([k, v]) => [k, {
      corte: v.corte,
      hechas: v.casillas.filter(c => c.ok).length,
      total: v.casillas.length,
      casillas: v.casillas
    }]))
  }

  if (argv.includes('--json')) { console.log(JSON.stringify(dato, null, 2)); return }

  if (argv.includes('--breve')) {
    const br = puertas.BRONCE.casillas
    console.log(`${pruebas.pass}/${pruebas.casos} tests · frontera ${frontera.intacta ? 'OK' : 'ROTA'} · ` +
                `BRONCE ${br.filter(c => c.ok).length}/${br.length} · núcleo ${nucleoHecho.length}/${NUCLEO_EXIGIDO.length}`)
    return
  }

  // ── Cabecera ──────────────────────────────────────────────────────────────
  console.log(`\n  ${B}INDICADORES · expediente-local${N}   ${G}medidos, no declarados${N}\n`)

  // ── Entregable ────────────────────────────────────────────────────────────
  console.log(`  ${B}ENTREGABLE${N}`)
  const porZona = {}
  for (const x of modulos) {
    porZona[x.zona] ??= { n: 0, cod: 0, com: 0 }
    porZona[x.zona].n++; porZona[x.zona].cod += x.codigo; porZona[x.zona].com += x.comentario
  }
  for (const [z, v] of Object.entries(porZona)) {
    console.log(`     ${C}${z.padEnd(11)}${N} ${String(v.n).padStart(2)} módulos · ` +
                `${String(v.cod).padStart(4)} líneas de código · ${String(v.com).padStart(4)} de explicación`)
  }
  console.log(`     ${G}núcleo del plan${N}  ${nucleoHecho.length}/${NUCLEO_EXIGIDO.length}  ${barra(nucleoHecho.length, NUCLEO_EXIGIDO.length)}`)
  for (const [f, para] of NUCLEO_EXIGIDO) {
    const ok = existsSync(join(RAIZ, f))
    console.log(`        ${ok ? V + '●' : R + '○'}${N} ${f.padEnd(22)} ${G}${para}${N}`)
  }

  // ── La proporción que es el pitch ─────────────────────────────────────────
  console.log(`\n  ${B}LA FRONTERA 95/5${N}   ${G}el número que se dice en cámara${N}`)
  console.log(`     ${proporcion.sinModelo} módulos deterministas · ${proporcion.conModelo} tocan un modelo` +
              `  →  ${C}${proporcion.porcentajeDeterminista} %${N} del sistema no consulta a nadie`)
  console.log(`     ${frontera.intacta ? V + '✓ verificado por comando' : R + '✗ FRONTERA ROTA'}${N}` +
              `   ${G}npm run test:frontera${N}`)
  if (!proporcion.concluyente) {
    console.log(`     ${A}◐ NO CONCLUYENTE todavía: ia/ está vacío, así que el sistema aún no infiere.${N}`)
    console.log(`       ${G}este número no entra al pitch hasta que ia/extraer.mjs exista${N}`)
  }

  // ── FSM ───────────────────────────────────────────────────────────────────
  if (fsm) {
    console.log(`\n  ${B}SUPERFICIE CERRADA${N}   ${G}lo que el sistema se NIEGA a hacer${N}`)
    console.log(`     ${fsm.estados} estados · ${C}${fsm.legales}${N} transiciones legales · ` +
                `${C}${fsm.ilegales}${N} lanzan  →  ${C}${fsm.superficieCerrada} %${N} de la superficie está cerrada`)
    console.log(`     ${fsm.soloHumano} transiciones que solo puede provocar una persona · ` +
                `${fsm.exigenMotivo} que exigen motivo`)
  }

  // ── Pruebas ───────────────────────────────────────────────────────────────
  console.log(`\n  ${B}PRUEBAS${N}   ${G}ejecutadas ahora mismo, no recordadas${N}`)
  const col = pruebas.fail === 0 ? V : R
  console.log(`     ${col}${pruebas.pass}/${pruebas.casos}${N} pasan · ${pruebas.suites} suites`)
  console.log(`     ${C}${pruebas.rechazo}${N} prueban que algo NO se puede · ` +
              `${C}${pruebas.felicidad}${N} prueban que funciona · ratio ${C}${pruebas.ratio}:1${N}`)
  if (pruebas.fail) {
    for (const f of pruebas.fallidos.slice(0, 8)) console.log(`     ${R}✗${N} ${f}`)
  }

  // ── Cualitativo ───────────────────────────────────────────────────────────
  console.log(`\n  ${B}CALIDAD${N}   ${G}lo cualitativo, hecho contable${N}`)
  for (const q of cualidad) {
    console.log(`     ${q.ok ? V + '✓' : A + '◐'}${N} ${q.indicador.padEnd(46)} ${C}${q.valor}${N}  ${G}meta ${q.meta}${N}`)
    console.log(`        ${G}${q.porque}${N}`)
  }

  // ── Puertas ───────────────────────────────────────────────────────────────
  for (const [nombre, p] of Object.entries(puertas)) {
    const hechas = p.casillas.filter(c => c.ok).length
    const esFatal = nombre === 'DESCALIFICA'
    const col2 = esFatal ? R : hechas === p.casillas.length ? V : A
    console.log(`\n  ${B}${col2}${nombre}${N}  ${barra(hechas, p.casillas.length)}  ${hechas}/${p.casillas.length}`)
    console.log(`     ${G}${p.corte} — ${p.consecuencia}${N}`)
    for (const c of p.casillas) {
      const marca = c.ok ? `${V}✓${N}` : c.tipo === 'declarada' ? `${G}·${N}` : `${R}○${N}`
      const sufijo = c.evidencia ? ` ${G}(${c.evidencia})${N}`
                   : c.tipo === 'declarada' && !c.ok ? ` ${G}← ${c.comando}${N}` : ''
      console.log(`     ${marca} ${c.nombre}${sufijo}`)
    }
  }

  // ── El resumen honesto ────────────────────────────────────────────────────
  const totalMedidas = Object.values(puertas).flatMap(p => p.casillas).filter(c => c.tipo === 'medida')
  const totalDecl = Object.values(puertas).flatMap(p => p.casillas).filter(c => c.tipo === 'declarada')
  console.log(`\n  ${G}${totalMedidas.filter(c => c.ok).length}/${totalMedidas.length} casillas MEDIDAS por comando · ` +
              `${totalDecl.filter(c => c.ok).length}/${totalDecl.length} declaradas a mano en audit/puertas.json${N}`)
  console.log(`  ${G}una casilla medida no se puede marcar a mano. Ese es el punto de este archivo.${N}\n`)
}

main().catch(e => { console.error(e); process.exit(1) })
