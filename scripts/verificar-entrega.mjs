#!/usr/bin/env node
// scripts/verificar-entrega.mjs — LO QUE DESCALIFICA, COMPROBADO POR COMANDO.
//
// ═══════════════════════════════════════════════════════════════════════════
//   Cada comprobación de aquí corresponde a algo que, por sí solo, anula
//   todo el trabajo. No son avisos: son puertas.
// ═══════════════════════════════════════════════════════════════════════════
//
// Se corre TRES veces: a T-6 h, a T-2 h y a T-0:30. Si no da PASS, no se entrega.
//
// ── POR QUÉ NO ES UN `grep` ────────────────────────────────────────────────
//
// Ya nos pasó dos veces en este proyecto: el `grep` de la frontera marcó una
// fuga que estaba dentro de un comentario, y la comparación de unidades aceptaba
// cualquier cita porque `normalizar('$')` da cadena vacía. Un verificador con
// falsos positivos es un verificador que se aprende a ignorar, y el día que
// avise de verdad nadie lo va a mirar.
//
// Así que aquí:
//   · las rutas absolutas se buscan en CÓDIGO, no dentro del propio comando
//     que las busca (este archivo se excluye a sí mismo, y lo dice)
//   · la lista negra distingue la jerga interna del nombre OFICIAL del track:
//     «Sovereign Intelligence at the Edge» es el track 03 del hackathon, y
//     marcarlo sería un falso positivo que enseña a ignorar el aviso

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const rel = (p) => relative(RAIZ, p)

/** Este archivo habla de lo que busca, así que no puede buscarse a sí mismo. */
const AUTOEXCLUIDO = ['scripts/verificar-entrega.mjs', 'scripts/metricas.mjs']

/**
 * Jerga interna que NO puede aparecer en el repo público.
 * Cada patrón lleva por qué está, porque una lista negra sin motivos se copia
 * mal y se amplía peor.
 */
const LISTA_NEGRA = Object.freeze([
  { re: /\bappcors\b/i,   por: 'nombre de la empresa: no pinta nada en este repo' },
  { re: /\bqinbix\b/i,    por: 'producto interno' },
  { re: /\bbraincors\b/i, por: 'producto interno' },
  { re: /\bcorsbuild\b/i, por: 'producto interno' },
  { re: /\bbasti[oó]n\b/i, por: 'jerga interna de organización' },
  { re: /\bcoronel(es)?\b/i, por: 'jerga interna de organización' },
  { re: /\btriaxis\b/i,   por: 'jerga interna' },
  { re: /\bvibranio\b/i,  por: 'jerga interna' },
  { re: /\bjarvisq\b/i,   por: 'proyecto de referencia ajeno al reto' },
  // `SOVEREIGN` en mayúsculas y solo, es el protocolo interno.
  // «Sovereign Intelligence» es el NOMBRE OFICIAL del track 03 y es legítimo.
  { re: /\bSOVEREIGN\b(?!\s+Intelligence)/, por: 'protocolo interno (el track 03 sí puede nombrarse)' },
  { re: /hackQVAC/,       por: 'ruta del repositorio de trabajo, que no se publica' },
  { re: /_contextInit|_metahack|_victoryPlan/, por: 'directorios del corpus privado' }
])

const EXTENSIONES = /\.(mjs|js|json|md|sh|html|css|txt|csv)$/

function archivos (dir, acc = []) {
  let entradas
  try { entradas = readdirSync(dir) } catch { return acc }
  for (const e of entradas) {
    if (e === 'node_modules' || e === '.git' || e === 'datos') continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) archivos(p, acc)
    else if (EXTENSIONES.test(e)) acc.push(p)
  }
  return acc
}

// ═══════════════════════════════════════════════════════════════════════════
//  Las puertas
// ═══════════════════════════════════════════════════════════════════════════

const puertas = []
const puerta = (nombre, fn, porque) => puertas.push({ nombre, fn, porque })

