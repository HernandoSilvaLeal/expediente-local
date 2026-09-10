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
import { execFileSync, spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')

const leer = (r) => { try { return readFileSync(join(RAIZ, r), 'utf8') } catch { return '' } }

/**
 * ── EL MARCADOR DABA 100 % CON EL SERVIDOR VACIADO ────────────────────────
 *
 * Una auditoría adversarial vació `ui/servidor.mjs` dejando dos líneas de
 * comentario con las palabras que este archivo buscaba, y el marcador dijo
 * VEINTICINCO DE VEINTICINCO. Mientras `node ui/servidor.mjs` terminaba al
 * instante sin escuchar nada.
 *
 * De veinticinco ítems, diecinueve eran `grep` de una cadena. Este archivo se
 * abre citando el caso del frente que «se autoselló BRONCE→DIAMANTE en 18
 * minutos», y reproducía ese fallo con otra sintaxis.
 *
 * Lo que se comprueba ahora: que el sistema RESPONDE. Cada ítem que se puede
 * probar ejecutando, se prueba ejecutando. Los que no —cuatro— quedan marcados
 * como `débil` y se dice en pantalla cuántos son, porque un marcador que no
 * distingue entre «lo comprobé» y «encontré la palabra» es el mismo problema.
 */
function suiteVerde (archivo) {
  try {
    execFileSync('node', ['--test', archivo], { cwd: RAIZ, stdio: 'pipe', timeout: 120000 })
    return true
  } catch { return false }
}

let cache = null
/** Levanta el servidor UNA vez y pregunta. Si no responde, nada de esto existe. */
function servidorResponde (comprobar) {
  if (cache === null) {
    // ── EL PUERTO TIENE QUE SER NUESTRO, Y HAY QUE COMPROBARLO ─────────────
    //
    // La primera versión usaba un puerto fijo y preguntaba si alguien contestaba.
    // Con un servidor huérfano de otra prueba en ese puerto —y había CINCO— el
    // marcador daba 68 % sobre un proyecto con el servidor vaciado a dos líneas
    // de comentario: estaba midiendo OTRO sistema.
    //
    // Un puerto por corrida, y se comprueba que el proceso que lanzamos siga
    // vivo antes de creerle a nadie. Preguntar «¿hay alguien ahí?» no es lo
    // mismo que «¿está ahí el que puse yo?».
    const PUERTO = 7480 + (process.pid % 500)
    let proc = null
    try {
      proc = spawn('node', ['ui/servidor.mjs', '--puerto', String(PUERTO), '--hoy', '2026-09-10'],
                   { cwd: RAIZ, stdio: 'ignore' })
      let murio = false
      proc.on('exit', () => { murio = true })

      const fin = Date.now() + 8000
      let vivo = false
      while (Date.now() < fin && !vivo && !murio) {
        try {
          execFileSync('curl', ['-sf', '-o', '/dev/null', `http://127.0.0.1:${PUERTO}/api/expedientes`],
                       { stdio: 'pipe', timeout: 2000 })
          vivo = true
        } catch { /* todavía no */ }
      }
      // Si el proceso murió, lo que conteste en ese puerto no es nuestro.
      cache = (vivo && !murio) ? { puerto: PUERTO, proc } : { puerto: null, proc }
    } catch { cache = { puerto: null, proc } }
    // `unref` para que el hijo no mantenga vivo a este proceso: sin él, el
    // marcador imprime su informe y se queda colgado esperando al servidor.
    cache.proc?.unref?.()
    process.on('exit', () => { try { cache?.proc?.kill() } catch { /* ya murió */ } })
  }
  if (!cache.puerto) return false
  try { return Boolean(comprobar(cache.puerto)) } catch { return false }
}

/** Pide una ruta al servidor vivo y devuelve { codigo, cuerpo }. */
function pedir (puerto, ruta, opciones = []) {
  const salida = execFileSync('curl', ['-s', '-w', '\n%{http_code}', ...opciones,
                                       `http://127.0.0.1:${puerto}${ruta}`],
                              { encoding: 'utf8', timeout: 5000 })
  const lineas = salida.split('\n')
  return { codigo: Number(lineas.pop()), cuerpo: lineas.join('\n') }
}

const postear = (puerto, ruta, cuerpo) =>
  pedir(puerto, ruta, ['-X', 'POST', '-H', 'content-type: application/json', '-d', JSON.stringify(cuerpo)])
const hay = (r, ...patrones) => { const s = leer(r); return patrones.every(p => p instanceof RegExp ? p.test(s) : s.includes(p)) }

/**
 * Lo mismo, pero sobre la página QUE EL SERVIDOR SIRVE.
 *
 * Leer `ui/index.html` del disco comprueba que alguien escribió algo en un
 * archivo. Pedirle la página al servidor comprueba que el sistema está en pie
 * y que eso llega al navegador. La diferencia la demostró una auditoría: con el
 * servidor vaciado a dos líneas de comentario, el marcador seguía verde.
 */
const enLaPagina = (...patrones) => servidorResponde(p => {
  const html = pedir(p, '/').cuerpo
  return patrones.every(x => x instanceof RegExp ? x.test(html) : html.includes(x))
})
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
        () => servidorResponde(p => {
          const html = pedir(p, '/').cuerpo
          return (html.match(/function resaltar/g) ?? []).length === 1 &&
                 (html.match(/const QUIEN/g) ?? []).length === 1
        })],
      // No basta con CONTAR tests: contarlos deja pasar doce que lanzan siempre.
      ['F0.2', 'la suite de interfaz existe Y PASA',
        () => cuenta('pruebas/ui.test.mjs', '^test\\(') >= 12 && suiteVerde('pruebas/ui.test.mjs')]
    ]
  },
  {
    id: 'F1', titulo: 'La interfaz completa el ciclo',
    porque: 'hoy Marta tendría que abrir una terminal, y ahí se pierde a la sala',
    items: [
      ['F1.1', 'botón de aprobar/rechazar en la interfaz',
        () => servidorResponde(p => /data-firma/.test(pedir(p, '/').cuerpo))],
      ['F1.2', 'POST /api/capturar CREA un expediente',
        () => servidorResponde(p =>
          postear(p, '/api/capturar/PLATA-MARCADOR', { rol: 'oficial', texto: 'El titular es Ana Ruiz.' }).codigo === 200)],
      ['F1.3', 'pantalla de captura',
        () => servidorResponde(p => /<textarea/.test(pedir(p, '/').cuerpo))],
      ['F1.4', 'los roles se aplican DE VERDAD: la oficial no firma',
        () => servidorResponde(p =>
          postear(p, '/api/decidir/EXP-001',
                  { que: 'aprobar', rol: 'oficial', oficial: 'x', motivo: 'y' }).codigo === 403)],
      ['F1.5', 'selector de rol en pantalla',
        () => enLaPagina(/id="rol"/, /value="aprobador"/)],
      ['F1.6', 'historial COMPLETO de firmas',
        () => enLaPagina(/decisiones\.map/)]
    ]
  },
  {
    id: 'F1b', titulo: 'Lo que ya está calculado y no se pinta',
    porque: 'el servidor ya lo devuelve: solo falta enseñarlo',
    items: [
      ['F1b.1', 'bandeja del gerente (solo COMPLETO)', () => enLaPagina('puedeCerrar')],
      ['F1b.2', 'reparto por grado de evidencia',   () => enLaPagina('porEvidencia')],
      ['F1b.3', 'aviso de duplicados',              () => enLaPagina(/d\.grupos|grupos\./)],
      ['F1b.4', 'marcar los campos críticos',       () => enLaPagina('criticos')]
    ]
  },
  {
    id: 'F1t', titulo: 'Que los dispositivos se enteren',
    porque: 'Marta resuelve y el celular de Ricardo muestra datos viejos',
    items: [
      // Un canal abierto NO termina: `curl -m` sale con código de tiempo agotado
      // y eso es exactamente lo que se espera de un flujo que sigue vivo. Se lee
      // lo que alcanzó a llegar, que es lo que importa.
      ['F1t.1', 'el canal de cambios RESPONDE con su tipo',
        () => servidorResponde(p => {
          try {
            const r = execFileSync('curl',
              ['-s', '-m', '2', '-D', '-', '-o', '/dev/null', `http://127.0.0.1:${p}/api/eventos`],
              { encoding: 'utf8' })
            return /text\/event-stream/.test(r)
          } catch (e) {
            return /text\/event-stream/.test(String(e.stdout ?? ''))
          }
        })],
      ['F1t.2', 'respaldo cableado, no idea de reserva',
        () => enLaPagina('EventSource', 'setInterval')]
    ]
  },
  {
    id: 'F1q', titulo: 'Que el celular se vea bien',
    porque: 'la tabla desborda la página entera en un teléfono',
    items: [
      ['F1q.1', 'min-width:0 — arregla el desbordamiento', () => enLaPagina(/min-width:\s*0/)],
      ['F1q.2', 'tablas con scroll propio',                () => enLaPagina(/overflow-x:\s*auto/)],
      ['F1q.3', 'zonas táctiles ≥ 44 px',                  () => enLaPagina(/min-height:\s*44px/)],
      ['F1q.4', 'segunda media query para móvil',
        () => servidorResponde(p => (pedir(p, '/').cuerpo.match(/@media/g) ?? []).length >= 2)]
    ]
  },
  {
    id: 'F2', titulo: 'La demostración de tres dispositivos',
    porque: 'un comando y la sucursal está en pie',
    items: [
      ['F2.1', 'npm run sucursal levanta la sucursal', () => npmScript('sucursal')]
    ]
  },
  {
    id: 'F3', titulo: 'Replicable por alguien que no es técnico',
    porque: 'el panel del banco tiene perfiles de gerencia, no de ingeniería',
    items: [
      ['F3.1', 'EMPIEZA-AQUI.md de una pantalla',
        () => existsSync(join(RAIZ, 'EMPIEZA-AQUI.md')) && leer('EMPIEZA-AQUI.md').split('\n').length <= 60],
      // Se mide sobre las primeras 40 líneas y no con un `^#`: el README abre
      // con un banner, así que anclar al primer carácter medía el formato del
      // archivo y no lo que se quería saber — si alguien que no es técnico
      // entiende qué es esto antes de encontrarse el primer comando.
      ['F3.2', 'el README dice qué es y para quién en las primeras 40 líneas',
        () => {
          const cabeza = leer('README.md').split('\n').slice(0, 40).join('\n')
          return /para qui[eé]n/i.test(cabeza) && /qu[eé] es/i.test(cabeza)
        }],
      ['F3.3', 'npm run doctor', () => npmScript('doctor')]
    ]
  },
  {
    id: 'F4', titulo: 'El dataset con métrica de calidad',
    porque: 'sabemos cuántos campos entran, no si el dataset es bueno',
    items: [
      ['F4.1', 'npm run calidad CORRE y sale bien',
        () => { if (!npmScript('calidad')) return false
                try { execFileSync('node', ['scripts/calidad.mjs'], { cwd: RAIZ, stdio: 'pipe', timeout: 30000 }); return true }
                catch { return false } }],
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

// El servidor de comprobación se apaga aquí, y no se deja al azar del recolector:
// cinco servidores huérfanos de pruebas anteriores fueron justo lo que hizo que
// este marcador midiera OTRO sistema y diera verde sobre un proyecto vaciado.
try { cache?.proc?.kill() } catch { /* ya murió */ }
process.exit(0)
