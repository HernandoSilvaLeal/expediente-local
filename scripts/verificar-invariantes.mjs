#!/usr/bin/env node
// scripts/verificar-invariantes.mjs — O1..O6 comprobados sobre los datos REALES.
//
// ═══════════════════════════════════════════════════════════════════════════
//   Los tests prueban el código con datos de test.
//   Esto prueba los DATOS que hay en el disco ahora mismo.
// ═══════════════════════════════════════════════════════════════════════════
//
// Es una distinción que importa: una suite verde con un dataset corrupto en
// producción es exactamente el escenario que un auditor teme, y el que ningún
// `npm test` detecta.
//
// ── EL PLANO DEL VIDEO ─────────────────────────────────────────────────────
//
//   node scripts/verificar-invariantes.mjs           → 5/5, verde
//   (se edita un valor del .jsonl con un editor de texto)
//   node scripts/verificar-invariantes.mjs           → ROJO, con el nombre del
//                                                       invariante, el expediente,
//                                                       el hecho exacto y la causa
//
// Un verificador que nunca se ha visto fallar no demuestra nada. Por eso lleva
// `--demo`, que hace justo eso delante de quien mire: corrompe una copia en un
// directorio temporal y enseña el rojo. Nunca toca los datos de verdad.

import { readdirSync, existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync, cpSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { cargarEsquema } from '../core/esquema.mjs'
import { leer as leerLedger, verificarCadena, EVENTO } from '../core/ledger.mjs'
import { proyectar } from '../core/proyeccion.mjs'
import { TRANSICIONES, SOLO_HUMANO, ORIGENES, esLegal } from '../core/estado.mjs'
import { anclar, nivelEvidencia, normalizar } from '../core/anclaje.mjs'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const V = '\x1b[0;32m', R = '\x1b[0;31m', A = '\x1b[0;33m'
const C = '\x1b[0;36m', G = '\x1b[0;90m', B = '\x1b[1m', N = '\x1b[0m'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i === -1 ? d : argv[i + 1] }
const DATOS = join(RAIZ, arg('datos', 'datos'))

// ═══════════════════════════════════════════════════════════════════════════
//  LOS CINCO INVARIANTES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cada uno recibe `{ id, eventos, expediente, esquema }` y devuelve una lista de
 * violaciones. Vacía significa que se cumple.
 *
 * Una violación SIEMPRE lleva `causaRaiz`: decir «está mal» sin decir qué hecho
 * lo rompió obliga a quien lo lea a repetir la investigación entera.
 */
