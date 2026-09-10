#!/usr/bin/env node
// scripts/setup.mjs — descarga los pesos. EL ÚNICO PASO QUE NECESITA RED.
//
// ═══════════════════════════════════════════════════════════════════════════
//   Después de esto, nada del sistema vuelve a salir a internet.
//   Y eso no es una promesa: `npm run test:frontera` y el smoke bajo
//   `unshare -rn` lo comprueban.
// ═══════════════════════════════════════════════════════════════════════════
//
// Se descarga por `registry://` de QVAC, no por HTTP a un bucket. Los modelos
// viajan por la red de pares del propio SDK.
//
// ── LO QUE ESTE ARCHIVO HACE Y NO SE VE ────────────────────────────────────
//
// Cronometrar. El tiempo que tarda esto en una máquina limpia es un número que
// el proyecto tiene que publicar, porque es la diferencia entre «se puede
// reproducir» y «dicen que se puede reproducir». Al terminar lo imprime y lo
// guarda en audit/setup.json.
//
// Uso:
//   npm run setup                 lo necesario para extraer (lo mínimo)
//   npm run setup -- --todo       además OCR y voz
//   npm run setup -- --listar     qué descargaría, sin descargar nada

import { writeFileSync, mkdirSync } from 'node:fs'

const V = '\x1b[0;32m', R = '\x1b[0;31m', A = '\x1b[0;33m'
const C = '\x1b[0;36m', G = '\x1b[0;90m', B = '\x1b[1m', N = '\x1b[0m'

const argv = process.argv.slice(2)
const todo = argv.includes('--todo')
const listar = argv.includes('--listar')

let sdk
try {
  sdk = await import('@qvac/sdk')
} catch {
  console.error(`\n  ${R}No se encontró @qvac/sdk.${N}`)
  console.error(`  ${G}Ejecuta primero:  npm ci${N}\n`)
  process.exit(1)
}

/**
 * Los modelos, con su papel y por qué ese y no otro.
 *
 * `esencial: false` significa que el sistema arranca y extrae sin él. Se separan
 * porque un `setup` que tarda cuarenta minutos antes de dejarte ver nada es un
 * `setup` que la gente cancela a la mitad.
 */
const MODELOS = [
  {
    clave: 'HEALTHCARE_1_7B_MEDICAL_Q4_K_M',
    papel: 'extracción de campos',
    esencial: true,
    porque: 'cuantización Q4_K_M: el equilibrio medido entre calidad y velocidad en esta clase de GPU'
  },
  {
    clave: 'OCR_LATIN',
    papel: 'lectura de documentos fotografiados',
    esencial: false,
    porque: 'determinista y con confianza POR BLOQUE, no una puntuación global inventada'
  },
  {
    clave: 'WHISPER_SMALL_Q8_0',
    papel: 'dictado por voz',
    esencial: false,
    porque: 'el oficial de sucursal habla; escribir a mano es el cuello de botella real'
  }
]

const aDescargar = MODELOS.filter(m => todo || m.esencial)

console.log(`\n  ${B}SETUP${N}   ${G}el único paso que necesita red${N}`)
console.log(`  ${G}después de esto, nada del sistema vuelve a salir a internet${N}\n`)

for (const m of aDescargar) {
  const existe = m.clave in sdk
  console.log(`  ${existe ? C + '•' : R + '✗'}${N} ${m.clave.padEnd(34)} ${G}${m.papel}${N}`)
  console.log(`      ${G}${m.porque}${N}`)
  if (!existe) {
    console.error(`\n  ${R}Este SDK no conoce "${m.clave}".${N}`)
    console.error(`  ${G}Comprueba la versión:  node -p "require('@qvac/sdk/package.json').version"`)
    console.error(`  Debe ser 0.18.2 exacta.${N}\n`)
    process.exit(1)
  }
}

if (!todo) {
  console.log(`\n  ${G}(solo lo esencial. \`npm run setup -- --todo\` añade OCR y voz)${N}`)
}

if (listar) {
  console.log(`\n  ${G}--listar: no se descargó nada${N}\n`)
  process.exit(0)
}

// ── La descarga ─────────────────────────────────────────────────────────────

const t0 = Date.now()
const registro = []

for (const m of aDescargar) {
  const tm = Date.now()
  let ultimoPorcentaje = -1
  console.log(`\n  ${B}${m.clave}${N}`)

  try {
    // `loadModel` descarga si falta y devuelve el id. Se descarga cargando, que
    // además comprueba que el peso sirve de verdad: un archivo bajado y corrupto
    // se detectaría aquí y no tres horas después, en mitad de una demo.
    const modelId = await sdk.loadModel({
      modelSrc: sdk[m.clave],
      onProgress: (p) => {
        const pct = Math.floor(p.percentage ?? 0)
        if (pct === ultimoPorcentaje) return
        ultimoPorcentaje = pct
        const mb = (n) => ((n ?? 0) / 1e6).toFixed(0)
        const linea = `      ${pct.toString().padStart(3)}%  ${mb(p.downloaded)}/${mb(p.total)} MB`
        process.stderr.write(process.stderr.isTTY ? `\r${linea}` : `${linea}\n`)
      }
    })
    if (process.stderr.isTTY) process.stderr.write('\n')

    // Se descarga y se descarga: no se deja en RAM. El setup prepara, no ejecuta.
    await sdk.unloadModel({ modelId })

    const seg = ((Date.now() - tm) / 1000).toFixed(1)
    console.log(`      ${V}✓ listo${N}  ${G}${seg} s${N}`)
    registro.push({ modelo: m.clave, papel: m.papel, segundos: Number(seg), ok: true })
  } catch (e) {
    console.error(`      ${R}✗ ${e.message}${N}`)
    registro.push({ modelo: m.clave, papel: m.papel, ok: false, error: e.message })
  }
}

try { await sdk.close() } catch { /* ya cerrado */ }

// ── El número que hay que publicar ──────────────────────────────────────────

const totalSeg = Math.round((Date.now() - t0) / 1000)
const fallos = registro.filter(r => !r.ok)

mkdirSync('audit', { recursive: true })
writeFileSync('audit/setup.json', JSON.stringify({
  fecha: new Date().toISOString(),
  perfil: todo ? 'completo' : 'esencial',
  totalSegundos: totalSeg,
  modelos: registro,
  nota: 'Tiempo medido en ESTA máquina y con ESTA red. En una máquina limpia y ' +
        'con otra conexión será distinto, y por eso el número se publica en vez de estimarse.'
}, null, 2) + '\n')

console.log(`\n  ${G}────────────────────────────────────────────${N}`)
if (fallos.length) {
  console.log(`  ${R}${B}${fallos.length} modelo(s) no se descargaron.${N}`)
  console.log(`  ${G}El núcleo determinista funciona igual: prueba \`npm test\` y \`npm run smoke\`.${N}\n`)
  process.exit(1)
}
console.log(`  ${V}${B}SETUP COMPLETO${N}   ${C}${Math.floor(totalSeg / 60)} min ${totalSeg % 60} s${N}`)
console.log(`  ${G}medido y guardado en audit/setup.json${N}`)
console.log(`\n  ${B}Siguiente:${N}  ${C}npm run smoke${N}   ${G}el flujo completo, ya sin red${N}\n`)
