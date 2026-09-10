#!/usr/bin/env node
// scripts/plata.mjs — el marcador de la fase PLATA. Se MIDE, no se declara.
//
// ═══════════════════════════════════════════════════════════════════════════
//   Un plan que se marca a mano es una lista de deseos con casillas.
//   Este archivo comprueba, uno por uno, si cada cosa está de verdad.
// ═══════════════════════════════════════════════════════════════════════════
//
// ── POR QUÉ EXISTE ────────────────────────────────────────────────────────
//
// El corpus tiene un caso propio, documentado: un frente «se autoselló
// BRONCE→DIAMANTE en 18 minutos con un CRÍTICO hallado 14 minutos antes».
// La escalera de madurez se puede falsificar, y nos pasó.
//
// La contramedida es que el porcentaje salga de comprobaciones ejecutables y no
// de la memoria de nadie. Si un ítem no se puede comprobar por código, no entra
// en el marcador: se queda en la lista de los que exigen ojo humano (§ MANUAL),
// declarados aparte y contados aparte.
//
// ── LA LEY 3 DE ATENA, APLICADA ───────────────────────────────────────────
//
// «decisión ⊥ madurez»: que algo esté DECIDIDO no es que esté HECHO. Aquí solo
// se cuenta lo hecho. Lo decidido vive en el plan, que es otro documento.
//
// PROHIBIDO aquí: importar @qvac/sdk. Verificado por scripts/verificar-frontera.mjs

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')

const leer = (r) => { try { return readFileSync(join(RAIZ, r), 'utf8') } catch { return '' } }
const hay = (r, ...patrones) => { const s = leer(r); return patrones.every(p => p instanceof RegExp ? p.test(s) : s.includes(p)) }
const npmScript = (n) => { try { return Boolean(JSON.parse(leer('package.json')).scripts?.[n]) } catch { return false } }
// La bandera `m` no es opcional: sin ella, `^test(` no encuentra nada en un
// archivo de veinticinco tests, y el marcador dice cero donde hay veinticinco.
// Un marcador que se equivoca a la baja miente igual que uno que infla.
const cuenta = (r, p) => (leer(r).match(new RegExp(p, 'gm')) ?? []).length

// ═══════════════════════════════════════════════════════════════════════════
//  LOS FRENTES · cada ítem con su comprobación, no con su casilla
// ═══════════════════════════════════════════════════════════════════════════

