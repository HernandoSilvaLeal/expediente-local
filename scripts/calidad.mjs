#!/usr/bin/env node
// scripts/calidad.mjs — ¿es BUENO el dataset que sale? No cuántos campos: cuáles.
//
// ═══════════════════════════════════════════════════════════════════════════
//   Sabíamos cuántos campos entran y cuántos se rechazan. No publicábamos
//   ninguna medida de si el resultado sirve para algo.
// ═══════════════════════════════════════════════════════════════════════════
//
// ── QUÉ SIGNIFICA «BUENO» AQUÍ, Y POR QUÉ NO ES LO OBVIO ──────────────────
//
// Lo obvio sería la COBERTURA: cuántos campos se llenaron. Pero un extractor
// que se inventa todo tiene cobertura del 100 %, así que ese número solo mide
// atrevimiento.
//
// Lo que se mide es otra cosa: de todo lo que el modelo PROPUSO, cuánto
// sobrevivió a las guardias, y con qué respaldo. Un dataset con menos campos y
// todos anclados vale más que uno lleno y sin fuente — y esa frase, dicha así,
// es discutible; por eso el número va desglosado y no resumido en uno solo.
//
// ── LO QUE ESTE ARCHIVO NO HACE ───────────────────────────────────────────
//
// No inventa un umbral de «calidad aceptable». El curso oficial de QVAC
// desaconseja los umbrales de confianza inventados, y tendría razón: un 0,8
// elegido por nosotros no significa nada para nadie. Se publican los números y
// quien evalúe pone su listón.
//
// PROHIBIDO aquí: importar @qvac/sdk. Verificado por scripts/verificar-frontera.mjs

import { readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cargarEsquema, EVIDENCIA, rutaGenerica } from '../core/esquema.mjs'
import { leer } from '../core/ledger.mjs'
import { proyectar } from '../core/proyeccion.mjs'
import { calidad } from '../core/calidad.mjs'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i === -1 ? d : argv[i + 1] }

const DATOS = join(RAIZ, arg('datos', 'datos'))
const esquema = cargarEsquema(arg('esquema', 'instancias/banca/esquema.json'))
const soloJson = argv.includes('--json')

if (!existsSync(DATOS)) {
  console.error('\n  ✗ no hay datos que medir. Prueba: npm run demo\n')
  process.exit(1)
}

const archivos = readdirSync(DATOS).filter(f => f.endsWith('.jsonl')).sort()
if (!archivos.length) {
  console.error('\n  ✗ no hay expedientes en ' + DATOS + '. Prueba: npm run demo\n')
  process.exit(1)
}

// ═══════════════════════════════════════════════════════════════════════════
//  La medición
// ═══════════════════════════════════════════════════════════════════════════

const porEvidencia = Object.fromEntries(EVIDENCIA.map(g => [g, 0]))
const porGuardia = {}
let propuestos = 0, enExpediente = 0, anclados = 0, huecos = 0, conflictos = 0
let firmados = 0, sinFirmar = 0
const expedientes = []

for (const archivo of archivos) {
  let e
  try { e = proyectar(leer(join(DATOS, archivo))) } catch { continue }

  const campos = Object.values(e.campos)
  const susHuecos = Object.values(e.huecos ?? {})
  const q = calidad(e, esquema)

  // «Propuesto» es todo lo que el modelo puso sobre la mesa: lo que entró más
  // lo que una guardia paró. Es el denominador honesto — medir solo sobre lo
  // aceptado sería preguntarle al aprobado cómo le fue el examen.
  const susPropuestos = campos.length + susHuecos.length

  // ── ESTAR EN EL EXPEDIENTE NO ES ESTAR ANCLADO ──────────────────────────
  //
  // Un campo con evidencia `Desconocido` está dentro y no tiene cita que lo
  // sostenga: el caso declarado es un enum como `documentos[].tipo`, cuya
  // defensa es G2 y no el anclaje. Contarlo como anclado inflaría la tasa con
  // campos que nadie citó — que es exactamente el número que este archivo
  // existe para no maquillar.
  const conCita = campos.filter(c => c.evidencia !== 'Desconocido')

  propuestos += susPropuestos
  enExpediente += campos.length
  anclados += conCita.length
  huecos += susHuecos.length
  conflictos += (e.conflictos ?? []).length

  for (const c of campos) porEvidencia[c.evidencia] = (porEvidencia[c.evidencia] ?? 0) + 1
  for (const h of susHuecos) for (const g of h.guardias) porGuardia[g] = (porGuardia[g] ?? 0) + 1

  const firma = (e.decisiones ?? []).at(-1)
  if (firma) firmados++; else sinFirmar++

  expedientes.push({
    id: e.id,
    estado: e.estado,
    propuestos: susPropuestos,
    enExpediente: campos.length,
    anclados: campos.filter(c => c.evidencia !== 'Desconocido').length,
    huecos: susHuecos.length,
    conflictosAbiertos: (e.conflictos ?? []).length,
    completitud: q.completitud,
    puedeCerrar: q.puedeCerrar,
    firmadoPor: firma?.oficial ?? null
  })
}