export const INVARIANTES = Object.freeze([
  {
    id: 'O1',
    dice: 'todo campo del dataset tiene una cita que existe LITERALMENTE en su fuente',
    porque: 'es la regla de oro. Si se rompe aquí, hay un dato que nadie dijo dentro del expediente',
    comprobar ({ eventos, expediente }) {
      const fuente = expediente.fuentes.map(f => f.texto).join('\n')
      const malos = []
      for (const [ruta, c] of Object.entries(expediente.campos)) {
        // Un campo SIN CITA por diseño —un enum suelto como el tipo de documento—
        // no tiene procedencia que verificar: su defensa es G2, no el anclaje.
        // Marcarlo aquí sería un falso positivo, y este proyecto ya lleva tres:
        // el grep de la frontera, la comparación de unidades de G4 y un test que
        // buscaba "@qvac" en el fuente. Un verificador con falsos positivos es un
        // verificador que se aprende a ignorar, y el día que avise de verdad
        // nadie lo va a mirar.
        if (!c.cita) continue
        const r = anclar({ valor: c.valor, cita: c.cita }, fuente)
        if (!r.anclado) {
          malos.push({ donde: ruta, causaRaiz: `el campo está asentado pero YA NO ancla: ${r.motivo}` })
        }
      }
      return malos
    }
  },
  {
    id: 'O2',
    // NO necesita la proyección, y eso importa: un ledger con una transición
    // ilegal hace REVENTAR a proyectar(), así que si O2 dependiera de ella
    // nunca llegaría a ejecutarse y el fallo se reportaría como «no se puede
    // leer el ledger» — cierto, pero inútil. O2 mira los hechos en crudo y
    // puede nombrar la causa exacta.
    necesitaProyeccion: false,
    dice: 'ninguna transición fuera de la tabla ocurrió jamás',
    porque: 'la tabla es la política del banco. Una transición que no está en ella no la autorizó nadie',
    comprobar ({ eventos }) {
      const malos = []
      let estado = null
      for (const e of eventos) {
        if (e.tipo === EVENTO.CAPTURA && estado === null) { estado = 'CAPTURADO'; continue }
        if (e.tipo !== EVENTO.TRANSICION) continue
        const hacia = e.datos?.hacia
        if (!esLegal(estado, hacia)) {
          malos.push({ donde: `hecho #${e.seq}`, causaRaiz: `${estado} → ${hacia} no está en la tabla` })
        }
        if (SOLO_HUMANO.includes(hacia) && e.origen !== ORIGENES.HUMANO) {
          malos.push({ donde: `hecho #${e.seq}`, causaRaiz: `${hacia} con origen ${e.origen}: el software no aprueba` })
        }
        estado = hacia
      }
      return malos
    }
  },
  {
    id: 'O3',
    dice: 'el nivel de evidencia NO subió sin una observación que lo respalde',
    porque: 'subir la evidencia sin fuente nueva es blanquear un dato flojo',
    comprobar ({ eventos, expediente }) {
      // Escrito dos veces. La primera versión recorría los eventos y devolvía
      // siempre la lista vacía: era un invariante DECORATIVO, que es peor que no
      // tenerlo porque sale verde y no comprueba nada.
      //
      // La comprobación de verdad es esta: el nivel de evidencia que el
      // expediente muestra NO PUEDE SUPERAR al máximo que alguna observación
      // registró. Si lo supera, subió sin fuente — que es exactamente blanquear
      // un dato flojo, y sale en verde en cualquier otro sitio.
      const malos = []
      const techo = new Map()
      for (const e of eventos) {
        if (e.tipo !== EVENTO.REVISION) continue
        for (const c of e.datos?.campos ?? []) {
          if (!c.aceptado) continue
          techo.set(c.ruta, Math.max(techo.get(c.ruta) ?? 0, nivelEvidencia(c.evidencia)))
        }
      }
      for (const [ruta, c] of Object.entries(expediente.campos)) {
        const tope = techo.get(ruta)
        if (tope === undefined) {
          malos.push({ donde: ruta, causaRaiz: 'está en el expediente y NINGUNA observación lo registró' })
          continue
        }
        if (nivelEvidencia(c.evidencia) > tope) {
          malos.push({
            donde: ruta,
            causaRaiz: `muestra ${c.evidencia} (nivel ${nivelEvidencia(c.evidencia)}) y la mejor observación fue nivel ${tope}`
          })
        }
      }
      return malos
    }
  },
  {
    id: 'O4',
    dice: 'el nivel de evidencia NO bajó sin un evento de CONTRADICCION con motivo',
    porque: 'bajar en silencio borra la huella de que alguien discrepó',
    comprobar ({ eventos, expediente }) {
      const malos = []
      const maximo = new Map()
      for (const e of eventos) {
        if (e.tipo !== EVENTO.REVISION) continue
        for (const c of e.datos?.campos ?? []) {
          if (!c.aceptado) continue
          maximo.set(c.ruta, Math.max(maximo.get(c.ruta) ?? 0, nivelEvidencia(c.evidencia)))
        }
      }
      const contradichos = new Set(expediente.contradicciones.map(x => x.ruta))
      for (const [ruta, c] of Object.entries(expediente.campos)) {
        const tope = maximo.get(ruta)
        if (tope === undefined) continue
        if (nivelEvidencia(c.evidencia) < tope && !contradichos.has(ruta)) {
          malos.push({ donde: ruta, causaRaiz: `bajó de nivel ${tope} a ${nivelEvidencia(c.evidencia)} sin CONTRADICCION` })
        }
      }
      for (const x of expediente.contradicciones) {
        if (!x.motivo) malos.push({ donde: `hecho #${x.seq}`, causaRaiz: 'contradicción sin motivo: no es auditable' })
      }
      return malos
    }
  },
  {
    id: 'O5',
    dice: 'el expediente se REGENERA del ledger, byte a byte',
    porque: 'si no, el dataset dejó de ser una proyección y pasó a ser un archivo que alguien puede editar',
    comprobar ({ eventos, expediente }) {
      const otra = proyectar(eventos)
      if (JSON.stringify(otra) !== JSON.stringify(expediente)) {
        return [{ donde: 'la proyección entera', causaRaiz: 'dos proyecciones del mismo ledger difieren: la función dejó de ser pura' }]
      }
      const cadena = verificarCadena(eventos)
      if (!cadena.intacta) {
        return [{ donde: `hecho #${cadena.rotoEn}`, causaRaiz: cadena.causa }]
      }
      return []
    }
  },
  {
    id: 'O6',
    dice: 'la POSICIÓN guardada de cada campo señala su propia cita, y no la de otro',
    porque: 'una posición desplazada no falla: subraya la palabra de al lado con total aplomo, y es lo que ve el supervisor',
    comprobar ({ eventos, expediente }) {
      // ── DE DÓNDE SALE ESTE INVARIANTE ────────────────────────────────────
      //
      // Al resolver un conflicto, la proyección cambiaba `valor` y `cita` y
      // heredaba el `donde` del valor DESCARTADO. En EXP-003 el campo decía
      // «María Gómez Batista» con la posición de «Juan Pérez González»: los dos
      // de 33 caracteres, así que ni la longitud lo delataba.
      //
      // O1 no lo veía, y tenía razón en no verlo: la cita SÍ existía en la
      // fuente. Lo que estaba roto era el vínculo entre la cita y su posición,
      // que hasta ahora no comprobaba nadie. El efecto era que el documento
      // resaltado subrayaba el nombre que el oficial acababa de descartar, el
      // CSV exportaba ese desde/hasta y la constancia se lo llevaba al
      // supervisor — en el expediente del conflicto, que es el que se enseña.
      //
      // Lo encontró una prueba de la interfaz, no esta suite. Por eso existe
      // ahora aquí: lo que se descubre mirando tiene que quedar comprobado por
      // comando, o se descubre otra vez.
      const fuente = expediente.fuentes.map(f => f.texto).join('\n')
      const norm = normalizar(fuente)
      const malos = []
      for (const [ruta, c] of Object.entries(expediente.campos)) {
        if (!c.cita || !c.donde) continue
        const { desde, hasta } = c.donde
        if (!(Number.isInteger(desde) && Number.isInteger(hasta) && desde >= 0 && hasta <= norm.length && desde < hasta)) {
          malos.push({ donde: ruta, causaRaiz: `la posición ${desde}-${hasta} no cabe en la fuente (${norm.length})` })
          continue
        }
        const enEsePunto = norm.slice(desde, hasta)
        if (enEsePunto !== normalizar(c.cita)) {
          malos.push({
            donde: ruta,
            causaRaiz: `la posición ${desde}-${hasta} señala «${enEsePunto}» y la cita del campo es «${normalizar(c.cita)}»`
          })
        }
      }
      return malos
    }
  }
])

