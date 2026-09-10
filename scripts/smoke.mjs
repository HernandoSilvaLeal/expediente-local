#!/usr/bin/env node
// scripts/smoke.mjs — LA PRUEBA DE QUE ESTO FUNCIONA SIN RED.
//
// ═══════════════════════════════════════════════════════════════════════════
//   Diseñado para correr DENTRO de un espacio de red sin interfaces:
//
//       unshare -rn bash -c 'npm run smoke'
//
//   Ahí dentro no hay `lo`, no hay ruta por defecto, `curl` devuelve 000.
//   Y esto sale con JSON válido y código 0.
// ═══════════════════════════════════════════════════════════════════════════
//
// Es el plano B del video, y va PRIMERO en el guion a propósito: antes de contar
// qué hace el sistema, se enseña que lo hace con la red cortada. «Demostrado»
// quiere decir grabado, no afirmado.
//
// Lo que recorre es el flujo COMPLETO: captura, anclaje, las guardias, la
// máquina de estados, el ledger encadenado y la proyección. Lo único que no
// hace es cargar el modelo — y no por falta de red, sino porque un smoke que
// tarda cuarenta segundos en descargar pesos no lo corre nadie.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { cargarEsquema } from '../core/esquema.mjs'
import { abrirExpediente, aCsv } from '../core/expediente.mjs'

const V = '\x1b[0;32m', R = '\x1b[0;31m', G = '\x1b[0;90m', B = '\x1b[1m', N = '\x1b[0m'

const DICTADO =
  'El titular es Juan Pérez González, cédula 8-123-456. ' +
  'Presenta el recibo del IDAAN del 12 de marzo de 2026 por 45.30 balboas.'

// Lo que un modelo devuelve: JSON perfectamente válido, con dos campos falsos.
//
// Uno de los dos es la CÉDULA, que es campo crítico. Esa elección no es casual:
// es el caso que le importa al banco. Un dato inventado en un campo crítico no
// rellena el hueco — lo deja igual de vacío, y el expediente no puede aprobarse.
const PROPUESTO = {
  titular: {
    nombre: { valor: 'Juan Pérez González', cita: 'El titular es Juan Pérez González' },
    cedula: { valor: '8-999-999', cita: 'cédula 8-999-999' }               // ← INVENTADA, y es crítica
  },
  documentos: [{
    tipo: 'RECIBO_SERVICIO',
    emisor:        { valor: 'ETESA', cita: 'el recibo del IDAAN' },        // ← inventado con coartada
    fecha_emision: { valor: '12 de marzo de 2026', cita: 'del 12 de marzo de 2026' },
    monto:         { valor: 45.30, cita: 'por 45.30 balboas' }
  }]
}

const dir = mkdtempSync(join(tmpdir(), 'expediente-smoke-'))
let paso = 0
const ok = (t) => console.log(`  ${V}✓${N} ${String(++paso).padStart(2)} · ${t}`)

try {
  console.log(`\n  ${B}SMOKE${N}  ${G}el flujo completo, sin modelo y sin red${N}\n`)

  const esquema = cargarEsquema('instancias/banca/esquema.json')
  ok(`esquema cargado: ${esquema.dominio} / ${esquema.entidad}`)

  let n = 0
  const exp = abrirExpediente({
    ruta: join(dir, 'smoke.jsonl'), esquema, id: 'SMOKE-001',
    ahora: () => `2026-09-10T12:${String(n++).padStart(2, '0')}:00.000Z`
  })

  exp.capturar(DICTADO)
  ok('capturado — la fuente queda entera en el ledger')

  const { revision } = exp.asentar(PROPUESTO)
  ok(`revisado — ${revision.resumen.aceptados} anclados · ${revision.resumen.rechazados} rechazados`)

  const e = exp.leer()
  exigir(revision.resumen.rechazados === 2, 'las dos invenciones tenían que quedar fuera')
  ok('las dos invenciones NO entraron al dataset')

  exigir(e.campos['titular.nombre']?.valor === 'Juan Pérez González', 'lo verdadero tenía que entrar')
  exigir(e.campos['titular.cedula'] === undefined, 'la cédula inventada NO podía entrar')
  ok('y lo verdadero SÍ entró: no es un rechazo indiscriminado')

  exigir(Object.keys(e.huecos).length === 2, 'cada hueco tiene que traer su motivo')
  ok(`el sistema sabe POR QUÉ falta cada dato: ${Object.values(e.huecos).map(h => h.guardias.join('')).join(' ')}`)

  exigir(e.estado === 'VALIDADO', `estado inesperado: ${e.estado}`)
  ok(`estado ${e.estado} — no llega a COMPLETO porque falta titular.cedula, que es crítico`)

  let lanzo = false
  try { exp.decidir('aprobar', { motivo: 'x', oficial: 'smoke' }) } catch { lanzo = true }
  exigir(lanzo, 'un expediente incompleto NO puede aprobarse')
  ok('y no se puede aprobar: el software nunca aprueba solo')

  const v = exp.verificar()
  exigir(v.intacta, `cadena rota en #${v.rotoEn}`)
  ok(`cadena íntegra — ${v.eventos} hechos encadenados por hash`)

  const csv = aCsv(e)
  exigir(csv.includes('SIN_ANCLAJE'), 'el CSV tiene que decir qué guardia paró qué')
  ok('CSV con columna de auditoría')

  // La salida legible por máquina. Es lo que se compara entre corridas.
  const resumen = {
    ok: true,
    expediente: e.id,
    estado: e.estado,
    anclados: Object.keys(e.campos).length,
    huecos: Object.keys(e.huecos).length,
    motivos: Object.fromEntries(Object.entries(e.huecos).map(([k, h]) => [k, h.motivos.join(',')])),
    hechos: v.eventos,
    cadena: 'intacta'
  }
  console.log(`\n${JSON.stringify(resumen, null, 2)}\n`)
  console.log(`  ${V}${B}SMOKE OK${N}  ${G}sin modelo, sin red, sin SDK${N}\n`)
} catch (e) {
  console.error(`\n  ${R}✗ SMOKE ROTO: ${e.message}${N}\n`)
  console.log(JSON.stringify({ ok: false, error: e.message }))
  process.exitCode = 1
} finally {
  rmSync(dir, { recursive: true, force: true })
}

function exigir (condicion, mensaje) { if (!condicion) throw new Error(mensaje) }
