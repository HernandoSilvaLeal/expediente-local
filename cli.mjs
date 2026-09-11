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
//   node cli.mjs ver | csv | constancia | verificar | hechos
//   node cli.mjs aprobar --oficial "..." --texto "..."  |  rechazar --oficial "..."
//
// Opciones comunes:  --expediente EXP-001  --ledger datos/EXP-001.jsonl
//                    --esquema instancias/banca/esquema.json

import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

import { cargarEsquema } from './core/esquema.mjs'
import { abrirExpediente, aCsv, constancia } from './core/expediente.mjs'
import { leer as leerLedger } from './core/ledger.mjs'
import { cargarDominio } from './scripts/cargar-dominio.mjs'

// ── UNA BANDERA DESCONOCIDA NO PUEDE SER UN STACK TRACE ───────────────────
//
// `parseArgs` lanza ERR_PARSE_ARGS_UNKNOWN_OPTION y Node imprime el volcado
// entero. Lo encontró una auditoría adversarial escribiendo `--motivo`, que es
// el nombre natural para «por qué rechazas esto» y que este mismo archivo
// llegó a documentar. Quien lo teclea no recibe una corrección: recibe seis
// líneas de tripas de Node.
//
// `--motivo` se acepta como alias de `--texto` porque es lo que la gente
// escribe, y cualquier otra bandera desconocida sale con una frase.
const ALIAS = { '--motivo': '--texto' }
const argv = process.argv.slice(2).map(a => {
  const [nombre, ...resto] = a.split('=')
  return ALIAS[nombre] ? [ALIAS[nombre], ...resto].join('=') : a
})

const OPCIONES = {
    texto:      { type: 'string' },
    archivo:    { type: 'string' },
    extraccion: { type: 'string' },
    esquema:    { type: 'string', default: 'instancias/banca/esquema.json' },
    expediente: { type: 'string', default: 'EXP-001' },
    ledger:     { type: 'string' },
    modelo:     { type: 'string' },
    proveedor:  { type: 'string' },   // clave pública del par que tiene la GPU
    oficial:    { type: 'string' },   // quién firma. Sin esto no se aprueba ni se rechaza
    campo:      { type: 'string' },   // qué campo se resuelve
    valor:      { type: 'string' },   // cuál de los dos valores en disputa gana
    salida:     { type: 'string' },
    hoy:        { type: 'string' },   // fija el reloj: ver abajo
    json:       { type: 'boolean', default: false },
    ayuda:      { type: 'boolean', default: false, short: 'h' }
}

let op, positionals
try {
  ;({ values: op, positionals } = parseArgs({ args: argv, allowPositionals: true, options: OPCIONES }))
} catch (e) {
  // El mensaje de Node es un volcado; el de aquí dice qué escribir en su lugar.
  const suelta = /'([^']+)'/.exec(e.message)?.[1] ?? 'esa'
  process.stderr.write(
    `\n  \x1b[0;31m✗ No conozco la opción ${suelta}\x1b[0m\n` +
    `  \x1b[0;90mLas que hay: ${Object.keys(OPCIONES).map(o => '--' + o).join(' · ')}\x1b[0m\n` +
    `  \x1b[0;90mY --motivo vale como --texto.  node cli.mjs --ayuda\x1b[0m\n\n`)
  process.exit(1)
}

// Los colores se declaran AQUÍ, antes del primer uso, y no más abajo.
//
// Estaban después de `abrirExpediente`, así que `node cli.mjs` a secas —lo
// primero que escribe cualquiera que llega al repo— reventaba con
// «ReferenceError: Cannot access 'B' before initialization»: la zona muerta
// temporal de `const`. La primera impresión del proyecto era un stack trace.
const V = '\x1b[0;32m', R = '\x1b[0;31m', A = '\x1b[0;33m'
const C = '\x1b[0;36m', G = '\x1b[0;90m', B = '\x1b[1m', N = '\x1b[0m'

const comando = positionals[0]
if (!comando || op.ayuda) { ayuda(); process.exit(comando ? 0 : 1) }

const esquema = cargarEsquema(op.esquema)
const ruta = op.ledger ?? `datos/${op.expediente}.jsonl`

