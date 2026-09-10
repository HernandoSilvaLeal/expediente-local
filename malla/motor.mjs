// ARQUITECTO — DELEGACION DE INFERENCIA ENTRE PARES sobre el canal Protomux ya probado.
// Cierra el hueco que PILAR_2 dejo NO PROBADO: el peer sin modelo pide, el peer con modelo infiere.
//   node arq-05-delegacion.mjs --role motor       --bootstrap 127.0.0.1:49737
//   node arq-05-delegacion.mjs --role solicitante --bootstrap 127.0.0.1:49737
import Hyperswarm from 'hyperswarm'
import DHT from 'hyperdht'
import Protomux from 'protomux'
import c from 'compact-encoding'
import crypto from 'hypercore-crypto'
import b4a from 'b4a'
import { loadModel, completion, unloadModel, close } from '@qvac/sdk'

const argv = process.argv.slice(2)
const arg = (n, d = null) => { const i = argv.indexOf('--' + n); return i === -1 ? d : argv[i + 1] }
const ROLE = arg('role', 'motor')
const NAME = ROLE === 'motor' ? 'MOTOR' : 'CAMPO'
const HOST = arg('host', '127.0.0.1')
const SECONDS = Number(arg('seconds', '60'))
const BOOTSTRAP = arg('bootstrap') ? arg('bootstrap').split(',').map(s => { const [host, port] = s.split(':'); return { host, port: Number(port) } }) : undefined
const T0 = Date.now()
const log = (...a) => console.log(`[${NAME}] +${((Date.now() - T0) / 1000).toFixed(1)}s`, ...a)

const MODELO = '/home/nando/Escritorio/projects/hackQVAC/_lab/models/medpsy-1.7b-q4_k_m-imat.gguf'
const SCHEMA = { type:'object', properties:{
  cliente:{type:'string'}, ciudad:{type:'string'}, pais:{type:'string'},
  observaciones:{type:'array',items:{type:'object',properties:{
    modalidad:{type:'string',enum:['MRI','CT','XRAY','ULTRASOUND','OTRO','DESCONOCIDO']},
    cantidad:{type:'integer'}, fabricante:{type:'string'}, modelo:{type:'string'},
    antiguedad_anios:{type:'integer'},
    confianza:{type:'string',enum:['Confirmado','Reportado','Estimado','Desconocido']}},
    required:['modalidad','cantidad','fabricante','modelo','antiguedad_anios','confianza'],
    additionalProperties:false}}},
  required:['cliente','ciudad','pais','observaciones'], additionalProperties:false }
const SYS = 'Eres un extractor de datos de campo. Devuelves SOLO JSON valido conforme al esquema. Si un dato NO aparece literalmente en el texto usa "DESCONOCIDO" para textos, 0 para numeros y "Desconocido" para confianza. No deduzcas el pais a partir de la ciudad.'

const TEXTOS = [
  'Estoy en Hospital DemoCare Pacific, en Panama. Tienen tres resonadores y un tomografo. Uno de los resonadores parece de unos ocho anos.',
  'Visite Clinica San Rafael en Medellin, vi dos ecografos Philips nuevos.',
  'I visited Hospital Alpha today. They have three MR systems and two CT systems.'
]

let modelId = null
if (ROLE === 'motor') {
  const t = Date.now()
  modelId = await loadModel({ modelSrc: MODELO, modelType: 'llamacpp-completion', modelConfig: { ctx_size: 4096 } })
  log('modelo MedPsy cargado en', Date.now() - t, 'ms  (soy el unico que tiene el modelo)')
} else {
  log('NO tengo modelo cargado. Voy a delegar la inferencia a un par.')
}

let dht = null
if (BOOTSTRAP) {
  dht = new DHT({ bootstrap: BOOTSTRAP, host: HOST, port: 0, ephemeral: false, firewalled: false })
  await dht.fullyBootstrapped()
  log('DHT local lista:', JSON.stringify(dht.address()))
}
const swarm = new Hyperswarm(dht ? { dht } : {})
const topic = crypto.data(b4a.from('hackqvac-philips-delegacion-inferencia-v1'))
const pendientes = new Map()
let hechas = 0

