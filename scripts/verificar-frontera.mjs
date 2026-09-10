#!/usr/bin/env node
// scripts/verificar-frontera.mjs
//
// LA FRONTERA 95/5, COMO TEST QUE FALLA — no como afirmación del README.
//
// `core/` es determinista por construcción: corre sin modelo, sin red y sin el SDK.
// Si algún módulo del núcleo importa @qvac/*, esto revienta con código 1.
//
// Por qué existe:
//   Un rival publicó la misma doctrina que nosotros, mejor redactada. Repetirla nos
//   deja como el eco. La diferencia no es afirmarla: es entregar el comando que la
//   comprueba. Esto es ese comando.
//
// Analiza IMPORTS REALES, no menciones en comentarios ni en cadenas de texto.
// Un verificador con falsos positivos es un verificador que se aprende a ignorar.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Directorios que deben permanecer libres del SDK, y por qué. */
const ZONAS_LIMPIAS = [
  { dir: 'core',    razon: 'el núcleo determinista decide qué entra al dataset' },
  { dir: 'pruebas', razon: 'los tests deben correr sin modelo cargado' }
]

/** El único directorio autorizado a tocar el SDK. */
const ZONA_IA = 'ia'

const PROHIBIDO = /^@qvac\//

// ── Extracción de imports, ignorando comentarios y cadenas ────────────────────

/**
 * Quita comentarios de línea, de bloque y el contenido de las cadenas,
 * conservando la longitud del texto para que los números de línea no se muevan.
 */
function desnudar (src) {
  let fuera = ''
  let i = 0
  const n = src.length
  let estado = 'codigo'   // codigo | linea | bloque | comilla | dobles | plantilla

  while (i < n) {
    const c = src[i], d = src[i + 1]

    if (estado === 'codigo') {
      if (c === '/' && d === '/') { estado = 'linea';  fuera += '  '; i += 2; continue }
      if (c === '/' && d === '*') { estado = 'bloque'; fuera += '  '; i += 2; continue }
      if (c === "'")  { estado = 'comilla';   fuera += c; i++; continue }
      if (c === '"')  { estado = 'dobles';    fuera += c; i++; continue }
      if (c === '`')  { estado = 'plantilla'; fuera += c; i++; continue }
      fuera += c; i++; continue
    }

    if (estado === 'linea') {
      if (c === '\n') { estado = 'codigo'; fuera += c } else fuera += ' '
      i++; continue
    }

    if (estado === 'bloque') {
      if (c === '*' && d === '/') { estado = 'codigo'; fuera += '  '; i += 2; continue }
      fuera += (c === '\n' ? '\n' : ' '); i++; continue
    }

    // Dentro de una cadena: se conserva, porque un import lleva su ruta entre comillas.
    const cierre = estado === 'comilla' ? "'" : estado === 'dobles' ? '"' : '`'
    if (c === '\\') { fuera += '  '; i += 2; continue }
    if (c === cierre) { estado = 'codigo' }
    fuera += c; i++
  }
  return fuera
}

/** Devuelve los especificadores importados por un archivo, con su línea. */
function importsDe (rutaAbs) {
  const src = readFileSync(rutaAbs, 'utf8')
  const limpio = desnudar(src)
  const hallazgos = []

  const patrones = [
    /\bimport\s+[^;]*?\bfrom\s*['"`]([^'"`]+)['"`]/g,  // import X from 'y'
    /\bimport\s*['"`]([^'"`]+)['"`]/g,                  // import 'y'
    /\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,        // import('y')
    /\brequire\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g        // require('y')
  ]

  for (const re of patrones) {
    let m
    while ((m = re.exec(limpio)) !== null) {
      const linea = limpio.slice(0, m.index).split('\n').length
      hallazgos.push({ spec: m[1], linea })
    }
  }
  return hallazgos
}

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

// ── Verificación ──────────────────────────────────────────────────────────────

let fugas = 0
let revisados = 0

console.log('\n  FRONTERA 95/5 — el núcleo no puede tocar el modelo\n')

for (const { dir, razon } of ZONAS_LIMPIAS) {
  const archivos = archivosJs(join(RAIZ, dir))
  revisados += archivos.length
  const malos = []

  for (const abs of archivos) {
    for (const { spec, linea } of importsDe(abs)) {
      if (PROHIBIDO.test(spec)) {
        malos.push(`${relative(RAIZ, abs)}:${linea}  importa  ${spec}`)
      }
    }
  }

  if (malos.length) {
    fugas += malos.length
    console.log(`  🔴 ${dir}/ — ${razon}`)
    malos.forEach(m => console.log(`       ${m}`))
  } else {
    console.log(`  ✅ ${dir}/  ${String(archivos.length).padStart(2)} módulos, cero importan @qvac/*`)
  }
}

// Contrapartida: el SDK tiene que estar en algún sitio, y ese sitio es ia/.
const enIA = archivosJs(join(RAIZ, ZONA_IA))
const conSdk = enIA.filter(a => importsDe(a).some(({ spec }) => PROHIBIDO.test(spec)))
console.log(`  ℹ️  ${ZONA_IA}/   ${String(enIA.length).padStart(2)} módulos, ${conSdk.length} tocan el SDK  (es su función)`)

console.log('')
if (fugas) {
  console.log(`  🔴 FRONTERA ROTA — ${fugas} import(s) del SDK fuera de ${ZONA_IA}/`)
  console.log('     El núcleo debe correr sin modelo, sin red y sin el SDK.\n')
  process.exit(1)
}
console.log(`  ✅ FRONTERA INTACTA — ${revisados} módulos verificados, cero fugas.`)
console.log('     El núcleo corre sin modelo, sin red y sin el SDK.\n')