puerta('cero rutas absolutas de esta máquina', () => {
  const malos = []
  for (const a of archivos(RAIZ)) {
    if (AUTOEXCLUIDO.includes(rel(a))) continue
    const src = readFileSync(a, 'utf8')
    src.split('\n').forEach((l, i) => {
      if (/(?:^|['"`\s(=])\/(?:home|Users|root)\//.test(l)) malos.push(`${rel(a)}:${i + 1}`)
    })
  }
  return { ok: malos.length === 0, detalle: malos.slice(0, 6).join('  ·  ') }
}, 'el clon del juez revienta y no dice por qué. Ya casi pasa: malla/motor.mjs la tenía cableada')

puerta('cero jerga interna en el repo público', () => {
  const malos = []
  for (const a of archivos(RAIZ)) {
    if (AUTOEXCLUIDO.includes(rel(a))) continue
    const src = readFileSync(a, 'utf8')
    for (const { re, por } of LISTA_NEGRA) {
      const m = re.exec(src)
      if (m) malos.push(`${rel(a)}: "${m[0]}" (${por})`)
    }
  }
  return { ok: malos.length === 0, detalle: malos.slice(0, 6).join('  ·  ') }
}, 'el corpus contiene análisis de los rivales: filtrarlo roza el código de conducta')

puerta('cero placeholders sin rellenar', () => {
  const malos = []
  for (const a of archivos(RAIZ).filter(x => x.endsWith('.md'))) {
    const src = readFileSync(a, 'utf8')
    if (/\{\{[^}]*\}\}/.test(src)) malos.push(rel(a))
  }
  return { ok: malos.length === 0, detalle: malos.join(', ') }
}, 'un README con {{PENDIENTE}} dice que el trabajo no se terminó')

puerta('README con sección de base preexistente', () => {
  if (!existsSync(join(RAIZ, 'README.md'))) return { ok: false, detalle: 'no hay README' }
  const src = readFileSync(join(RAIZ, 'README.md'), 'utf8')
  const tiene = /base preexistente|preexisting|pre-existing/i.test(src)
  return { ok: tiene, detalle: tiene ? '' : 'falta la sección exigida por el art. 11c' }
}, 'ART. 11c: no declarar la base preexistente DESCALIFICA')

puerta('LICENSE presente', () =>
  ({ ok: existsSync(join(RAIZ, 'LICENSE')), detalle: '' }),
'sin licencia el jurado no puede evaluar el repo con seguridad')

puerta('todas las dependencias declaradas están fijadas', () => {
  const pkg = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8'))
  const sueltas = Object.entries(pkg.dependencies ?? {})
    .filter(([, v]) => /^[\^~]|^\*|^latest$/.test(v))
    .map(([k, v]) => `${k}@${v}`)
  return { ok: sueltas.length === 0, detalle: sueltas.join(', ') }
}, 'un ^ resuelve a otra versión en la máquina del juez. Nosotros necesitamos 0.18.2 EXACTA')

puerta('los tests deterministas pasan', () => {
  try {
    execFileSync('npm', ['test'], { cwd: RAIZ, stdio: 'ignore', timeout: 180_000 })
    return { ok: true, detalle: '' }
  } catch { return { ok: false, detalle: 'npm test falla' } }
}, 'un repo con tests en rojo se lee como abandonado')

puerta('la frontera 95/5 aguanta', () => {
  try {
    execFileSync(process.execPath, ['scripts/verificar-frontera.mjs'],
      { cwd: RAIZ, stdio: 'ignore', timeout: 60_000 })
    return { ok: true, detalle: '' }
  } catch { return { ok: false, detalle: 'core/ importa el SDK' } }
}, 'es la afirmación central del proyecto: si no se sostiene, no se dice')

puerta('el smoke sale con JSON válido', () => {
  try {
    const salida = execFileSync(process.execPath, ['scripts/smoke.mjs'],
      { cwd: RAIZ, encoding: 'utf8', timeout: 120_000 })
    const json = salida.slice(salida.indexOf('{'), salida.lastIndexOf('}') + 1)
    const o = JSON.parse(json)
    return { ok: o.ok === true, detalle: o.ok ? '' : String(o.error) }
  } catch (e) { return { ok: false, detalle: e.message.slice(0, 80) } }
}, 'es lo primero que va a correr quien evalúe')

// ═══════════════════════════════════════════════════════════════════════════

const V = '\x1b[0;32m', R = '\x1b[0;31m', G = '\x1b[0;90m', B = '\x1b[1m', N = '\x1b[0m'

console.log(`\n  ${B}VERIFICACIÓN DE ENTREGA${N}   ${G}cada línea, algo que descalifica por sí solo${N}\n`)

let fallos = 0
for (const [i, p] of puertas.entries()) {
  let r
  try { r = p.fn() } catch (e) { r = { ok: false, detalle: e.message.slice(0, 80) } }
  const n = `[${String(i + 1).padStart(2)}/${puertas.length}]`
  if (r.ok) {
    console.log(`  ${G}${n}${N} ${p.nombre.padEnd(48)} ${V}PASS${N}`)
  } else {
    fallos++
    console.log(`  ${G}${n}${N} ${p.nombre.padEnd(48)} ${R}${B}FALLA${N}`)
    if (r.detalle) console.log(`         ${R}${r.detalle}${N}`)
    console.log(`         ${G}${p.porque}${N}`)
  }
}

console.log('')
if (fallos) {
  console.log(`  ${R}${B}NO SE ENTREGA${N}  ${R}${fallos} de ${puertas.length} puertas cerradas${N}`)
  console.log(`  ${G}cada una anula el trabajo entero. No son avisos.${N}\n`)
  process.exit(1)
}
console.log(`  ${V}${B}${puertas.length}/${puertas.length} PASS${N}  ${G}nada de lo que descalifica está presente${N}\n`)
