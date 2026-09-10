#!/usr/bin/env node
// malla/consumidor.mjs — LA TABLETA DE SUCURSAL. Sin GPU y sin descargar el modelo.
//
// ═══════════════════════════════════════════════════════════════════════════
//   Pide la inferencia al equipo que está a tres metros.
//   Sin internet. Sin servidor. Sin cuenta.
// ═══════════════════════════════════════════════════════════════════════════
//
// ── LO QUE ESTE ARCHIVO DEMUESTRA, Y LO QUE NO ─────────────────────────────
//
// SÍ demuestra: que un dispositivo sin GPU y **sin los gigas del modelo** puede
// obtener extracción de calidad de un par de su propia organización, y que el
// expediente que sale de ahí pasa por las MISMAS guardias deterministas que si
// se hubiera extraído en local. La delegación no relaja ni una comprobación.
//
// NO demuestra que el dispositivo funcione sin el SDK. Aquí el SDK está
// instalado; lo que no está es el modelo. Para el caso «ni siquiera el SDK»
// existe malla/campo.mjs, que va por Protomux y pesa 203 MB.
//
// La distinción parece pequeña y no lo es: decir «el portátil no tiene nada»
// cuando tiene el SDK es vender más de lo que hay, y un jurado técnico lo
// comprueba en treinta segundos con un `ls node_modules`.
//
// ── USO ────────────────────────────────────────────────────────────────────
//
//   node malla/consumidor.mjs --proveedor <clave pública> --texto "…"
//   node malla/consumidor.mjs --proveedor <clave> --archivo dictado.txt
//
//   --sin-respaldo   falla en vez de caer a inferencia local. PARA MEDIR.
//   --espera 90000   plazo de la primera conexión (por defecto 90 s)

import { readFileSync } from 'node:fs'
import { cargarEsquema } from '../core/esquema.mjs'
import { abrirExpediente } from '../core/expediente.mjs'

const argv = process.argv.slice(2)
const arg = (n, d = null) => { const i = argv.indexOf('--' + n); return i === -1 ? d : argv[i + 1] }
const tiene = (n) => argv.includes('--' + n)

const V = '\x1b[0;32m', R = '\x1b[0;31m', A = '\x1b[0;33m'
const C = '\x1b[0;36m', G = '\x1b[0;90m', B = '\x1b[1m', N = '\x1b[0m'

const proveedor = arg('proveedor')
if (!proveedor) {
  console.error(`\n  ${R}Falta la clave pública del proveedor.${N}`)
  console.error(`  ${G}Arranca el otro equipo con: node malla/proveedor.mjs${N}\n`)
  process.exit(1)
}

const texto = arg('texto') ?? (arg('archivo') ? readFileSync(arg('archivo'), 'utf8') : null)
if (!texto) {
  console.error(`\n  ${R}Falta el texto: usa --texto "…" o --archivo dictado.txt${N}\n`)
  process.exit(1)
}

const espera = Number(arg('espera', '90000'))
const modelo = arg('modelo', process.env.EXPEDIENTE_MODELO)

// `fallbackToLocal` es cómodo en producción y VENENOSO al medir: si la
// delegación falla, el SDK infiere en local y todo parece funcionar. Se
// mediría una cosa creyendo medir otra, que es justo el error que ya
// cometimos una vez con el diagnóstico de R-01.
const respaldo = !tiene('sin-respaldo')

console.log(`\n  ${B}CONSUMIDOR${N}   ${G}sin GPU, sin descargar el modelo${N}`)
console.log(`  ${G}proveedor: ${proveedor.slice(0, 24)}…${N}`)
console.log(`  ${respaldo
  ? `${A}respaldo local ACTIVO — si la delegación falla, inferirá aquí${N}`
  : `${V}respaldo local APAGADO — si la delegación falla, esto falla. Así se mide.${N}`}`)
console.log(`\n  ${A}la primera conexión puede tardar de 15 a 45 s (DHT frío)${N}`)
console.log(`  ${G}plazo configurado: ${(espera / 1000).toFixed(0)} s${N}\n`)

const t0 = Date.now()
let extractor

try {
  // El import es dinámico por lo mismo que en cli.mjs: el resto del archivo
  // no necesita el SDK, y así el error de versión sale con un mensaje útil.
  const { crearExtractor } = await import('../ia/extraer.mjs')

  extractor = crearExtractor({
    modelSrc: modelo,
    plazoCargaMs: espera,
    delegate: {
      providerPublicKey: proveedor,
      timeout: espera,
      fallbackToLocal: respaldo
    }
  })

  const esquema = cargarEsquema('instancias/banca/esquema.json')
  const exp = abrirExpediente({ ruta: `datos/DELEGADO-${Date.now()}.jsonl`, esquema, id: 'DELEGADO-001' })

  exp.capturar(texto, { medio: 'texto' })
  console.log(`  ${G}pidiendo extracción al par…${N}`)

  const { objeto, stats } = await extractor.extraer(texto, esquema)
  const conexion = Date.now() - t0

  console.log(`\n  ${V}✓ respondió el par${N}`)
  console.log(`    ${G}conexión + extracción: ${conexion} ms · inferencia: ${stats.paredMs} ms` +
              `${stats.tokS ? ` · ${stats.tokS} tok/s` : ''}${N}`)

  // LO QUE IMPORTA: lo que llega del par NO se cree. Pasa por las mismas
  // guardias que si se hubiera extraído aquí. La delegación cambia DÓNDE se
  // infiere, no QUÉ se comprueba.
  const { revision } = exp.asentar(objeto)
  const e = exp.leer()

  console.log(`\n  ${B}Y AQUÍ SE VUELVE A COMPROBAR TODO${N}`)
  console.log(`    ${G}la delegación cambia dónde se infiere, no qué se verifica${N}`)
  console.log(`    ${revision.resumen.aceptados} campos anclados · ${revision.resumen.rechazados} rechazados`)
  for (const [ruta, c] of Object.entries(e.campos)) {
    console.log(`    ${V}●${N} ${ruta.padEnd(26)} ${C}${c.valor}${N}`)
  }
  for (const [ruta, h] of Object.entries(e.huecos ?? {})) {
    console.log(`    ${R}○${N} ${ruta.padEnd(26)} ${G}${h.guardias.join(',')} · ${h.motivos.join(',')}${N}`)
  }
  console.log(`\n  ${G}estado: ${e.estado} · ${e.resumen.eventos} hechos en el ledger${N}\n`)
} catch (e) {
  console.error(`\n  ${R}✗ ${e.message}${N}`)
  if (/Expirado|timeout/i.test(e.message)) {
    console.error(`\n  ${A}Expiró tras ${((Date.now() - t0) / 1000).toFixed(0)} s.${N}`)
    console.error(`  ${G}Antes de dar por rota la red, comprueba tres cosas:`)
    console.error(`    1. que el proveedor siga corriendo y con la MISMA clave`)
    console.error(`    2. que el plazo sea de verdad ≥ 45 s (--espera 90000)`)
    console.error(`    3. que las dos máquinas se vean: ping a la IP de la otra`)
    console.error(`  Un plazo corto se diagnostica como avería de red. Ya nos pasó.${N}`)
  }
  process.exitCode = 1
} finally {
  try { await extractor?.cerrar() } catch { /* nada que cerrar */ }
}
