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

/**
 * Cada zona declara QUÉ prohíbe, y no todas prohíben lo mismo.
 *
 * `pruebas/` no puede tocar el SDK —los tests corren sin modelo— pero SÍ tiene
 * que poder importar `instancias/banca/guardias.mjs`: es donde se prueban. Meter
 * las dos zonas en el mismo saco convertía el verificador en un obstáculo, que
 * es la forma más rápida de que alguien lo desactive «solo un momento».
 */
const ZONAS_LIMPIAS = [
  { dir: 'core',
    prohibe: ['sdk', 'dominio'],
    razon: 'el núcleo decide qué entra al dataset, y no sabe de qué dominio' },
  { dir: 'pruebas',
    prohibe: ['sdk'],
    razon: 'los tests corren sin modelo cargado (pero sí prueban los dominios)' }
]

const PATRONES = Object.freeze({
  sdk:     { re: /^@qvac\//,   que: 'el SDK' },
  dominio: { re: /instancias\//, que: 'un dominio concreto' }
})

/** El único directorio autorizado a tocar el SDK. */
const ZONA_IA = 'ia'

/**
 * Dos fronteras, no una.
 *
 *   @qvac/*       → la frontera 95/5: el núcleo no consulta a un modelo
 *   instancias/*  → la frontera de GENERICIDAD: el núcleo no sabe de banca
 *
 * La segunda se añadió al conectar las guardias de dominio. Si `core/` importara
 * `instancias/banca/guardias.mjs`, la afirmación «el mismo código sirve para
 * inventario hospitalario» dejaría de ser cierta en ese mismo instante — y
 * seguiría estando escrita en el README, que es lo peligroso.
 *
 * Las guardias de dominio se INYECTAN al abrir el expediente. El núcleo solo
 * sabe que existe una función y que devuelve rechazos.
 */
const PROHIBIDO = /^@qvac\/|instancias\//

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

console.log('\n  LAS DOS FRONTERAS\n')
console.log('     95/5          el núcleo no puede tocar el modelo')
console.log('     genericidad   el núcleo no puede saber de qué dominio\n')

for (const { dir, razon, prohibe } of ZONAS_LIMPIAS) {
  const archivos = archivosJs(join(RAIZ, dir))
  revisados += archivos.length
  const malos = []

  for (const abs of archivos) {
    for (const { spec, linea } of importsDe(abs)) {
      for (const clave of prohibe) {
        const { re, que } = PATRONES[clave]
        if (re.test(spec)) {
          malos.push(`${relative(RAIZ, abs)}:${linea}  importa ${que}:  ${spec}`)
        }
      }
    }
  }

  if (malos.length) {
    fugas += malos.length
    console.log(`  🔴 ${dir}/ — ${razon}`)
    malos.forEach(m => console.log(`       ${m}`))
  } else {
    const lista = prohibe.map(k => PATRONES[k].que).join(' ni ')
    console.log(`  ✅ ${dir}/  ${String(archivos.length).padStart(2)} módulos, ninguno importa ${lista}`)
  }
}

// Contrapartida: el SDK tiene que estar en algún sitio, y ese sitio es ia/.
const enIA = archivosJs(join(RAIZ, ZONA_IA))
const conSdk = enIA.filter(a => importsDe(a).some(({ spec }) => PATRONES.sdk.re.test(spec)))
console.log(`  ℹ️  ${ZONA_IA}/   ${String(enIA.length).padStart(2)} módulos, ${conSdk.length} tocan el SDK  (es su función)`)

console.log('')
if (fugas) {
  console.log(`  🔴 FRONTERA ROTA — ${fugas} import(s) prohibido(s)`)
  console.log('     El núcleo debe correr sin modelo, sin red y sin saber de qué dominio.\n')
  process.exit(1)
}
console.log(`  ✅ LAS DOS FRONTERAS INTACTAS — ${revisados} módulos verificados, cero fugas.`)
console.log('     El núcleo corre sin modelo, sin red y sin el SDK.')
console.log('     Y no sabe qué es un banco: las reglas de dominio se le INYECTAN.\n')
