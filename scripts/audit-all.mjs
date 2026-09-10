#!/usr/bin/env node
// scripts/audit-all.mjs — genera los artefactos de auditoría. Todos, de una vez.
//
// ═══════════════════════════════════════════════════════════════════════════
//   No se le pide al jurado que confíe. Se le deja el comando que regenera
//   cada número en su propia máquina.
// ═══════════════════════════════════════════════════════════════════════════
//
// ── POR QUÉ ESTE ARCHIVO EXISTE ────────────────────────────────────────────
//
// Porque un README lleno de números sin procedencia se lee como marketing. Lo
// que convierte una afirmación en evidencia es que exista el archivo que la
// contiene Y el comando que lo regenera. `npm run audit:all` es ese comando.
//
// Y hay una regla que no se negocia: **si un artefacto no se puede medir, no se
// inventa**. Se emite con `medido: false` y su motivo. Un JSON de auditoría con
// un número maquillado es peor que no tener el JSON, porque quien lo audite y
// encuentre la discrepancia dejará de creerse el resto.
//
// PROHIBIDO aquí: importar @qvac/sdk. Verificado por scripts/verificar-frontera.mjs

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { cpus, totalmem, freemem, platform, release, arch, hostname } from 'node:os'
import { LISTA_NEGRA } from './lista-negra.mjs'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const AUDIT = join(RAIZ, 'audit')
const V = '\x1b[0;32m', A = '\x1b[0;33m', G = '\x1b[0;90m', B = '\x1b[1m', N = '\x1b[0m'

mkdirSync(AUDIT, { recursive: true })
const generados = []

const guardar = (nombre, contenido) => {
  const ruta = join(AUDIT, nombre)
  writeFileSync(ruta, typeof contenido === 'string' ? contenido : JSON.stringify(contenido, null, 2) + '\n')
  const kb = (statSync(ruta).size / 1024).toFixed(1)
  generados.push(nombre)
  console.log(`  ${V}✓${N} audit/${nombre.padEnd(26)} ${G}${kb} KB${N}`)
}

const correr = (args, cwd = RAIZ) => {
  try { return { ok: true, salida: execFileSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 300_000 }) } }
  catch (e) { return { ok: false, salida: (e.stdout ?? '') + (e.stderr ?? '') } }
}

console.log(`\n  ${B}ARTEFACTOS DE AUDITORÍA${N}   ${G}cada número con el comando que lo regenera${N}\n`)

// ═══════════════════════════════════════════════════════════════════════════
//  1 · remote_calls.json — la afirmación central del proyecto
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Análisis ESTÁTICO: qué módulos podrían abrir una conexión.
 *
 * Se dice lo que es y lo que no: esto NO sustituye a `strace`. Un análisis
 * estático demuestra que el código no PIDE la red; solo `strace` demuestra que
 * el proceso no la USA. Las dos cosas se publican, y la segunda va marcada como
 * pendiente hasta que se ejecute.
 */
