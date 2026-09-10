#!/usr/bin/env node
// malla/proveedor.mjs — EL EQUIPO DE LA SUCURSAL. El que tiene la GPU.
//
// ═══════════════════════════════════════════════════════════════════════════
//   Publica su capacidad de inferencia a los pares de la organización.
//   Nadie sale a internet. No hay servidor. No hay cuenta.
// ═══════════════════════════════════════════════════════════════════════════
//
// ── ESTA ES LA VÍA NATIVA DEL SDK ──────────────────────────────────────────
//
// El repositorio lleva DOS caminos de delegación a propósito, y no es
// indecisión: son dos pilas de red distintas, y la red de una sucursal real
// puede dejar pasar una y bloquear la otra.
//
//   · malla/motor.mjs + campo.mjs → Protomux sobre un bootstrap DHT propio.
//     El par de campo NO tiene ni el SDK: 203 MB en vez de 4,8 GB.
//
//   · ESTE + consumidor.mjs → startQVACProvider, el hyperswarm del propio SDK.
//     El par de campo SÍ tiene el SDK, pero NO descarga el modelo.
//
// Decir cuál es cuál importa: el argumento de los dos NO es el mismo, y
// confundirlos en el video sería vender más de lo que hay.
//
// ── VERIFICADO, NO SUPUESTO ────────────────────────────────────────────────
//
// `startQVACProvider` existe en @qvac/sdk 0.18.2 y NO existe en 0.19.0.
// Comprobado importando el módulo en las dos versiones el 10-sep-2026. Es la
// razón entera por la que este proyecto fija 0.18.2 en package.json, y está
// autorizado por la organización.
//
// ── USO ────────────────────────────────────────────────────────────────────
//
//   node malla/proveedor.mjs                      identidad nueva cada arranque
//   node malla/proveedor.mjs --semilla <64 hex>   identidad REPRODUCIBLE
//   node malla/proveedor.mjs --semilla <hex> --solo <clave del consumidor>
//
// Imprime la clave pública. Eso es lo único que el otro equipo necesita.

// El import es DINÁMICO para poder dar un mensaje útil cuando el SDK no está.
// Con import estático, quien clone el repo y ejecute esto sin `npm install` ve
// un stack trace de Node en vez de una instrucción. La primera impresión de un
// juez no se gasta en un ERR_MODULE_NOT_FOUND.
let startQVACProvider, stopQVACProvider
try {
  ({ startQVACProvider, stopQVACProvider } = await import('@qvac/sdk'))
} catch {
  console.error('\n  \x1b[0;31mNo se encontró @qvac/sdk.\x1b[0m')
  console.error('  \x1b[0;90mEjecuta primero:  npm install\x1b[0m\n')
  process.exit(1)
}

if (typeof startQVACProvider !== 'function') {
  console.error('\n  \x1b[0;31mEste SDK no trae startQVACProvider.\x1b[0m')
  console.error('  \x1b[0;90mLa delegación existe en 0.18.2 y NO en 0.19.0. Comprueba la versión:')
  console.error('  node -p "require(\'@qvac/sdk/package.json\').version"\x1b[0m\n')
  process.exit(1)
}

const argv = process.argv.slice(2)
const arg = (n, d = null) => { const i = argv.indexOf('--' + n); return i === -1 ? d : argv[i + 1] }

const V = '\x1b[0;32m', R = '\x1b[0;31m', A = '\x1b[0;33m'
const C = '\x1b[0;36m', G = '\x1b[0;90m', B = '\x1b[1m', N = '\x1b[0m'

// ── La identidad ────────────────────────────────────────────────────────────
//
// Sin semilla, la clave pública CAMBIA en cada arranque. Para el video eso es
// fatal: no se puede repetir una toma si el identificador que sale en pantalla
// es distinto cada vez. Con semilla, la identidad es la misma siempre.
const semilla = arg('semilla')
if (semilla) {
  if (!/^[0-9a-f]{64}$/i.test(semilla)) {
    console.error(`\n  ${R}La semilla debe ser exactamente 64 caracteres hexadecimales.${N}`)
    console.error(`  ${G}Genera una:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"${N}\n`)
    process.exit(1)
  }
  process.env.QVAC_HYPERSWARM_SEED = semilla
}

// ── El cortafuegos ──────────────────────────────────────────────────────────
//
// `--solo <clave>` restringe el proveedor a UN consumidor concreto. Sin esto,
// cualquiera que conozca la clave pública puede pedir inferencia.
//
// Es la respuesta honesta a la pregunta difícil sobre delegación: el ámbito es
// UNA organización con pares conocidos, no un mercado abierto de cómputo. Y el
// que ejecuta la inferencia descifra el prompt en su máquina — eso no es un
// fallo, es cómo funciona la delegación, y por eso el cortafuegos importa.
const solo = arg('solo')

console.log(`\n  ${B}PROVEEDOR${N}   ${G}el equipo de la sucursal, el que tiene la GPU${N}`)
console.log(`  ${G}${semilla ? 'identidad reproducible por semilla' : 'identidad nueva (usa --semilla para fijarla)'}${N}`)
if (solo) console.log(`  ${A}cortafuegos: solo se atiende a ${solo.slice(0, 16)}…${N}`)
else      console.log(`  ${A}⚠ sin cortafuegos: cualquiera con la clave pública puede pedir inferencia${N}`)

try {
  const t0 = Date.now()
  const respuesta = await startQVACProvider(
    solo ? { firewall: { mode: 'allow', publicKeys: [solo] } } : {}
  )

  if (!respuesta?.publicKey) {
    console.error(`\n  ${R}El proveedor arrancó sin devolver clave pública.${N}`)
    console.error(`  ${G}${respuesta?.error ?? 'sin detalle'}${N}\n`)
    process.exit(1)
  }

  console.log(`\n  ${V}✓ proveedor en marcha${N}  ${G}(${Date.now() - t0} ms)${N}`)
  console.log(`\n  ${B}CLAVE PÚBLICA${N}`)
  console.log(`  ${C}${respuesta.publicKey}${N}`)
  console.log(`\n  ${B}En el otro equipo:${N}`)
  console.log(`  ${G}node malla/consumidor.mjs --proveedor ${respuesta.publicKey} \\${N}`)
  console.log(`  ${G}     --texto "El titular es Juan Pérez, cédula 8-123-456."${N}`)

  console.log(`\n  ${A}La PRIMERA conexión tarda entre 15 y 45 segundos.${N}`)
  console.log(`  ${G}Lo dice el propio SDK: arrancar hyperdht y localizar esta clave no es`)
  console.log(`  instantáneo en un DHT frío. Las siguientes son de menos de un segundo.`)
  console.log(`  Si el otro lado aborta antes de 45 s, no es que falle: es que no esperó.${N}`)
  console.log(`\n  ${G}Ctrl+C para parar${N}\n`)

  const parar = async (senal) => {
    console.log(`\n  ${G}parando (${senal})…${N}`)
    try { await stopQVACProvider() } catch { /* ya estaba parado */ }
    process.exit(0)
  }
  process.once('SIGINT', () => parar('SIGINT'))
  process.once('SIGTERM', () => parar('SIGTERM'))
  process.stdin.resume()
} catch (e) {
  console.error(`\n  ${R}✗ no arrancó: ${e.message}${N}`)
  console.error(`  ${G}Comprueba que @qvac/sdk sea la 0.18.2: en 0.19.0 esta función NO existe.`)
  console.error(`  node -p "require('@qvac/sdk/package.json').version"${N}\n`)
  process.exit(1)
}
