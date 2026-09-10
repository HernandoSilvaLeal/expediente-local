#!/usr/bin/env node
// scripts/demo.mjs — siembra `datos/` con los tres expedientes que cuentan la historia.
//
// ═══════════════════════════════════════════════════════════════════════════
//   POR QUÉ EXISTE ESTE ARCHIVO
//
//   Se cronometró el clon limpio: 193 segundos de cero a funcionando. Y al
//   final de esos 193 segundos, `npm start` abría una PANTALLA VACÍA, porque
//   `datos/` no existe en un repositorio recién clonado.
//
//   Un jurado con once proyectos que revisar no depura una pantalla vacía:
//   cierra la pestaña. Este script convierte el primer minuto de quien llega
//   en el minuto en el que entiende el sistema entero.
// ═══════════════════════════════════════════════════════════════════════════
//
//   NO es una ruta paralela al producto: llama al MISMO `cli.mjs` con los
//   MISMOS comandos que están escritos en el README. Si el CLI se rompe, esto
//   se rompe. Es demo y es prueba de humo a la vez.
//
//   El reloj va fijo (--hoy). No es maquillaje: es que un expediente de
//   ejemplo con un recibo de servicio caduca solo a los 90 días, y una demo
//   que se pudre sola en el calendario no es una demo. La fecha se imprime en
//   pantalla para que se vea que está fijada.

import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATOS = join(RAIZ, 'datos')
const SEED = 'instancias/banca/seed'

// El día en que están fechados los seeds + tres semanas. El recibo del IDAAN
// tiene 21 días: dentro de los 90 que exige G7, y lejos del borde.
const HOY = '2026-09-10'

const V = '\x1b[0;32m', A = '\x1b[0;33m', C = '\x1b[0;36m'
const G = '\x1b[0;90m', B = '\x1b[1m', N = '\x1b[0m'

const limpiar = process.argv.includes('--limpiar')
if (limpiar && existsSync(DATOS)) rmSync(DATOS, { recursive: true })
mkdirSync(DATOS, { recursive: true })

function cli (args, titulo, explicacion) {
  console.log(`\n${B}${titulo}${N}\n${G}  ${explicacion}${N}`)
  const r = spawnSync('node', ['cli.mjs', ...args, '--hoy', HOY], {
    cwd: RAIZ, stdio: 'inherit'
  })
  // `revisar` sale con 0 aunque haya rechazos: un rechazo es un resultado
  // legítimo, no un fallo del programa. Solo un crash real (>1) nos importa.
  if (r.status !== 0 && r.status !== 1) {
    console.error(`\n  ✗ el comando falló con código ${r.status}\n`)
    process.exit(1)
  }
  return r.status
}

const leer = f => join(SEED, f)

console.log(`\n${C}${B}  EXPEDIENTE LOCAL · datos de ejemplo${N}`)
console.log(`${G}  Todo sintético y ficticio. Ninguna persona real, ningún cliente real.`)
console.log(`  Reloj fijado en ${HOY} para que el ejemplo no caduque solo.${N}`)

// ── 1 · EL EXPEDIENTE HONESTO ──────────────────────────────────────────────
// La fuente no miente, todo tiene cita, el expediente cierra y se aprueba.
cli(['revisar',
     '--expediente', 'EXP-001',
     '--texto', await archivo('dictado-01.txt'),
     '--extraccion', leer('extraccion-02-honesta.json'),
     '--ledger', join(DATOS, 'EXP-001.jsonl')],
    '1/3 · EXP-001 — la fuente dice la verdad',
    'todo campo trae su cita literal · el expediente llega a COMPLETO')

cli(['aprobar',
     '--ledger', join(DATOS, 'EXP-001.jsonl'),
     '--texto', 'Revisado en sucursal. Documentación conforme.'],
    '      ...y una persona lo aprueba',
    'el software nunca aprueba solo: aprobar es un acto humano, y queda firmado')

// ── 2 · EL EXPEDIENTE CON INVENCIONES ──────────────────────────────────────
// Mismo dictado, pero la extracción trae tres campos que nadie dijo.
cli(['revisar',
     '--expediente', 'EXP-002',
     '--texto', await archivo('dictado-01.txt'),
     '--extraccion', leer('extraccion-01-con-invenciones.json'),
     '--ledger', join(DATOS, 'EXP-002.jsonl')],
    '2/3 · EXP-002 — el modelo inventa tres campos',
    'las citas no están en la fuente · G3 los para · quedan como huecos explicados')

// ── 3 · EL CONFLICTO ENTRE FUENTES ─────────────────────────────────────────
// Dos documentos del mismo expediente, dos titulares distintos, misma cédula.
cli(['revisar',
     '--expediente', 'EXP-003',
     '--texto', await archivo('dictado-01.txt'),
     '--extraccion', leer('extraccion-02-honesta.json'),
     '--ledger', join(DATOS, 'EXP-003.jsonl')],
    '3/3 · EXP-003 — primera fuente: el formulario de apertura',
    'titular Juan Pérez González, asentado con su cita')

cli(['revisar',
     '--expediente', 'EXP-003',
     '--texto', await archivo('dictado-03-segunda-fuente.txt'),
     '--extraccion', leer('extraccion-03-fuente-discrepante.json'),
     '--ledger', join(DATOS, 'EXP-003.jsonl')],
    '      ...y ahora la carta laboral dice OTRO titular',
    'las dos citas son literales · ninguna miente · se contradicen entre ellas')

console.log(`\n${V}${B}  Tres expedientes sembrados en datos/${N}`)
console.log(`${G}     EXP-001  APROBADO      la fuente dice la verdad y alguien firmó`)
console.log(`     EXP-002  con huecos    tres invenciones paradas por G3`)
console.log(`     EXP-003  en conflicto  dos fuentes, dos titulares, decide una persona${N}`)
console.log(`\n  ${C}npm start${N}  ${G}→ http://127.0.0.1:7301${N}\n`)

async function archivo (nombre) {
  const { readFile } = await import('node:fs/promises')
  return (await readFile(join(RAIZ, SEED, nombre), 'utf8')).trim()
}