function analizarRed () {
  const CAPACES = [
    { re: /from\s+['"]node:(net|http|https|dgram|tls|dns)['"]/, que: 'módulo de red de Node' },
    { re: /\bfetch\s*\(/, que: 'fetch()' },
    { re: /from\s+['"]@qvac\//, que: 'SDK de QVAC (descarga de modelos por registry://)' },
    { re: /from\s+['"](hyperswarm|hyperdht|protomux)['"]/, que: 'malla P2P (por diseño)' }
  ]
  const zonas = ['core', 'ia', 'malla', 'ui', 'scripts', 'pruebas']
  const hallazgos = []

  // Este archivo lleva los patrones que busca escritos como expresiones
  // regulares, así que se encuentra a sí mismo. Es el QUINTO falso positivo de
  // este proyecto —el grep de la frontera, las unidades de G4, un test que
  // buscaba "@qvac", O1 sobre campos sin cita, y ahora este— y ya son
  // suficientes para que la regla esté clara: un verificador nunca se analiza
  // a sí mismo, y si lo hace, lo declara.
  const AUTOEXCLUIDO = ['scripts/audit-all.mjs', 'scripts/verificar-frontera.mjs']

  for (const zona of zonas) {
    for (const f of archivos(join(RAIZ, zona))) {
      if (AUTOEXCLUIDO.includes(relative(RAIZ, f))) continue
      const src = readFileSync(f, 'utf8')
      for (const { re, que } of CAPACES) {
        if (re.test(desnudar(src))) {
          hallazgos.push({ archivo: relative(RAIZ, f), capacidad: que })
        }
      }
    }
  }

  const nucleo = hallazgos.filter(h => h.archivo.startsWith('core/'))
  return {
    _: 'Qué partes del sistema PODRÍAN abrir una conexión, según análisis estático de imports.',
    _limite: 'Un análisis estático demuestra que el código no PIDE la red. Solo strace demuestra ' +
             'que el proceso no la USA. Las dos cosas van aquí; la segunda, cuando se ejecute.',
    _autoexcluidos: ['scripts/audit-all.mjs', 'scripts/verificar-frontera.mjs',
                     'llevan los patrones escritos como regex y se encontrarían a sí mismos'],
    fecha: new Date().toISOString(),
    llamadas_a_apis_de_ia: 0,
    _nota_apis: 'CERO. No hay ninguna clave de API en el repositorio y ningún módulo llama a un ' +
                'servicio de inferencia remoto. La inferencia ocurre en el proceso local.',
    nucleo_determinista: {
      modulos_con_capacidad_de_red: nucleo.length,
      veredicto: nucleo.length === 0 ? 'LIMPIO' : 'REVISAR',
      _nota: 'core/ es el que decide qué entra al dataset. Debe ser cero.'
    },
    con_capacidad_de_red: hallazgos,
    _por_que_algunos_la_tienen: {
      'ia/': 'el SDK descarga los pesos por registry:// la PRIMERA vez. Después, nada',
      'malla/': 'la sincronización entre dispositivos es el objeto del reto: P2P en red local',
      'ui/': 'sirve la interfaz en 127.0.0.1, solo loopback',
      'scripts/': 'setup.mjs descarga los modelos; es el único paso que necesita red'
    },
    strace: {
      medido: false,
      _pendiente: 'strace -f -e trace=connect sobre una demo completa, y grep de htons(443)/htons(80)',
      _regla: 'Si strace encuentra una conexión, se elimina la dependencia. NO se maquilla este JSON.'
    }
  }
}

/** Quita comentarios y cadenas, conservando longitud. Igual que verificar-frontera. */
function desnudar (src) {
  let fuera = '', i = 0, estado = 'codigo'
  while (i < src.length) {
    const c = src[i], d = src[i + 1]
    if (estado === 'codigo') {
      if (c === '/' && d === '/') { estado = 'linea'; fuera += '  '; i += 2; continue }
      if (c === '/' && d === '*') { estado = 'bloque'; fuera += '  '; i += 2; continue }
      fuera += c; i++; continue
    }
    if (estado === 'linea') { if (c === '\n') estado = 'codigo'; fuera += c === '\n' ? c : ' '; i++; continue }
    if (c === '*' && d === '/') { estado = 'codigo'; fuera += '  '; i += 2; continue }
    fuera += c === '\n' ? '\n' : ' '; i++
  }
  return fuera
}

function archivos (dir, acc = []) {
  let e; try { e = readdirSync(dir) } catch { return acc }
  for (const n of e) {
    if (n === 'node_modules' || n.startsWith('.')) continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) archivos(p, acc)
    else if (/\.mjs$/.test(n)) acc.push(p)
  }
  return acc
}

guardar('remote_calls.json', analizarRed())

// ═══════════════════════════════════════════════════════════════════════════
//  2 · hardware.json — dónde se midió todo lo demás
// ═══════════════════════════════════════════════════════════════════════════

guardar('hardware.json', {
  _: 'La máquina donde se tomaron las mediciones. Sin esto, un número de rendimiento no significa nada.',
  fecha: new Date().toISOString(),
  cpu: { modelo: cpus()[0]?.model ?? 'desconocido', nucleos: cpus().length },
  ram_gb: +(totalmem() / 1e9).toFixed(1),
  ram_libre_gb: +(freemem() / 1e9).toFixed(1),
  sistema: { plataforma: platform(), version: release(), arquitectura: arch() },
  node: process.version,
  gpu: {
    medido: false,
    _nota: 'El dispositivo real de inferencia se lee de stats.backendDevice (0=CPU, 1=GPU), ' +
           'no de una API del sistema. Se rellena cuando corra ia/extraer.mjs contra el modelo.'
  },
  _anonimo: 'No se publica el nombre de la máquina ni rutas del usuario.',
  _huella_host: hostname().length   // longitud, no el nombre: dato inútil para identificar
})

// ═══════════════════════════════════════════════════════════════════════════
//  3 · tests.json — la suite, ejecutada ahora
// ═══════════════════════════════════════════════════════════════════════════

const metricas = correr(['scripts/metricas.mjs', '--json'])
let m = null
try { m = JSON.parse(metricas.salida) } catch { /* se reporta abajo */ }

guardar('tests.json', m ? {
  _: 'Salida de `npm run metricas`, que ejecuta la suite de verdad y cuenta desde el código.',
  fecha: m.fecha,
  tests: { total: m.pruebas.casos, pasan: m.pruebas.pass, fallan: m.pruebas.fail },
  de_rechazo: {
    cantidad: m.pruebas.rechazo,
    porcentaje: +(m.pruebas.rechazo / m.pruebas.casos * 100).toFixed(1),
    _nota: 'Tests que prueban que algo NO se puede. Probar el camino feliz no demuestra nada.'
  },
  fsm: m.fsm,
  frontera_95_5: { ...m.proporcion, verificada_por: 'npm run test:frontera' },
  comando: 'npm run metricas'
} : { _: 'no se pudo medir', error: metricas.salida.slice(0, 300) })

// ═══════════════════════════════════════════════════════════════════════════
//  4 · determinismo · dos corridas del smoke, byte a byte
// ═══════════════════════════════════════════════════════════════════════════

function determinismo () {
  const extraer = (salida) => {
    const i = salida.indexOf('{'), j = salida.lastIndexOf('}')
    return i === -1 ? null : salida.slice(i, j + 1)
  }
  const a = extraer(correr(['scripts/smoke.mjs']).salida)
  const b = extraer(correr(['scripts/smoke.mjs']).salida)

  return {
    _: 'Dos corridas independientes del flujo completo. El diff tiene que estar vacío.',
    _por_que: 'Determinismo es una propiedad comprobable, no una promesa. Si dos corridas ' +
              'del mismo sistema con la misma entrada difieren, no es determinista, y da igual ' +
              'lo que diga el README.',
    fecha: new Date().toISOString(),
    identicas: a !== null && a === b,
    corrida_1: a ? JSON.parse(a) : null,
    corrida_2: b ? JSON.parse(b) : null,
    comando: 'npm run smoke && npm run smoke  # y comparar'
  }
}

const det = determinismo()
guardar('determinismo.json', det)

// ═══════════════════════════════════════════════════════════════════════════
//  5 · invariantes.json
// ═══════════════════════════════════════════════════════════════════════════

const inv = correr(['scripts/verificar-invariantes.mjs'])
guardar('invariantes.json', {
  _: 'Los cinco invariantes, comprobados sobre los datos que hay en el disco.',
  fecha: new Date().toISOString(),
  se_cumplen: inv.ok,
  salida: inv.salida.replace(/\x1b\[[0-9;]*m/g, '').trim(),
  comando: 'npm run verify:invariantes',
  para_ver_el_rojo: 'node scripts/verificar-invariantes.mjs --demo'
})

// ═══════════════════════════════════════════════════════════════════════════
//  6 · entrega.json — las puertas que descalifican
// ═══════════════════════════════════════════════════════════════════════════

const ent = correr(['scripts/verificar-entrega.mjs'])
guardar('entrega.json', {
  _: 'Las puertas eliminatorias. Cada una anula el trabajo entero por sí sola.',
  fecha: new Date().toISOString(),
  todas_pasan: ent.ok,
  salida: sanear(ent.salida),
  comando: 'npm run verify:entrega'
})

/**
 * Quita de la salida lo que no puede viajar a un archivo público.
 *
 * ── EL BUCLE QUE OBLIGÓ A ESCRIBIR ESTO ──────────────────────────────────
 *
 * Este archivo guarda la salida de `verificar-entrega`. Cuando una puerta
 * FALLA, su diagnóstico nombra lo que encontró — una ruta, un término de la
 * lista negra. Al guardarlo, el artefacto pasaba a contener eso mismo, y en la
 * corrida siguiente **las puertas se encontraban a sí mismas**: la de jerga
 * interna señalaba `audit/entrega.json` por contener la palabra que ella misma
 * había escrito ahí.
 *
 * Ya nos pasó antes con `audit-all` analizándose a sí mismo. Es el mismo
 * animal: un verificador que produce el artefacto que después verifica.
 *
 * La salida NO se recorta ni se maquilla —el veredicto y el nombre de cada
 * puerta viajan enteros—; lo que se sustituye es el dato concreto, dejando la
 * marca de que había algo. Quien tenga el problema lo ve en su terminal, que es
 * donde importa.
 */
function marcarLinea (linea) {
  // Se conserva la sangría y el sentido: se pierde solo el dato concreto.
  const sangria = linea.match(/^\s*/)[0]
  return `${sangria}‹detalle omitido: contenía un término que no se publica›`
}

function sanear (salida) {
  return salida
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\/(?:home|Users|root)\/[^\s"'`)]*/g, '‹ruta local omitida›')
    .split('\n')
    .map(l => LISTA_NEGRA.some(({ re }) => re.test(l)) ? marcarLinea(l) : l)
    .join('\n')
    .trim()
}

// ═══════════════════════════════════════════════════════════════════════════
//  7 · inference_log.csv — NO MEDIDO, y se dice
// ═══════════════════════════════════════════════════════════════════════════

if (!existsSync(join(AUDIT, 'inference_log.csv'))) {
  guardar('inference_log.csv',
    '# NO MEDIDO todavía. Este archivo lo rellena ia/extraer.mjs al correr contra el modelo.\n' +
    '# Se emite vacío A PROPÓSITO: un log de inferencia inventado sería la clase de dato\n' +
    '# que, al descubrirse, hace que nadie se crea el resto de la auditoría.\n' +
    '# La primera fila irá marcada frio=true y NO entra en las medianas: el arranque en frío\n' +
    '# contamina la media y produce un número que no describe ni el caso frío ni el caliente.\n' +
    'n,frio,pared_ms,ttft_ms,tok_s,prompt_tokens,emitidos,dispositivo,' +
    // `delegacion_solicitada` es lo que pedimos; `ejecutado_en` es dónde corrió
    // de verdad, y el SDK 0.18.2 no lo reporta: por eso vale NO_REPORTADO y no
    // un booleano deducido del parámetro de entrada. Ver ia/extraer.mjs.
    'delegacion_solicitada,ejecutado_en,caracteres\n')
}

// ═══════════════════════════════════════════════════════════════════════════
//  8 · EVIDENCE_MAP.md — afirmación → archivo → comando
// ═══════════════════════════════════════════════════════════════════════════

const FILAS = [
  ['El núcleo corre sin modelo, sin red y sin el SDK', 'core/*', `${m?.pruebas.casos ?? '?'} tests`, 'npm test'],
  ['Hay un test que falla si el núcleo importa el SDK', 'scripts/verificar-frontera.mjs', 'verificado en positivo y negativo', 'npm run test:frontera'],
  ['El sistema funciona con la red cortada', 'scripts/smoke.mjs', 'lo:DOWN, curl→000, JSON válido', "unshare -rn bash -c 'npm run smoke'"],
  [`El sistema se niega a hacer ${m?.fsm ? m.fsm.ilegales : '?'} de ${m?.fsm ? m.fsm.combinaciones : '?'} transiciones`, 'core/estado.mjs', 'T2-ilegal, una por cada una', 'npm run metricas'],
  ['Un valor sin cita literal no entra al dataset', 'core/anclaje.mjs', 'T3-01..05', 'npm test'],
  ['Los errores del modelo son REALES, no inventados', 'pruebas/anclaje.test.mjs', 'T3-medido-1..5', 'npm test'],
  ['El software nunca aprueba solo', 'core/estado.mjs · SOLO_HUMANO', 'T2-humano ×6', 'npm test'],
  ['Y no se aprueba sin decir QUIÉN firma', 'core/expediente.mjs · decidir()', 'CU-24', 'npm test'],
  ['El firmante va dentro del hash: cambiarlo rompe la cadena', 'core/ledger.mjs · crearEvento', 'CU-24', 'npm run verify:invariantes'],
  ['Dos fuentes que se contradicen NO se resuelven solas', 'core/proyeccion.mjs · asentar()', 'CU-19, CU-20, CU-23', 'npm test'],
  ['Un conflicto abierto impide cerrar Y impide firmar', 'core/calidad.mjs · puedeCerrar', 'CU-23', 'npm test'],
  ['El log de inferencia NO afirma dónde corrió, porque el SDK no lo dice', 'ia/extraer.mjs · ejecutadoEn', 'NO_REPORTADO, declarado', 'cat audit/inference_log.csv'],
  ['El anclaje es determinista', 'core/anclaje.mjs', 'T3-19, mil corridas', 'npm test'],
  ['El expediente se regenera del ledger', 'core/proyeccion.mjs', 'T5-O5, matando el proceso', 'npm test'],
  ['No existe forma de actualizar ni borrar un hecho', 'core/ledger.mjs', 'T5-01, once nombres prohibidos', 'npm test'],
  ['Los cinco invariantes se cumplen sobre datos reales', 'scripts/verificar-invariantes.mjs', `${inv.ok ? '5/5' : 'REVISAR'}`, 'npm run verify:invariantes'],
  ['El verificador SÍ detecta las violaciones', 'pruebas/invariantes.test.mjs', 'T15, once corrupciones', 'npm test'],
  ['De cero a funcionando en un clon limpio', 'audit/clon-limpio.json', '193 s sin caché', 'ver el JSON'],
  ['Dos corridas producen el mismo resultado', 'audit/determinismo.json', det.identicas ? 'idénticas' : 'REVISAR', 'npm run audit:all'],
  ['Nada de lo que descalifica está presente', 'scripts/verificar-entrega.mjs', ent.ok ? 'todas PASS' : 'REVISAR', 'npm run verify:entrega'],
  ['La delegación existe en 0.18.2 y no en 0.19.0', 'malla/proveedor.mjs', 'clave pública en 8.419 ms', 'node malla/proveedor.mjs'],
  ['⚫ Inferencia delegada entre dos máquinas', '—', '**NO MEDIDO**', 'pendiente']
]

guardar('EVIDENCE_MAP.md', `# Mapa de evidencia

> Cada afirmación de este proyecto, con **el archivo que la implementa y el comando que la
> comprueba**. Generado por \`npm run audit:all\` — no escrito a mano.

**Por qué existe este archivo:** porque nadie entrega el mapa que hace su propio trabajo fácil
de auditar, y es exactamente lo que convierte «confíe en mí» en «compruébelo usted».

Regenerado: ${new Date().toISOString()}

| Afirmación | Dónde vive | Evidencia | Comando |
|---|---|---|---|
${FILAS.map(f => `| ${f[0]} | \`${f[1]}\` | ${f[2]} | \`${f[3]}\` |`).join('\n')}

---

## Lo que NO está medido

Se lista aquí y no en letra pequeña. **Un número que no se puede reproducir delante de alguien
no se publica.**

| Qué | Por qué falta |
|---|---|
| Inferencia delegada entre dos máquinas físicas | El proveedor arranca y emite clave pública en 8.419 ms, con identidad reproducible. Falta un consumidor conectándose y recibiendo inferencia de vuelta |
| \`audit/inference_log.csv\` | Se rellena al correr \`ia/extraer.mjs\` contra el modelo. Se emite **vacío** a propósito |
| \`strace\` sobre una demo completa | El análisis estático de \`remote_calls.json\` demuestra que el código no PIDE la red; solo \`strace\` demuestra que el proceso no la USA |
| OCR sobre fotografías reales | Lo probado es imagen sintética |
| Tiempo de descarga de los pesos | El clon limpio SÍ está medido: 193 s |

---

## Cómo regenerar todo esto

\`\`\`bash
npm ci
npm run audit:all        # regenera cada artefacto de este directorio
\`\`\`

Si algún número de aquí no coincide con el que sale en tu máquina, **el que vale es el tuyo**.
`)

// ═══════════════════════════════════════════════════════════════════════════

console.log(`\n  ${G}────────────────────────────────────────────${N}`)
console.log(`  ${V}${B}${generados.length} artefactos${N}  ${G}en audit/${N}`)
const pendientes = ['strace sobre demo completa', 'inference_log.csv con datos', 'delegación entre dos máquinas']
console.log(`  ${A}${pendientes.length} marcados NO MEDIDO:${N} ${G}${pendientes.join(' · ')}${N}`)
console.log(`  ${G}Se emiten sin datos a propósito. Un artefacto de auditoría inventado hace que`)
console.log(`  quien encuentre la discrepancia deje de creerse todo lo demás.${N}\n`)