swarm.on('connection', (conn, info) => {
  const peerId = b4a.toString(info.publicKey, 'hex').slice(0, 12)
  log('conexion P2P con par', peerId)
  const mux = (conn.userData && Protomux.isProtomux(conn.userData)) ? conn.userData : Protomux.from(conn)
  conn.userData = mux
  let resultadoMsg = null
  const ch = mux.createChannel({ protocol: 'qvac-infer/delegacion/1', onopen () { log('canal de delegacion abierto con', peerId) } })
  if (!ch) return
  // el ORDEN de addMessage debe ser identico en los dos extremos
  const peticionMsg = ch.addMessage({ encoding: c.json, async onmessage (m) {
      if (ROLE !== 'motor') return
      log(`<< PETICION #${m.id} recibida del par: "${m.texto.slice(0, 60)}..."`)
      const t = Date.now()
      const r = completion({ modelId, history: [{ role:'system', content: SYS }, { role:'user', content: m.texto }],
        stream: false, responseFormat: { type:'json_schema', json_schema: { name:'observacion', schema: SCHEMA } },
        generationParams: { temp: 0, predict: 700, seed: 42, reasoning_budget: 0 } })
      const fin = await r.final; const st = await r.stats
      const ms = Date.now() - t
      log(`   inferencia local hecha en ${ms} ms · dev=${st.backendDevice} · TTFT=${st.timeToFirstToken.toFixed(0)}ms · ${st.tokensPerSecond.toFixed(1)} tok/s`)
      resultadoMsg.send({ id: m.id, json: fin.contentText.trim(), ms, dev: st.backendDevice,
                          ttft: Math.round(st.timeToFirstToken), toks: Math.round(st.tokensPerSecond) })
      log(`>> RESULTADO #${m.id} devuelto al par`)
  } })
  resultadoMsg = ch.addMessage({ encoding: c.json, onmessage (m) {
      if (ROLE === 'motor') return
      const t0 = pendientes.get(m.id)
      const pared = t0 ? Date.now() - t0 : -1
      hechas++
      log(`<< RESULTADO #${m.id} | ida+vuelta P2P ${pared} ms | inferencia remota ${m.ms} ms | dev=${m.dev} TTFT=${m.ttft}ms ${m.toks}tok/s`)
      try { const o = JSON.parse(m.json)
        console.log(`        JSON.parse OK -> cliente="${o.cliente}" ciudad="${o.ciudad}" pais="${o.pais}" filas=${o.observaciones.length}`)
        for (const x of o.observaciones) console.log(`          · ${x.modalidad} x${x.cantidad} ${x.fabricante}/${x.modelo} ${x.antiguedad_anios}a ${x.confianza}`)
      } catch (e) { console.log('        JSON INVALIDO:', e.message) }
  } })
  ch.open()
  if (ROLE !== 'motor') {
    setTimeout(() => {
      TEXTOS.forEach((texto, i) => setTimeout(() => {
        pendientes.set(i + 1, Date.now())
        log(`>> PETICION #${i + 1} enviada al par (yo no tengo modelo)`)
        peticionMsg.send({ id: i + 1, texto })
      }, i * 3000))
    }, 1500)
  }
})

await swarm.join(topic, { server: true, client: true }).flushed()
log('anunciado en el topic de delegacion; esperando pares...')

setTimeout(async () => {
  if (ROLE !== 'motor') log(`RESUMEN: ${hechas}/${TEXTOS.length} inferencias resueltas POR UN PAR REMOTO, sin modelo local, sin nube.`)
  await swarm.destroy()
  if (dht) await dht.destroy()
  if (modelId) await unloadModel({ modelId })
  await close()
  log('FIN')
  process.exit(0)
}, SECONDS * 1000)
