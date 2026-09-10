#!/usr/bin/env node
// scripts/doctor.mjs — qué falta y cómo se arregla, en lenguaje de persona.
//
// ═══════════════════════════════════════════════════════════════════════════
//   Un error que no dice qué escribir en su lugar obliga a abrir el README
//   a mitad de una demostración. Y quien evalúa once proyectos no lo abre:
//   cierra la pestaña.
// ═══════════════════════════════════════════════════════════════════════════
//
// Se corre ANTES de que algo falle, no después. Cada comprobación dice tres
// cosas: qué mira, qué encontró, y el comando exacto que lo arregla.
//
// No usa colores si la salida no es una terminal: quien pegue esto en un correo
// o en un ticket no debería recibir códigos de escape.
//
// PROHIBIDO aquí: importar @qvac/sdk. Verificado por scripts/verificar-frontera.mjs

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const color = process.stdout.isTTY
const c = (x) => color ? x : ''
const V = c('\x1b[0;32m'), R = c('\x1b[0;31m'), A = c('\x1b[0;33m')
const C = c('\x1b[0;36m'), G = c('\x1b[0;90m'), B = c('\x1b[1m'), N = c('\x1b[0m')

const leer = (r) => { try { return readFileSync(join(RAIZ, r), 'utf8') } catch { return '' } }

const revisiones = [

  { que: 'Node, la versión',
    mirar: () => {
      const [may] = process.versions.node.split('.').map(Number)
      return may >= 20
        ? { ok: true, dice: `v${process.versions.node}` }
        : { ok: false, dice: `v${process.versions.node}, y hace falta v20 o superior`,
            arreglo: 'Instala Node desde https://nodejs.org y vuelve a intentarlo' }
    } },

  { que: 'las librerías instaladas',
    mirar: () => {
      if (!existsSync(join(RAIZ, 'node_modules'))) {
        return { ok: false, dice: 'no están',
                 arreglo: 'npm ci        (necesita internet, y solo esta vez)' }
      }
      return { ok: true, dice: 'instaladas' }
    } },

  { que: 'la versión del SDK',
    mirar: () => {
      let declarada
      try { declarada = JSON.parse(leer('package.json')).dependencies?.['@qvac/sdk'] } catch { /* sin package */ }
      if (!declarada) return { ok: true, dice: 'este proyecto no lo declara' }
      try {
        const v = createRequire(join(RAIZ, 'ia/extraer.mjs'))('@qvac/sdk/package.json').version
        return v === declarada
          ? { ok: true, dice: v }
          : { ok: false, dice: `instalada ${v}, declarada ${declarada}`,
              arreglo: 'npm ci        (la delegación existe en 0.18.2 y NO en 0.19.0)' }
      } catch {
        // Que no esté NO es un fallo: el sistema entero corre sin él. Eso es la
        // frontera 95/5, y decirlo aquí evita que alguien lo lea como avería.
        return { ok: true, dice: 'sin instalar — el sistema funciona igual, salvo la extracción con modelo' }
      }
    } },

  { que: 'los expedientes de ejemplo',
    mirar: () => {
      const dir = join(RAIZ, 'datos')
      const n = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.jsonl')).length : 0
      return n
        ? { ok: true, dice: `${n} expediente(s)` }
        : { ok: false, dice: 'ninguno — la pantalla saldría vacía',
            arreglo: 'npm run demo  (los crea en menos de un segundo)' }
    } },

  { que: 'el esquema del dominio',
    mirar: () => {
      try {
        const e = JSON.parse(leer('instancias/banca/esquema.json'))
        const criticos = (e.campos_criticos ?? []).length
        const roles = Object.keys(e.roles ?? {}).filter(r => !r.startsWith('$')).length
        return { ok: true, dice: `${criticos} campos críticos · ${roles} roles` }
      } catch {
        return { ok: false, dice: 'no se pudo leer',
                 arreglo: 'Comprueba instancias/banca/esquema.json — tiene que ser JSON válido' }
      }
    } },

  { que: 'el puerto 7301',
    mirar: () => {
      // Si algo ya escucha ahí, `npm start` arranca y no se ve nada nuevo — el
      // error de Node por puerto ocupado es de los que no dicen qué hacer.
      try {
        execFileSync('curl', ['-sf', '-o', '/dev/null', '-m', '1', 'http://127.0.0.1:7301/api/expedientes'],
                     { stdio: 'pipe' })
        return { ok: false, dice: 'ya hay algo escuchando ahí',
                 arreglo: 'Cierra la otra ventana, o arranca en otro: node ui/servidor.mjs --puerto 7302' }
      } catch { return { ok: true, dice: 'libre' } }
    } }
]

console.log(`\n  ${B}${C}REVISIÓN${N}   ${G}qué falta, y el comando que lo arregla${N}\n`)

let problemas = 0
for (const r of revisiones) {
  let res
  try { res = r.mirar() } catch (e) { res = { ok: false, dice: e.message, arreglo: null } }
  if (!res.ok) problemas++
  console.log(`  ${res.ok ? V + '✓' : R + '✗'}${N} ${B}${r.que.padEnd(28)}${N} ${G}${res.dice}${N}`)
  if (!res.ok && res.arreglo) console.log(`      ${C}${res.arreglo}${N}`)
}

console.log()
if (problemas === 0) {
  console.log(`  ${V}${B}Todo listo.${N}  ${G}npm start  →  http://127.0.0.1:7301${N}\n`)
} else {
  console.log(`  ${A}${B}${problemas} cosa(s) por resolver${N}  ${G}arriba está el comando de cada una${N}\n`)
}
process.exit(0)