const pct = (n, d) => d ? +(100 * n / d).toFixed(1) : 0

// La tasa de anclaje: de todo lo propuesto, cuánto sobrevivió a las guardias.
// Es el número que el sector llama *grounding rate*, y usar su nombre es lo que
// permite compararnos sin traducir.
const tasaAnclaje = pct(anclados, propuestos)

// Cuánto de lo anclado está respaldado por una fuente que AFIRMA, frente a lo
// que solo se menciona o se atenúa. Dos datasets con la misma tasa de anclaje
// no valen lo mismo si uno está lleno de «parece» y el otro de «consta».
const respaldados = (porEvidencia.Confirmado ?? 0) + (porEvidencia.Reportado ?? 0)
const tasaRespaldo = pct(respaldados, anclados)

const informe = {
  _: 'Calidad del dataset producido. Mide qué sobrevive a las guardias, no cuánto se llenó.',
  fecha: new Date().toISOString(),
  dominio: esquema.dominio,
  expedientes: expedientes.length,
  propuestos,
  en_expediente: enExpediente,
  anclados,
  sin_cita_por_diseno: enExpediente - anclados,
  huecos,
  conflictosAbiertos: conflictos,
  tasa_anclaje_pct: tasaAnclaje,
  tasa_respaldo_pct: tasaRespaldo,
  por_evidencia: porEvidencia,
  parados_por_guardia: porGuardia,
  firmados,
  sin_firmar: sinFirmar,
  detalle: expedientes,
  comando: 'npm run calidad'
}

mkdirSync(join(RAIZ, 'audit'), { recursive: true })
writeFileSync(join(RAIZ, 'audit/calidad.json'), JSON.stringify(informe, null, 2) + '\n')

if (soloJson) { console.log(JSON.stringify(informe, null, 2)); process.exit(0) }

const V = '\x1b[0;32m', A = '\x1b[0;33m', C = '\x1b[0;36m'
const G = '\x1b[0;90m', B = '\x1b[1m', N = '\x1b[0m'

console.log(`\n  ${B}${C}CALIDAD DEL DATASET${N}   ${G}qué sobrevive a las guardias, no cuánto se llenó${N}\n`)
console.log(`  ${B}${String(expedientes.length).padStart(4)}${N} expedientes · ${B}${propuestos}${N} campos propuestos por el modelo\n`)

console.log(`  ${B}TASA DE ANCLAJE${N}   ${G}de lo propuesto, cuánto tenía una cita que existe${N}`)
console.log(`      ${B}${tasaAnclaje} %${N}   ${G}${anclados} con cita · ${huecos} parados por una guardia` +
            `${enExpediente - anclados ? ` · ${enExpediente - anclados} sin cita POR DISEÑO (enums)` : ''}${N}\n`)

console.log(`  ${B}TASA DE RESPALDO${N}  ${G}de lo anclado, cuánto lo AFIRMA la fuente${N}`)
console.log(`      ${B}${tasaRespaldo} %${N}   ${G}${respaldados} de ${anclados}${N}\n`)

console.log(`  ${B}POR GRADO DE EVIDENCIA${N}`)
for (const g of EVIDENCIA) {
  const n = porEvidencia[g] ?? 0
  if (!n && g === 'Desconocido') continue
  console.log(`      ${String(n).padStart(4)}  ${g.padEnd(12)} ${G}${pct(n, anclados)} %${N}`)
}

if (Object.keys(porGuardia).length) {
  console.log(`\n  ${B}QUÉ GUARDIA PARÓ QUÉ${N}   ${G}un rechazo es evidencia de que el sistema trabajó${N}`)
  for (const [g, n] of Object.entries(porGuardia).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(n).padStart(4)}  ${g}`)
  }
}

if (conflictos) console.log(`\n  ${A}${conflictos} conflicto(s) abierto(s)${N} ${G}— esperan a que una persona los zanje${N}`)
console.log(`\n  ${G}${firmados} firmados · ${sinFirmar} sin firmar${N}`)
console.log(`\n  ${G}Sin umbral de «calidad aceptable»: un 0,8 elegido por nosotros no${N}`)
console.log(`  ${G}significa nada para nadie. Los números están; el listón lo pone quien evalúa.${N}\n`)