// ── SI EL LEDGER YA EXISTE, ÉL DICE DE QUIÉN ES ──────────────────────────
//
// `--expediente` tiene un valor por defecto para que los ejemplos del README
// funcionen sin escribirlo. Ese valor por defecto, combinado con un --ledger
// explícito de OTRO expediente, era una trampa silenciosa:
//
//   node cli.mjs aprobar --ledger datos/EXP-003.jsonl
//                        ↑ el ledger es de EXP-003, el id por defecto es EXP-001
//
// El núcleo ahora lo rechaza (ver core/expediente.mjs), pero rechazar con un
// error no es lo que quiere quien escribió ese comando: quiere aprobar EXP-003.
// Así que aquí el id se DEDUCE del ledger, y el error del núcleo queda como
// red de seguridad para cuando se pasen los dos y no coincidan.
const idDelLedger = leerLedger(ruta).find(e => e.expediente)?.expediente
if (idDelLedger && op.expediente !== idDelLedger) {
  // Se pasó --expediente Y no coincide: eso es un dedo equivocado, no un atajo.
  if (process.argv.includes('--expediente')) {
    console.error(`\n  ${R}✗ El ledger «${ruta}» es de ${idDelLedger}, ` +
                  `y --expediente dice ${op.expediente}${N}\n`)
    process.exit(1)
  }
  op.expediente = idDelLedger
}

// ── EL RELOJ SE PUEDE FIJAR, Y HACE FALTA ────────────────────────────────
//
// Las guardias de vigencia comparan contra HOY. Con el reloj del sistema, un
// expediente de ejemplo que hoy se aprueba deja de aprobarse dentro de tres
// meses, sin que nadie haya tocado nada: los datos de demostración CADUCAN SOLOS.
//
// Ya pasó: el dictado de ejemplo llevaba una fecha de marzo y en septiembre el
// mismo comando que antes terminaba en APROBADO empezó a rechazarse por
// documento vencido. Quien clone este repositorio dentro de seis meses vería
// una demostración rota y pensaría que el proyecto no funciona.
//
//   --hoy 2026-09-01    fija el día para que la demostración sea reproducible
//
// Sin la bandera se usa el reloj real, que es lo correcto en uso normal.
const hoy = op.hoy ? new Date(`${op.hoy}T12:00:00Z`) : new Date()
if (op.hoy && Number.isNaN(hoy.getTime())) {
  console.error(`\n  ✗ --hoy debe tener la forma AAAA-MM-DD, y llegó "${op.hoy}"\n`)
  process.exit(1)
}

// Las reglas de negocio las declara el ESQUEMA y las carga quien arranca.
// `core/` nunca las importa: ver scripts/cargar-dominio.mjs.
const dominio = await cargarDominio(esquema, { hoy })

const exp = abrirExpediente({
  ruta, esquema, id: op.expediente,
  guardiasDominio: dominio.revisar,
  guardiasRegistro: dominio.revisarRegistro,
  contextoDominio: dominio.contexto
})


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
    case 'constancia': return imprimirConstancia()
    case 'verificar':  return verificar()
    case 'hechos':     return hechos()
    case 'resolver':   return resolverConflicto()
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
    delegate: op.proveedor ? { providerPublicKey: op.proveedor } : null,
    // ── EL PRESUPUESTO DE TOKENS SALE DEL ESQUEMA, NO DE UNA CORAZONADA ──────
    //
    // Con el valor por defecto el modelo se quedaba sin tokens a mitad del JSON
    // y devolvía una cadena sin cerrar. El diagnóstico era engañoso —«devolvió
    // algo que no es JSON válido»— cuando el JSON iba bien y lo que faltaba era
    // sitio para terminarlo.
    //
    // Un número fijo aquí volvería a romperse el día que el esquema crezca, que
    // es justo lo que pasó: el artículo 18 subió los campos críticos de 2 a 19.
    // Así que se calcula: cada campo cuesta su valor más su cita, y una cita es
    // una frase del documento. ~110 tokens por campo, con suelo generoso.
    predict: op.predict ? Number(op.predict) : Math.max(700, esquema.camposCriticos.length * 110)
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

/**
 * La constancia: lo que un oficial le entrega a su supervisor.
 *
 * `csv` es para una máquina; esto es para una persona que tiene que justificar
 * una decisión ante otra persona. Son dos audiencias y dos formatos, y fundirlos
 * habría dado algo que no sirve del todo a ninguna.
 */
function imprimirConstancia () {
  const texto = constancia(exp.leer(), esquema)
  if (op.salida) { writeFileSync(op.salida, texto + '\n'); console.log(`\n  ${V}✓${N} ${op.salida}\n`) }
  else console.log(texto)
}

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