const FRENTES = [
  {
    id: 'F0', titulo: 'Arreglar lo roto y blindar la interfaz',
    porque: 'sin tests de interfaz, todo lo demás se construye sobre la misma arena',
    items: [
      ['F0.1', 'el bloque duplicado, fuera',
        () => cuenta('ui/index.html', 'function resaltar') === 1 &&
              cuenta('ui/index.html', 'const QUIEN') === 1],
      ['F0.2', 'suite de interfaz con ≥ 12 tests',
        () => cuenta('pruebas/ui.test.mjs', '^test\\(') >= 12]
    ]
  },
  {
    id: 'F1', titulo: 'La interfaz completa el ciclo',
    porque: 'hoy Marta tendría que abrir una terminal, y ahí se pierde a la sala',
    items: [
      ['F1.1', 'botón de aprobar/rechazar en la interfaz',
        () => hay('ui/index.html', 'api/decidir')],
      ['F1.2', 'POST /api/capturar',
        () => hay('ui/servidor.mjs', 'api/capturar')],
      ['F1.3', 'pantalla de captura',
        () => hay('ui/index.html', 'textarea')],
      ['F1.4', 'roles aplicados en el SERVIDOR',
        () => hay('ui/servidor.mjs', 'ACCION_DE_RUTA')],
      ['F1.5', 'selector de rol en pantalla',
        () => hay('ui/index.html', /id="rol"/)],
      ['F1.6', 'historial COMPLETO de firmas',
        () => hay('ui/index.html', /decisiones\.map/)]
    ]
  },
  {
    id: 'F1b', titulo: 'Lo que ya está calculado y no se pinta',
    porque: 'el servidor ya lo devuelve: solo falta enseñarlo',
    items: [
      ['F1b.1', 'bandeja del gerente (solo COMPLETO)', () => hay('ui/index.html', 'puedeCerrar')],
      ['F1b.2', 'reparto por grado de evidencia',   () => hay('ui/index.html', 'porEvidencia')],
      ['F1b.3', 'aviso de duplicados',              () => hay('ui/index.html', /d\.grupos|grupos\./)],
      ['F1b.4', 'marcar los campos críticos',       () => hay('ui/index.html', 'criticos')]
    ]
  },
  {
    id: 'F1t', titulo: 'Que los dispositivos se enteren',
    porque: 'Marta resuelve y el celular de Ricardo muestra datos viejos',
    items: [
      ['F1t.1', 'SSE en el servidor',        () => hay('ui/servidor.mjs', 'event-stream')],
      ['F1t.2', 'respaldo cableado, no idea de reserva',
        () => hay('ui/index.html', 'EventSource') && hay('ui/index.html', 'setInterval')]
    ]
  },
  {
    id: 'F1q', titulo: 'Que el celular se vea bien',
    porque: 'la tabla desborda la página entera en un teléfono',
    items: [
      ['F1q.1', 'min-width:0 — arregla el desbordamiento', () => hay('ui/index.html', /min-width:\s*0/)],
      ['F1q.2', 'tablas con scroll propio',                () => hay('ui/index.html', /overflow-x:\s*auto/)],
      ['F1q.3', 'zonas táctiles ≥ 44 px',                  () => hay('ui/index.html', /min-height:\s*44px/)],
      ['F1q.4', 'segunda media query para móvil',
        () => cuenta('ui/index.html', '@media') >= 2]
    ]
  },
  {
    id: 'F2', titulo: 'La demostración de tres dispositivos',
    porque: 'un comando y la sucursal está en pie',
    items: [
      ['F2.1', 'npm run sucursal', () => npmScript('sucursal')]
    ]
  },
  {
    id: 'F3', titulo: 'Replicable por alguien que no es técnico',
    porque: 'el panel del banco tiene perfiles de gerencia, no de ingeniería',
    items: [
      ['F3.1', 'EMPIEZA-AQUI.md de una pantalla',
        () => existsSync(join(RAIZ, 'EMPIEZA-AQUI.md')) && leer('EMPIEZA-AQUI.md').split('\n').length <= 60],
      ['F3.2', 'el README abre con qué es y para quién',
        () => /^#[^\n]*\n[\s\S]{0,900}?(para quién|Para quién|qué es)/.test(leer('README.md'))],
      ['F3.3', 'npm run doctor', () => npmScript('doctor')]
    ]
  },
  {
    id: 'F4', titulo: 'El dataset con métrica de calidad',
    porque: 'sabemos cuántos campos entran, no si el dataset es bueno',
    items: [
      ['F4.1', 'npm run calidad',              () => npmScript('calidad')],
      ['F4.2', 'la calidad, en audit/',        () => existsSync(join(RAIZ, 'audit/calidad.json'))],
      ['F4.3', 'assessModelFit — ¿corre en su hardware?',
        () => hay('ia/extraer.mjs', 'assessModelFit')]
    ]
  }
]

// ═══════════════════════════════════════════════════════════════════════════
//  LO QUE NO SE PUEDE COMPROBAR POR CÓDIGO
//
//  Va aparte y se cuenta aparte a propósito. Meterlo en el porcentaje sería
//  dejar que el marcador se marque solo — que es exactamente el fallo que este
//  archivo existe para impedir.
// ═══════════════════════════════════════════════════════════════════════════

const MANUAL = [
  ['M1', 'las pruebas de usuario U1..U6, corridas Y REPETIDAS tras arreglar'],
  ['M2', 'la escena de tres dispositivos, grabada sin cortes'],
  ['M3', 'R-01 · P2P entre dos máquinas — medido, o escrito NO MEDIDO'],
  ['M4', 'los 13 casos oficiales con su número CRUDO publicado'],
  ['M5', 'el ensayo de la ponencia, tres veces cronometradas']
]

// ═══════════════════════════════════════════════════════════════════════════

const V = '\x1b[0;32m', R = '\x1b[0;31m', A = '\x1b[0;33m'
const C = '\x1b[0;36m', G = '\x1b[0;90m', B = '\x1b[1m', N = '\x1b[0m'

const soloJson = process.argv.includes('--json')
let hechos = 0, total = 0
const informe = []

for (const f of FRENTES) {
  const resultados = f.items.map(([id, que, comprobar]) => {
    let ok = false
    try { ok = Boolean(comprobar()) } catch { ok = false }
    total++; if (ok) hechos++
    return { id, que, ok }
  })
  informe.push({ ...f, items: undefined, resultados,
                 hechos: resultados.filter(r => r.ok).length, total: resultados.length })
}

const pct = Math.round((hechos / total) * 100)

if (soloJson) {
  console.log(JSON.stringify({
    _: 'Marcador de la fase PLATA. Cada ítem se comprueba ejecutando, no se declara.',
    fecha: new Date().toISOString(),
    porcentaje: pct, hechos, total,
    frentes: informe.map(f => ({ id: f.id, titulo: f.titulo, hechos: f.hechos, total: f.total,
                                 items: f.resultados })),
    manual: MANUAL.map(([id, que]) => ({ id, que, comprobable: false })),
    comando: 'npm run plata'
  }, null, 2))
  process.exit(0)
}

const barra = (n, t, ancho = 24) => {
  const llenos = t ? Math.round((n / t) * ancho) : 0
  return (n === t ? V : n ? A : R) + '█'.repeat(llenos) + G + '░'.repeat(ancho - llenos) + N
}

console.log(`\n  ${B}${C}FASE PLATA${N}   ${G}«un banco lo pondría en producción»${N}`)
console.log(`  ${G}cada línea se comprueba ejecutando. Nada se marca a mano.${N}\n`)

for (const f of informe) {
  const col = f.hechos === f.total ? V : f.hechos ? A : R
  console.log(`  ${barra(f.hechos, f.total)}  ${col}${B}${String(f.hechos).padStart(2)}/${f.total}${N}  ${B}${f.id}${N} · ${f.titulo}`)
  for (const r of f.resultados) {
    console.log(`      ${r.ok ? V + '✓' : R + '·'}${N} ${G}${r.id.padEnd(6)}${N} ${r.ok ? '' : G}${r.que}${N}`)
  }
  if (f.hechos < f.total) console.log(`      ${G}↳ ${f.porque}${N}`)
  console.log()
}

console.log(`  ${G}────────────────────────────────────────────────────────────${N}`)
console.log(`  ${barra(hechos, total, 30)}  ${B}${pct === 100 ? V : pct >= 50 ? A : R}${pct} %${N}   ${G}${hechos} de ${total} comprobables${N}\n`)

console.log(`  ${B}Y LO QUE NINGÚN COMANDO PUEDE DECIR${N}   ${G}se cuenta aparte, o el marcador se marca solo${N}`)
for (const [id, que] of MANUAL) console.log(`      ${A}○${N} ${G}${id.padEnd(4)} ${que}${N}`)

console.log(`\n  ${G}PLATA cierra con el 100 % de arriba Y las cinco de abajo.${N}`)
console.log(`  ${G}Un criterio incumplido y declarado vale más que uno cumplido a medias.${N}\n`)
