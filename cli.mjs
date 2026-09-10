#!/usr/bin/env node
// cli.mjs — la puerta de entrada.
//
// ═══════════════════════════════════════════════════════════════════════════
//   Todos los comandos menos UNO corren sin el SDK instalado.
//   Ese uno es `capturar`, y por eso el SDK se importa DINÁMICAMENTE.
// ═══════════════════════════════════════════════════════════════════════════
//
// No es una optimización de arranque: es la frontera 95/5 hecha comportamiento.
// Un juez puede clonar el repo, no descargar ni un modelo, y aun así:
//
//     node cli.mjs revisar   ← el flujo completo, con extracción de fichero
//     node cli.mjs ver       ← el expediente deducido del ledger
//     node cli.mjs csv       ← el dataset con su columna de auditoría
//     node cli.mjs verificar ← ¿alguien tocó el archivo a mano?
//
// Si el import fuese estático, nada de esto arrancaría sin 4,8 GB de modelo.
//
// Uso:
//   node cli.mjs capturar  --texto "..." [--modelo <ruta>] [--proveedor <clave>]
//   node cli.mjs revisar   --texto "..." --extraccion salida-del-modelo.json
//   node cli.mjs ver | csv | verificar | hechos
//   node cli.mjs aprobar --motivo "..."  |  rechazar --motivo "..."
//
// Opciones comunes:  --expediente EXP-001  --ledger datos/EXP-001.jsonl
//                    --esquema instancias/banca/esquema.json

import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

import { cargarEsquema } from './core/esquema.mjs'
import { abrirExpediente, aCsv } from './core/expediente.mjs'
import { cargarDominio } from './scripts/cargar-dominio.mjs'

const { values: op, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    texto:      { type: 'string' },
    archivo:    { type: 'string' },
    extraccion: { type: 'string' },
    esquema:    { type: 'string', default: 'instancias/banca/esquema.json' },
    expediente: { type: 'string', default: 'EXP-001' },
    ledger:     { type: 'string' },
    modelo:     { type: 'string' },
    proveedor:  { type: 'string' },   // clave pública del par que tiene la GPU
    salida:     { type: 'string' },
    json:       { type: 'boolean', default: false },
    ayuda:      { type: 'boolean', default: false, short: 'h' }
  }
})

const comando = positionals[0]
if (!comando || op.ayuda) { ayuda(); process.exit(comando ? 0 : 1) }

const esquema = cargarEsquema(op.esquema)
const ruta = op.ledger ?? `datos/${op.expediente}.jsonl`

// Las reglas de negocio las declara el ESQUEMA y las carga quien arranca.
// `core/` nunca las importa: ver scripts/cargar-dominio.mjs.
const dominio = await cargarDominio(esquema, { hoy: new Date() })

const exp = abrirExpediente({
  ruta, esquema, id: op.expediente,
  guardiasDominio: dominio.revisar,
  contextoDominio: dominio.contexto
})

const V = '\x1b[0;32m', R = '\x1b[0;31m', A = '\x1b[0;33m'
const C = '\x1b[0;36m', G = '\x1b[0;90m', B = '\x1b[1m', N = '\x1b[0m'

try {
  await ejecutar(comando)
} catch (e) {
  console.error(`\n  ${R}✗ ${e.message}${N}\n`)
  process.exit(1)
}

