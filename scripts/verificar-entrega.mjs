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

import { readdirSync, readFileSync, statSync, existsSync, lstatSync, readlinkSync } from 'node:fs'
import { join, relative, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

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

puerta('la declaración de base preexistente está COMPLETA', () => {
  // ── LO QUE ESTA PUERTA IMPIDE, Y ES ELIMINATORIO ─────────────────────────
  //
  // El artículo 11c descalifica si la base preexistente no está declarada. La
  // puerta de al lado comprueba que la SECCIÓN existe; esta comprueba que no
  // esté rellena de humo.
  //
  // Había una fila que decía «*(pesos de los modelos)* | *(pendiente)*». La
  // sección existía, la puerta pasaba, y la declaración no declaraba nada: el
  // componente más pesado del proyecto —1,19 GiB de modelo— figuraba como
  // pendiente. La puerta de placeholders tampoco lo veía, porque busca `{{ }}`
  // y esto era otra forma de decir lo mismo.
  //
  // Es el mismo patrón que ya nos mordió cuatro veces: **buscar un texto donde
  // hacía falta mirar el contenido.**
  //
  // Fuera de esta sección, «(pendiente)» es legítimo — el vídeo aún no existe y
  // el cronometraje del setup no se ha hecho, y decirlo es lo correcto.
  const md = readFileSync(join(RAIZ, 'README.md'), 'utf8')
  const i = md.search(/##\s*Base preexistente/i)
  if (i === -1) return { ok: false, detalle: 'no hay sección de base preexistente' }
  const seccion = md.slice(i, md.indexOf('\n## ', i + 3) === -1 ? md.length : md.indexOf('\n## ', i + 3))
  // Y sí: la primera versión de esta comprobación buscaba 'TODO' con
  // `.toLowerCase().includes()`, así que la palabra española «todo» la hacía
  // fallar. **Quinta aparición del mismo patrón en este proyecto** —buscar un
  // texto donde hace falta mirar el contenido—, y esta vez dentro de la propia
  // puerta escrita para cazarlo. Se deja escrito porque el patrón es el
  // hallazgo, no el fallo suelto.
  const humo = [
    { pat: /\(pendiente\)/i,        nombre: '(pendiente)' },
    { pat: /\bTODO\b/,              nombre: 'TODO' },      // mayúsculas y palabra entera
    { pat: /\bTBD\b/i,              nombre: 'TBD' },
    { pat: /\bpor definir\b/i,      nombre: 'por definir' },
    { pat: /\bXXX\b/,               nombre: 'XXX' }
  ].filter(h => h.pat.test(seccion)).map(h => h.nombre)
  return {
    ok: humo.length === 0,
    detalle: humo.length ? `la declaración contiene: ${humo.join(', ')}` : ''
  }
}, 'declarar «pendiente» es no declarar, y el art. 11c descalifica por eso')

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

puerta('el SDK instalado es el que declara package.json', () => {
  // ── LO QUE ESTA PUERTA IMPIDE ────────────────────────────────────────────
  //
  // `startQVACProvider` y `stopQVACProvider` existen en @qvac/sdk 0.18.2 y NO
  // existen en 0.19.0 — comprobado leyendo los exports de las dos versiones,
  // no supuesto. Toda la delegación del proyecto depende de esa diferencia.
  //
  // Y Node resuelve por CERCANÍA, no por lo que diga el package.json: un
  // `node_modules` dentro de una subcarpeta sombrea al de la raíz sin avisar.
  // Aquí mismo pasa: malla/node_modules trae una 0.19.0 que gana sobre la
  // 0.18.2 declarada, y el proveedor se niega a arrancar con un mensaje que
  // parece un fallo del código cuando es un fallo del entorno.
  //
  // No se puede depurar eso en cámara. Por eso es una puerta y no un comentario.
  const pkg = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8'))
  const declarada = (pkg.dependencies ?? {})['@qvac/sdk']
  if (!declarada) return { ok: true, detalle: 'el proyecto no declara @qvac/sdk' }

  // Desde qué archivos se importa de verdad. Cada uno resuelve por su cuenta.
  const puntos = ['ia/extraer.mjs', 'malla/proveedor.mjs', 'malla/consumidor.mjs', 'malla/motor.mjs']
  const req = createRequire(import.meta.url)
  const vistos = []
  for (const punto of puntos) {
    const abs = join(RAIZ, punto)
    if (!existsSync(abs)) continue
    try {
      const v = createRequire(abs)('@qvac/sdk/package.json').version
      if (v !== declarada) vistos.push(`${punto} → ${v}`)
    } catch (e) {
      // Que no esté instalado NO es un fallo de entrega: el núcleo entero corre
      // sin el SDK, y eso es la frontera 95/5, no un descuido. `npm ci` lo trae.
      if (e.code === 'MODULE_NOT_FOUND') continue
      // ERR_PACKAGE_PATH_NOT_EXPORTED significa que SÍ hay un paquete ahí, pero
      // no deja leer su package.json: se mira el directorio a mano.
      try {
        const nm = join(dirname(abs), 'node_modules', '@qvac')
        const dir = join(nm, 'sdk', 'package.json')
        if (existsSync(dir)) {
          const v = JSON.parse(readFileSync(dir, 'utf8')).version
          if (v !== declarada) {
            // Decir DE DÓNDE sale la versión intrusa, no solo cuál es: si el
            // node_modules es un enlace a otro proyecto, el mensaje «tienes la
            // 0.19.0» manda a buscar donde no está. Aquí lo era, y apuntaba
            // fuera del repositorio.
            const donde = lstatSync(nm).isSymbolicLink()
              ? `enlace → ${readlinkSync(nm)}`
              : 'node_modules propio'
            vistos.push(`${punto} → ${v} (${donde})`)
          }
        }
      } catch { /* sin información: no se inventa un veredicto */ }
    }
  }
  return {
    ok: vistos.length === 0,
    detalle: vistos.length ? `declarada ${declarada}, pero ${vistos.join(' · ')}` : ''
  }
}, 'la delegación existe en 0.18.2 y NO en 0.19.0. Un node_modules de subcarpeta gana sin avisar')

puerta('existe package-lock.json y `npm ci` puede correr', () => {
  // CAZADO CRONOMETRANDO EL CLON LIMPIO, que es exactamente para lo que sirve
  // ese ejercicio. El README manda `npm ci` y no había lockfile en el repo:
  // el juez se estrellaba en el paso 2 de la instalación con un EUSAGE.
  //
  // Y no es solo que `npm ci` lo exija: sin lockfile, la integridad SHA-512 de
  // cada paquete no viaja con el repo, y «@qvac/sdk fijado exacto» pasa a ser
  // una intención en vez de una garantía.
  const p = join(RAIZ, 'package-lock.json')
  if (!existsSync(p)) return { ok: false, detalle: 'no existe package-lock.json: `npm ci` falla con EUSAGE' }
  try {
    const lock = JSON.parse(readFileSync(p, 'utf8'))
    if (!(lock.lockfileVersion >= 1)) return { ok: false, detalle: `lockfileVersion ${lock.lockfileVersion}` }
    const sdk = lock.packages?.['node_modules/@qvac/sdk']
    if (sdk && sdk.version !== '0.18.2') {
      return { ok: false, detalle: `el lock trae @qvac/sdk ${sdk.version}, y debe ser 0.18.2` }
    }
    return { ok: true, detalle: '' }
  } catch (e) { return { ok: false, detalle: `lockfile ilegible: ${e.message}` } }
}, 'el README manda `npm ci`; sin lockfile el juez se estrella en el paso 2')

puerta('todo `npm run` apunta a un archivo que existe', () => {
  // Un comando prometido en el README que revienta con ENOENT delante de quien
  // evalúa vale menos que no haberlo prometido. `npm run setup` apuntaba a un
  // scripts/setup.sh que no existía, y `start` y `audit:all` igual.
  const pkg = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8'))
  const rotos = []
  for (const [nombre, cmd] of Object.entries(pkg.scripts ?? {})) {
    for (const m of String(cmd).matchAll(/(?:^|\s)((?:scripts|ui|core|ia|malla)\/[\w./-]+\.(?:mjs|js|sh))/g)) {
      if (!existsSync(join(RAIZ, m[1]))) rotos.push(`${nombre} → ${m[1]}`)
    }
  }
  return { ok: rotos.length === 0, detalle: rotos.join(', ') }
}, 'un npm run que revienta con ENOENT delante del jurado vale menos que no prometerlo')

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

puerta('el banco de casos trampa se comporta como se declaró', () => {
  // Los tests prueban el código; esto prueba que el sistema hace lo que el
  // archivo de casos DICE que va a hacer. Un auditor puede leer ese .json sin
  // saber JavaScript y comprobarlo con un comando.
  try {
    const salida = execFileSync(process.execPath, ['scripts/casos.mjs'],
      { cwd: RAIZ, encoding: 'utf8', timeout: 180_000 })
    const m = /(\d+)\/(\d+) casos se comportan/.exec(salida.replace(/\x1b\[[0-9;]*m/g, ''))
    const sinCubrir = /sin caso que las ejercite:\s*([^\n]*)/.exec(salida.replace(/\x1b\[[0-9;]*m/g, ''))
    if (sinCubrir) return { ok: false, detalle: `guardias sin caso: ${sinCubrir[1].trim()}` }
    return { ok: Boolean(m) && m[1] === m[2], detalle: m ? `${m[1]}/${m[2]}` : 'no se pudo leer el resultado' }
  } catch (e) { return { ok: false, detalle: (e.stdout ?? e.message).slice(-160) } }
}, 'una guardia sin un caso que la ejercite es una guardia que nadie ha visto trabajar')

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