// ═══════════════════════════════════════════════════════════════════════════

function expedientes (dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort()
    .map(f => ({ id: f.replace('.jsonl', ''), ruta: join(dir, f) }))
}

export function verificar (dir, esquema) {
  const lista = expedientes(dir)
  const violaciones = []

  for (const { id, ruta } of lista) {
    let eventos = null
    let expediente = null
    let fallo = null

    try { eventos = leerLedger(ruta) } catch (e) {
      violaciones.push({ invariante: 'O5', expediente: id, donde: ruta,
                         causaRaiz: `el ledger no se puede ni leer: ${e.message}` })
      continue
    }
    try { expediente = proyectar(eventos) } catch (e) {
      // La proyección revienta cuando el ledger describe algo imposible. NO se
      // abandona el expediente: los invariantes que solo necesitan los hechos
      // en crudo —O2— sí pueden correr, y son justamente los que saben decir
      // QUÉ es lo imposible. Rendirse aquí convertiría todo diagnóstico en
      // «el ledger está roto», que no ayuda a nadie a arreglarlo.
      fallo = e
    }

    for (const inv of INVARIANTES) {
      if (inv.necesitaProyeccion !== false && expediente === null) {
        violaciones.push({ invariante: inv.id, expediente: id, donde: 'la proyección',
                           causaRaiz: `no se pudo proyectar: ${fallo.message}` })
        continue
      }
      let malos = []
      try { malos = inv.comprobar({ id, eventos, expediente, esquema }) } catch (e) {
        malos = [{ donde: '—', causaRaiz: `la comprobación reventó: ${e.message}` }]
      }
      for (const m of malos) violaciones.push({ invariante: inv.id, expediente: id, ...m })
    }
  }
  return { expedientes: lista.length, violaciones }
}

// ═══════════════════════════════════════════════════════════════════════════
//  --demo · enseñar el rojo, sin tocar los datos de verdad
// ═══════════════════════════════════════════════════════════════════════════

