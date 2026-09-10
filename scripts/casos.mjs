#!/usr/bin/env node
// scripts/casos.mjs — corre el banco de casos trampa y publica la tabla.
//
// ═══════════════════════════════════════════════════════════════════════════
//   Una guardia sin un caso que la ejercite es una guardia que nadie ha
//   visto trabajar. Aquí cada una tiene el suyo.
// ═══════════════════════════════════════════════════════════════════════════
//
// La diferencia con `npm test`: los tests prueban unidades y casos de uso; esto
// recorre un BANCO DE CASOS declarado en un `.json`, que se puede leer sin saber
// JavaScript. Un auditor abre `instancias/banca/seed/casos.json`, ve qué se
// esperaba de cada uno, corre este comando y compara.
//
// Los marcados `medido: true` no son inventados: son salidas reales del modelo.
//
// Uso:
//   npm run casos                 la tabla
//   npm run casos -- --detalle    además, cada rechazo con su guardia y motivo
//   npm run casos -- --json       para otro programa

import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { cargarEsquema, rutaGenerica } from '../core/esquema.mjs'
import { abrirExpediente } from '../core/expediente.mjs'
import { cargarDominio } from './cargar-dominio.mjs'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const V = '\x1b[0;32m', R = '\x1b[0;31m', A = '\x1b[0;33m'
const C = '\x1b[0;36m', G = '\x1b[0;90m', B = '\x1b[1m', N = '\x1b[0m'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i === -1 ? d : argv[i + 1] }
const detalle = argv.includes('--detalle')

const banco = JSON.parse(readFileSync(resolve(RAIZ, arg('casos', 'instancias/banca/seed/casos.json')), 'utf8'))
const esquema = cargarEsquema(arg('esquema', 'instancias/banca/esquema.json'))

// El reloj se FIJA. Sin esto, C10 —el recibo vencido— pasaría a estar vigente
// dentro de unos meses y el banco de casos empezaría a fallar solo, sin que
// nadie hubiera tocado nada. Un caso de prueba con reloj real es una bomba.
const HOY = new Date(Date.UTC(2026, 8, 10))
const dominio = await cargarDominio(esquema, { hoy: HOY, diasMaximos: 90 })

const resultados = []

for (const caso of banco.casos) {
  const dir = mkdtempSync(join(tmpdir(), 'casos-'))
  try {
    let n = 0
    const exp = abrirExpediente({
      ruta: join(dir, 'e.jsonl'), esquema, id: caso.id,
      ahora: () => `2026-09-10T12:${String(n++).padStart(2, '0')}:00.000Z`,
      guardiasDominio: dominio.revisar,
      guardiasRegistro: dominio.revisarRegistro,
      contextoDominio: dominio.contexto
    })
    exp.capturar(caso.fuente)
    const { revision } = exp.asentar(caso.extraccion)
    const e = exp.leer()

    const fallos = []
    const esperado = caso.espera ?? {}

    if (esperado.rechazados !== undefined && revision.resumen.rechazados !== esperado.rechazados) {
      fallos.push(`esperaba ${esperado.rechazados} rechazos y hubo ${revision.resumen.rechazados}`)
    }
    if (esperado.estado && e.estado !== esperado.estado) {
      fallos.push(`esperaba estado ${esperado.estado} y quedó en ${e.estado}`)
    }
    for (const ruta of esperado.rechazaAlMenos ?? []) {
      if (!e.huecos[ruta]) fallos.push(`${ruta} tenía que ser rechazado y entró`)
    }
    for (const ruta of esperado.conserva ?? []) {
      if (!e.campos[ruta]) fallos.push(`${ruta} tenía que sobrevivir y cayó`)
    }
    for (const [ruta, grado] of Object.entries(esperado.evidencia ?? {})) {
      const real = e.campos[ruta]?.evidencia
      if (real !== grado) fallos.push(`${ruta} esperaba evidencia ${grado} y tiene ${real ?? '(rechazado)'}`)
    }

    resultados.push({
      id: caso.id, titulo: caso.titulo, medido: caso.medido === true, guardia: caso.guardia ?? null,
      ok: fallos.length === 0, fallos,
      anclados: Object.keys(e.campos).length,
      huecos: Object.entries(e.huecos).map(([ruta, h]) =>
        ({ ruta, guardias: h.guardias, motivos: h.motivos })),
      estado: e.estado
    })
  } catch (err) {
    resultados.push({ id: caso.id, titulo: caso.titulo, ok: false, fallos: [`reventó: ${err.message}`], huecos: [] })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ═══════════════════════════════════════════════════════════════════════════

if (argv.includes('--json')) {
  console.log(JSON.stringify({ fecha: new Date().toISOString(), resultados }, null, 2))
  process.exit(resultados.every(r => r.ok) ? 0 : 1)
}

console.log(`\n  ${B}BANCO DE CASOS TRAMPA${N}   ${G}uno por cada forma de que un dato malo entre${N}`)
console.log(`  ${G}${banco.$datos}${N}\n`)

for (const r of resultados) {
  const marca = r.ok ? `${V}✓${N}` : `${R}✗${N}`
  const etiqueta = r.medido ? `${C}[MEDIDO]${N}` : `${G}[trampa]${N}`
  const g = r.guardia ? `${G}${r.guardia}${N}` : `${G}  ${N}`
  console.log(`  ${marca} ${r.id}  ${g}  ${r.titulo}`)
  if (!r.ok) for (const f of r.fallos) console.log(`         ${R}${f}${N}`)
  if (detalle) {
    console.log(`         ${G}${etiqueta} ${r.anclados} anclados · estado ${r.estado}${N}`)
    for (const h of r.huecos) {
      console.log(`         ${G}○ ${h.ruta.padEnd(28)} ${h.guardias.join(',')} · ${h.motivos.join(',')}${N}`)
    }
  }
}

// ── Cobertura: ¿qué guardia NO tiene un caso que la ejercite? ───────────────

const ejercitadas = new Set(resultados.flatMap(r => r.huecos.flatMap(h => h.guardias)))
const TODAS = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8']
const sinCaso = TODAS.filter(g => !ejercitadas.has(g))

console.log(`\n  ${B}COBERTURA DE GUARDIAS${N}`)
console.log(`     ${V}vistas trabajando:${N} ${[...ejercitadas].sort().join(' ')}`)
if (sinCaso.length) {
  console.log(`     ${A}sin caso que las ejercite:${N} ${sinCaso.join(' ')}`)
  console.log(`     ${G}una guardia sin caso es una guardia que nadie ha visto trabajar${N}`)
}

const verdes = resultados.filter(r => r.ok).length
const medidos = resultados.filter(r => r.medido).length
console.log(`\n  ${G}────────────────────────────────────────────${N}`)
console.log(verdes === resultados.length
  ? `  ${V}${B}${verdes}/${resultados.length} casos se comportan como se esperaba${N}`
  : `  ${R}${B}${resultados.length - verdes} de ${resultados.length} casos NO se comportan como se esperaba${N}`)
console.log(`  ${G}${medidos} de ellos son salidas REALES del modelo, no casos imaginados${N}\n`)

process.exit(verdes === resultados.length ? 0 : 1)