async function ejecutar (cmd) {
  switch (cmd) {
    case 'capturar':   return capturar()
    case 'revisar':    return revisar()
    case 'ver':        return ver()
    case 'csv':        return csv()
    case 'verificar':  return verificar()
    case 'hechos':     return hechos()
    case 'aprobar':    return decidir('aprobar')
    case 'rechazar':   return decidir('rechazar')
    default:
      throw new Error(`Comando desconocido: "${cmd}". Prueba: node cli.mjs --ayuda`)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  capturar — EL ÚNICO que necesita el modelo
// ═══════════════════════════════════════════════════════════════════════════

async function capturar () {
  const texto = leerTexto()
  if (!op.modelo) throw new Error('capturar necesita --modelo <ruta al .gguf>')

  // ⬇ EL IMPORT DINÁMICO. Todo lo demás del CLI funciona sin esta línea, y esa
  //   es exactamente la frontera 95/5 comportándose, no afirmándose.
  const { crearExtractor } = await import('./ia/extraer.mjs')

  const extractor = crearExtractor({
    modelSrc: op.modelo,
    delegate: op.proveedor ? { providerPublicKey: op.proveedor } : null
  })

  try {
    console.log(`\n  ${G}capturando…${op.proveedor ? ' (delegado en un par)' : ''}${N}`)
    exp.capturar(texto)

    const { objeto, stats } = await extractor.extraer(texto, esquema)
    console.log(`  ${G}el modelo propuso en ${stats.paredMs} ms · ${stats.tokS ?? '?'} tok/s` +
                `${stats.frio ? ' (arranque en frío, no cuenta para la mediana)' : ''}${N}`)

    const { revision } = exp.asentar(objeto)
    pintar(exp.leer(), revision)
  } finally {
    await extractor.cerrar()
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  revisar — el mismo flujo, con la extracción venida de un fichero
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Existe por dos razones, y las dos importan:
 *
 *   1. Un juez sin GPU puede ver el sistema entero funcionando.
 *   2. Separa lo estocástico de lo determinista **en la línea de comandos**:
 *      la misma extracción, revisada dos veces, da exactamente lo mismo. Eso
 *      es un `diff` vacío que se puede enseñar en cámara.
 */
function revisar () {
  const texto = leerTexto()
  if (!op.extraccion) throw new Error('revisar necesita --extraccion <archivo.json>')

  let propuesto
  try { propuesto = JSON.parse(readFileSync(op.extraccion, 'utf8')) }
  catch (e) { throw new Error(`No se pudo leer la extracción: ${e.message}`) }

  exp.capturar(texto)
  const { revision } = exp.asentar(propuesto)
  pintar(exp.leer(), revision)
}

// ═══════════════════════════════════════════════════════════════════════════
//  Los que solo leen
// ═══════════════════════════════════════════════════════════════════════════

function ver () { pintar(exp.leer()) }

function csv () {
  const salida = aCsv(exp.leer())
  if (op.salida) { writeFileSync(op.salida, salida + '\n'); console.log(`\n  ${V}✓${N} ${op.salida}\n`) }
  else console.log(salida)
}

function verificar () {
  const v = exp.verificar()
  if (op.json) return console.log(JSON.stringify(v, null, 2))
  console.log(v.intacta
    ? `\n  ${V}✓ cadena íntegra${N} — ${v.eventos} hechos encadenados, ninguno alterado\n`
    : `\n  ${R}✗ CADENA ROTA en el hecho #${v.rotoEn}${N}\n    ${v.causa}\n`)
  if (!v.intacta) process.exit(1)
}

function hechos () {
  const hs = exp.hechos()
  if (op.json) return console.log(JSON.stringify(hs, null, 2))
  console.log('')
  for (const h of hs) {
    console.log(`  ${G}#${String(h.seq).padStart(3)}${N} ${h.ts.slice(11, 19)} ` +
                `${C}${h.tipo.padEnd(16)}${N} ${G}${h.origen}${h.motivo ? ` · ${h.motivo}` : ''}${N}`)
  }
  console.log('')
}

function decidir (que) {
  const e = exp.decidir(que, { motivo: op.texto ?? null })
  console.log(`\n  ${V}✓${N} ${que} · el expediente queda en ${B}${e.estado}${N}\n`)
}

// ═══════════════════════════════════════════════════════════════════════════
//  La salida
// ═══════════════════════════════════════════════════════════════════════════

function pintar (e, revision) {
  if (op.json) return console.log(JSON.stringify(e, null, 2))

  console.log(`\n  ${B}${e.id}${N}   estado: ${C}${e.estado}${N}` +
              (e.duplicadoDe ? `   ${A}duplicado de ${e.duplicadoDe}${N}` : ''))

  const campos = Object.entries(e.campos)
  if (campos.length) {
    console.log(`\n  ${B}LO QUE ENTRÓ AL EXPEDIENTE${N}   ${G}cada valor con la cita que lo sostiene${N}`)
    for (const [ruta, c] of campos) {
      console.log(`     ${badge(c.evidencia)} ${ruta.padEnd(26)} ${C}${c.valor}${N}`)
      if (c.cita) console.log(`        ${G}«${c.cita}»${N}`)
    }
  }

  const huecos = Object.entries(e.huecos ?? {})
  if (huecos.length) {
    console.log(`\n  ${B}LO QUE NO ENTRÓ, Y POR QUÉ${N}   ${G}un hueco explicado vale más que un dato inventado${N}`)
    for (const [ruta, h] of huecos) {
      console.log(`     ${R}○${N} ${ruta.padEnd(26)} ${G}${h.guardias.join(', ')} · ${h.motivos.join(', ')}${N}`)
    }
  }

  if (revision) {
    const r = revision.resumen
    console.log(`\n  ${G}${r.aceptados} campos anclados · ${r.rechazados} rechazados` +
                `${r.faltanCriticos.length ? ` · faltan críticos: ${r.faltanCriticos.join(', ')}` : ''}${N}`)
  }
  console.log(`\n  ${G}${e.resumen.eventos} hechos en el ledger · ` +
              `node cli.mjs verificar comprueba que nadie los tocó${N}\n`)
}

/** Los cuatro grados, para que la máquina de estados se entienda sin explicarla. */
function badge (grado) {
  return grado === 'Confirmado' ? `${V}●${N}`
       : grado === 'Reportado'  ? `${C}●${N}`
       : grado === 'Estimado'   ? `${A}●${N}`
       : `${G}○${N}`
}

function leerTexto () {
  if (op.texto) return op.texto
  if (op.archivo) return readFileSync(op.archivo, 'utf8')
  throw new Error('Falta el texto de entrada: usa --texto "…" o --archivo ruta.txt')
}

function ayuda () {
  console.log(`
  ${B}expediente-local${N} — admisión de expedientes con toda la inferencia en el dispositivo

  ${B}COMANDOS${N}
     ${C}capturar${N}    --texto "…" --modelo <ruta>     ${G}el único que carga un modelo${N}
                 [--proveedor <clave pública>]    ${G}delegar en otro dispositivo${N}
     ${C}revisar${N}     --texto "…" --extraccion x.json ${G}el mismo flujo, SIN modelo${N}
     ${C}ver${N}                                         ${G}el expediente, deducido del ledger${N}
     ${C}csv${N}         [--salida dataset.csv]          ${G}con columna de auditoría${N}
     ${C}verificar${N}                                   ${G}¿alguien tocó el archivo a mano?${N}
     ${C}hechos${N}                                      ${G}el ledger, hecho a hecho${N}
     ${C}aprobar${N}  --texto "motivo"                   ${G}solo una persona puede${N}
     ${C}rechazar${N} --texto "motivo"                   ${G}el motivo es obligatorio${N}

  ${B}COMUNES${N}  --expediente EXP-001 · --ledger datos/x.jsonl
            --esquema instancias/banca/esquema.json · --json

  ${G}Todos los comandos menos 'capturar' funcionan SIN el SDK instalado.${N}
  ${G}No es una optimización: es la frontera 95/5 comportándose.${N}
`)
}
