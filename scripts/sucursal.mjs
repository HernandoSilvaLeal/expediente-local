#!/usr/bin/env node
// scripts/sucursal.mjs — levanta la sucursal completa con un comando.
//
// ═══════════════════════════════════════════════════════════════════════════
//   Un comando y la sucursal está en pie: datos sembrados si faltan, servidor
//   abierto a la red local, y la dirección que hay que teclear en la tableta.
// ═══════════════════════════════════════════════════════════════════════════
//
// ── POR QUÉ NO ES `npm start` ─────────────────────────────────────────────
//
// `npm start` escucha solo en loopback, y eso está bien: un expediente bancario
// no se sirve a la red porque alguien arrancó la demostración en un café.
//
// Esto es la otra cosa: la sucursal, con sus tres dispositivos. Hay que
// escribirlo, avisa de lo que implica, y quien lo escribe sabe lo que hace.
//
// ── EL RELOJ VA FIJO, Y EN TODOS ──────────────────────────────────────────
//
// Si cada dispositivo evalúa la vigencia con su propio reloj, dos personas ven
// estados distintos del mismo expediente. Aquí se fija una vez y se hereda.
//
// PROHIBIDO aquí: importar @qvac/sdk. Verificado por scripts/verificar-frontera.mjs

import { spawnSync, spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { networkInterfaces } from 'node:os'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATOS = join(RAIZ, 'datos')

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i === -1 ? d : argv[i + 1] }

const PUERTO = arg('puerto', '7301')
const HOY = arg('hoy', '2026-09-10')

const V = '\x1b[0;32m', A = '\x1b[0;33m', C = '\x1b[0;36m'
const G = '\x1b[0;90m', B = '\x1b[1m', N = '\x1b[0m'

/** La IP que hay que teclear en la tableta. Buscarla a mano cuesta un minuto. */
function ipDeLan () {
  for (const listas of Object.values(networkInterfaces())) {
    for (const i of listas ?? []) if (i.family === 'IPv4' && !i.internal) return i.address
  }
  return '127.0.0.1'
}

// Sembrar SOLO si hace falta: si ya hay expedientes, borrarlos sería tirar el
// trabajo de quien estuviera a mitad de un ensayo.
const vacio = !existsSync(DATOS) || readdirSync(DATOS).filter(f => f.endsWith('.jsonl')).length === 0
if (vacio) {
  console.log(`\n  ${G}no hay expedientes: se siembran los tres de ejemplo…${N}`)
  const r = spawnSync('node', ['scripts/demo.mjs'], { cwd: RAIZ, stdio: 'ignore' })
  if (r.status !== 0) {
    console.error(`\n  ✗ no se pudieron sembrar los datos. Prueba: npm run demo\n`)
    process.exit(1)
  }
}

const ip = ipDeLan()
console.log(`\n  ${B}${C}SUCURSAL EN PIE${N}\n`)
console.log(`  ${B}Este equipo${N}         ${G}el modelo y los expedientes viven aquí${N}`)
console.log(`  ${B}La tableta${N}          ${C}http://${ip}:${PUERTO}${N}  ${G}→ Marta, oficial de cuenta${N}`)
console.log(`  ${B}El celular${N}          ${C}http://${ip}:${PUERTO}${N}  ${G}→ Ricardo, gerente${N}`)
console.log(`\n  ${G}Cada dispositivo elige su nombre y su rol en la cabecera.${N}`)
console.log(`  ${A}⚠ abierto a la red local · aquí no hay autenticación${N}`)
console.log(`  ${G}Ctrl+C para parar${N}\n`)

const servidor = spawn('node',
  ['ui/servidor.mjs', '--host', '0.0.0.0', '--puerto', PUERTO, '--hoy', HOY],
  { cwd: RAIZ, stdio: 'inherit' })

// Ctrl+C tiene que bajar el servidor, no dejarlo huérfano ocupando el puerto.
// Cinco servidores olvidados de pruebas anteriores ya hicieron que un marcador
// midiera el sistema equivocado.
for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, () => { servidor.kill(senal); process.exit(0) })
}
servidor.on('exit', (c) => process.exit(c ?? 0))