function demo (esquema) {
  const lista = expedientes(DATOS)
  if (!lista.length) {
    console.log(`  ${A}No hay expedientes en ${DATOS}. Crea uno con:${N}`)
    console.log(`  ${G}node cli.mjs revisar --texto "…" --extraccion x.json${N}\n`)
    return 0
  }

  const tmp = mkdtempSync(join(tmpdir(), 'invariantes-demo-'))
  try {
    cpSync(DATOS, tmp, { recursive: true })
    const objetivo = join(tmp, `${lista[0].id}.jsonl`)

    console.log(`  ${B}① Antes de tocar nada${N}`)
    pintar(verificar(tmp, esquema), '     ')

    // La corrupción más realista: alguien edita un valor con un editor de texto,
    // pensando que «solo está corrigiendo un dato».
    const lineas = readFileSync(objetivo, 'utf8').trim().split('\n')
    const i = lineas.findIndex(l => l.includes('"REVISION"'))
    if (i === -1) { console.log(`  ${A}ese expediente no tiene REVISION que corromper${N}\n`); return 0 }

    const ev = JSON.parse(lineas[i])
    const campo = (ev.datos?.campos ?? []).find(c => c.aceptado)
    if (!campo) { console.log(`  ${A}no hay campo aceptado que corromper${N}\n`); return 0 }

    const antes = campo.valor
    campo.valor = 'VALOR EDITADO A MANO'
    lineas[i] = JSON.stringify(ev)
    writeFileSync(objetivo, lineas.join('\n') + '\n')

    console.log(`\n  ${B}② Alguien edita el archivo con un editor de texto${N}`)
    console.log(`     ${G}${lista[0].id}.jsonl · hecho #${ev.seq} · ${campo.ruta}${N}`)
    console.log(`     ${G}"${antes}"  →  "VALOR EDITADO A MANO"${N}\n`)
    pintar(verificar(tmp, esquema), '     ')

    console.log(`\n  ${G}Los datos reales en ${DATOS} no se tocaron: todo esto ocurrió en una copia.${N}\n`)
    return 0
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function pintar (r, sangria = '  ') {
  if (!r.expedientes) { console.log(`${sangria}${A}no hay expedientes que verificar${N}`); return }
  const porInv = new Map(INVARIANTES.map(i => [i.id, []]))
  for (const v of r.violaciones) porInv.get(v.invariante)?.push(v)

  for (const inv of INVARIANTES) {
    const malos = porInv.get(inv.id)
    if (!malos.length) {
      console.log(`${sangria}${V}✓${N} ${inv.id}  ${inv.dice}`)
    } else {
      console.log(`${sangria}${R}${B}✗ ${inv.id}${N}  ${R}${inv.dice}${N}`)
      for (const m of malos.slice(0, 3)) {
        console.log(`${sangria}   ${R}${m.expediente} · ${m.donde}${N}`)
        console.log(`${sangria}   ${R}causa raíz: ${m.causaRaiz}${N}`)
      }
      console.log(`${sangria}   ${G}${inv.porque}${N}`)
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  El ejecutable. Debajo de esta línea solo hay presentación: lo de arriba se
//  importa desde pruebas/invariantes.test.mjs, que comprueba que CADA
//  invariante detecta su propia violación. Un verificador que nunca se ha
//  visto fallar no demuestra nada, y eso vale también para este.
// ═══════════════════════════════════════════════════════════════════════════

const esEjecutable = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (!esEjecutable) { /* importado como módulo: no se imprime ni se sale */ }
else await principal()

async function principal () {

const esquema = cargarEsquema(arg('esquema', 'instancias/banca/esquema.json'))

console.log(`\n  ${B}INVARIANTES${N}   ${G}sobre los datos que hay en el disco, no sobre datos de test${N}\n`)

if (argv.includes('--demo')) {
  console.log(`  ${G}modo demostración: se corrompe una COPIA para enseñar el rojo${N}\n`)
  process.exit(demo(esquema))
}

const r = verificar(DATOS, esquema)
pintar(r)

console.log('')
if (r.violaciones.length) {
  console.log(`  ${R}${B}${r.violaciones.length} violación(es) sobre ${r.expedientes} expediente(s).${N}`)
  console.log(`  ${G}Cada una lleva su causa raíz: decir «está mal» sin decir qué hecho lo rompió`)
  console.log(`  obliga a quien lo lea a repetir la investigación entera.${N}\n`)
  process.exit(1)
}
console.log(`  ${V}${B}${INVARIANTES.length}/${INVARIANTES.length} invariantes se cumplen${N}` +
            `  ${G}sobre ${r.expedientes} expediente(s) reales${N}`)
console.log(`  ${G}para ver el rojo:  node scripts/verificar-invariantes.mjs --demo${N}\n`)
}