// ═══════════════════════════════════════════════════════════════════════════
//  resolver — ⭐ la salida del conflicto, y solo la tiene una persona
// ═══════════════════════════════════════════════════════════════════════════

function resolverConflicto () {
  const e = exp.leer()
  const abiertos = e.conflictos ?? []

  // Sin --campo, se enseña qué hay que resolver y con qué comando. Un error que
  // no dice cuál es el siguiente comando obliga a leer el README a mitad de una
  // demostración, y eso es tiempo muerto delante de quien está evaluando.
  if (!op.campo) {
    if (!abiertos.length) {
      console.log(`\n  ${G}No hay ningún conflicto abierto en ${e.id}.${N}\n`)
      return
    }
    console.log(`\n  ${B}${A}⚔ ${abiertos.length === 1 ? 'UN CONFLICTO ABIERTO' : `${abiertos.length} CONFLICTOS ABIERTOS`}${N}` +
                `   ${G}elige una persona, y queda firmado${N}`)
    for (const c of abiertos) {
      console.log(`\n     ${A}⚔${N} ${B}${c.ruta}${N}`)
      console.log(`        ${C}«${c.asentado}»${N}   ${G}← ${c.citaAsentada}${N}`)
      console.log(`        ${C}«${c.propuesto}»${N}   ${G}← ${c.citaPropuesta}${N}`)
      console.log(`\n        ${G}node cli.mjs resolver --ledger ${ruta} \\${N}`)
      console.log(`        ${G}  --campo ${c.ruta} --valor "${c.asentado}" \\${N}`)
      console.log(`        ${G}  --oficial "quién" --texto "qué documento lo respalda"${N}`)
    }
    console.log()
    return
  }

  const tras = exp.resolver(op.campo, {
    valor: op.valor, oficial: op.oficial ?? null, motivo: op.texto ?? null
  })
  const r = tras.resoluciones.at(-1)
  console.log(`\n  ${V}✓${N} ${B}${r.ruta}${N} queda como ${C}«${r.valor}»${N}`)
  console.log(`     ${G}descartado: «${r.descartado}»${N}`)
  console.log(`     ${G}${r.oficial}  ·  «${r.motivo}»${N}`)
  const quedan = (tras.conflictos ?? []).length
  console.log(quedan
    ? `\n  ${A}quedan ${quedan} conflictos por resolver${N}\n`
    : `\n  ${G}sin conflictos abiertos: el expediente ya puede cerrarse${N}\n`)
}

function decidir (que) {
  const e = exp.decidir(que, { motivo: op.texto ?? null, oficial: op.oficial ?? null })
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

  // ── QUIÉN FIRMÓ. Es la primera pregunta de una auditoría ────────────────
  const firma = (e.decisiones ?? []).at(-1)
  if (firma) {
    console.log(`\n  ${B}${firma.que === 'aprobar' ? V : R}✍ ${firma.que.toUpperCase()}${N}` +
                `  ${C}${firma.oficial ?? '—'}${N}`)
    console.log(`     ${G}${firma.ts}${firma.motivo ? `  ·  «${firma.motivo}»` : ''}${N}`)
  }

  const conflictos = e.conflictos ?? []
  if (conflictos.length) {
    console.log(`\n  ${B}${A}⚔ DOS FUENTES SE CONTRADICEN${N}   ${G}el sistema NO elige: decide una persona${N}`)
    for (const c of conflictos) {
      console.log(`     ${A}⚔${N} ${c.ruta}`)
      console.log(`        ${G}asentado:  «${c.asentado}»  ←  ${c.citaAsentada}${N}`)
      console.log(`        ${G}propuesto: «${c.propuesto}»  ←  ${c.citaPropuesta}${N}`)
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
     ${C}aprobar${N}  --oficial "quién" --texto "motivo"  ${G}solo una persona puede${N}
     ${C}rechazar${N} --oficial "quién" --texto "motivo"  ${G}quién y por qué: los dos${N}

  ${B}COMUNES${N}  --expediente EXP-001 · --ledger datos/x.jsonl · --hoy 2026-09-10
            --esquema instancias/banca/esquema.json · --json
            ${C}--hoy AAAA-MM-DD${N}  ${G}fija el día, para que una demo no caduque sola${N}

  ${G}Todos los comandos menos 'capturar' funcionan SIN el SDK instalado.${N}
  ${G}No es una optimización: es la frontera 95/5 comportándose.${N}
`)
}
