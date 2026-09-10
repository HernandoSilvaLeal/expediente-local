// campo.mjs — el par que PIDE inferencia y no la ejecuta.
//
// Este archivo NO importa @qvac/sdk a propósito: el dispositivo de campo no tiene
// modelo, no tiene GPU y no tiene el SDK. Son ~200 MB de dependencias en vez de 4,8 GB.
// Esa asimetría no es una limitación: es el argumento del producto.
//
//   node campo.mjs --bootstrap 192.168.68.57:49737
//
// Protocolo: qvac-infer/delegacion/1 sobre Protomux.
// El ORDEN de addMessage debe ser idéntico en los dos extremos o los canales no casan.

import Hyperswarm from 'hyperswarm'
import DHT from 'hyperdht'
import Protomux from 'protomux'
import c from 'compact-encoding'
import crypto from 'hypercore-crypto'
import b4a from 'b4a'

const argv = process.argv.slice(2)
const arg = (n, d = null) => { const i = argv.indexOf('--' + n); return i === -1 ? d : argv[i + 1] }

const HOST      = arg('host', '0.0.0.0')
const SECONDS   = Number(arg('seconds', '90'))
const WATCHDOG  = Number(arg('watchdog', '25'))
const BOOTSTRAP = arg('bootstrap')
  ? arg('bootstrap').split(',').map(s => { const [host, port] = s.split(':'); return { host, port: Number(port) } })
  : undefined

const T0  = Date.now()
const log = (...a) => console.log(`[CAMPO] +${((Date.now() - T0) / 1000).toFixed(1)}s`, ...a)

const TEXTOS = [
  'Estoy en Hospital DemoCare Pacific, en Panama. Tienen tres resonadores y un tomografo. Uno de los resonadores parece de unos ocho anos.',
  'Visite Clinica San Rafael en Medellin, vi dos ecografos Philips nuevos.',
  'I visited Hospital Alpha today. They have three MR systems and two CT systems.'
]

log('arranco SIN modelo, SIN GPU y SIN el SDK de QVAC.')
log('plataforma:', process.platform, process.arch, '· node', process.version)
if (!BOOTSTRAP) {
  console.error('\n  FALTA --bootstrap <ip>:<puerto>\n  Ejemplo: node campo.mjs --bootstrap 192.168.68.57:49737\n')
  process.exit(1)
}
log('bootstrap:', JSON.stringify(BOOTSTRAP))

// --- Vigilante de no-progreso -------------------------------------------------
// Un swarm sin pares no lanza excepción: se queda colgado indefinidamente.
// Sin esto, un fallo se ve igual que "todavía está buscando".
let huboConexion = false
const vigilante = setTimeout(() => {
  if (!huboConexion) {
    console.error(`\n  🔴 ${WATCHDOG}s sin encontrar ningún par.`)
    console.error('     Comprobar: ¿el motor está corriendo? ¿la IP del bootstrap es correcta?')
    console.error('     ¿el cortafuegos deja pasar? ¿ambos en la misma red?\n')
    process.exit(2)
  }
}, WATCHDOG * 1000)

const dht = new DHT({ bootstrap: BOOTSTRAP, host: HOST, port: 0, ephemeral: false, firewalled: false })
await dht.fullyBootstrapped()
log('DHT lista:', JSON.stringify(dht.address()))

const swarm = new Hyperswarm({ dht })
const topic = crypto.data(b4a.from('hackqvac-philips-delegacion-inferencia-v1'))
const pendientes = new Map()
let hechas = 0
const medidas = []

swarm.on('connection', (conn, info) => {
  huboConexion = true
  clearTimeout(vigilante)

  const peerId = b4a.toString(info.publicKey, 'hex').slice(0, 12)
  log('🟢 CONEXIÓN P2P con el par', peerId)

  const mux = (conn.userData && Protomux.isProtomux(conn.userData)) ? conn.userData : Protomux.from(conn)
  conn.userData = mux

  let resultadoMsg = null
  const ch = mux.createChannel({
    protocol: 'qvac-infer/delegacion/1',
    onopen () { log('canal de delegación abierto con', peerId) }
  })
  if (!ch) return

  // 1.º peticion — el campo la envía, el motor la escucha
  const peticionMsg = ch.addMessage({ encoding: c.json, onmessage () { /* el campo no atiende peticiones */ } })

  // 2.º resultado — el motor lo envía, el campo lo escucha
  resultadoMsg = ch.addMessage({ encoding: c.json, onmessage (m) {
    const t0    = pendientes.get(m.id)
    const pared = t0 ? Date.now() - t0 : -1
    hechas++
    medidas.push({ id: m.id, pared, remota: m.ms })
    log(`<< RESULTADO #${m.id} | ida+vuelta ${pared} ms | inferencia remota ${m.ms} ms | sobrecoste transporte ${pared - m.ms} ms | dev=${m.dev} TTFT=${m.ttft}ms ${m.toks}tok/s`)
    try {
      const o = JSON.parse(m.json)
      console.log(`        JSON.parse OK → cliente="${o.cliente}" ciudad="${o.ciudad}" pais="${o.pais}" filas=${o.observaciones.length}`)
      for (const x of o.observaciones) {
        console.log(`          · ${x.modalidad} x${x.cantidad} ${x.fabricante}/${x.modelo} ${x.antiguedad_anios}a ${x.confianza}`)
      }
    } catch (e) { console.log('        🔴 JSON INVÁLIDO:', e.message) }
  } })

  ch.open()

  setTimeout(() => {
    TEXTOS.forEach((texto, i) => setTimeout(() => {
      pendientes.set(i + 1, Date.now())
      log(`>> PETICIÓN #${i + 1} enviada al par (yo no tengo modelo)`)
      peticionMsg.send({ id: i + 1, texto })
    }, i * 3000))
  }, 1500)
})

await swarm.join(topic, { server: true, client: true }).flushed()
log('anunciado en el topic; esperando al motor…')

setTimeout(async () => {
  console.log('\n' + '─'.repeat(70))
  log(`RESUMEN: ${hechas}/${TEXTOS.length} inferencias resueltas POR UN PAR REMOTO.`)
  log('Sin modelo local. Sin GPU. Sin el SDK. Sin nube.')
  if (medidas.length) {
    const sob = medidas.map(m => m.pared - m.remota)
    log(`Sobrecoste del transporte P2P: ${sob.join(' / ')} ms`)
  }
  console.log('─'.repeat(70) + '\n')
  await swarm.destroy()
  await dht.destroy()
  process.exit(hechas === TEXTOS.length ? 0 : 3)
}, SECONDS * 1000)
