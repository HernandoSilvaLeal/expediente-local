// bootstrap.mjs — nodo DHT local que sustituye a los bootstrap públicos de Holepunch.
//
// El secreto está en hyperdht/index.js: `opts.bootstrap || BOOTSTRAP_NODES` es un OR,
// no un merge. Pasar `bootstrap` SUSTITUYE la lista pública entera.
// Eso es todo el modo offline: doce líneas.
//
//   node bootstrap.mjs --host 192.168.68.57 --port 49737
//
// ⚠️ El host debe ser la IP de LAN, NO 127.0.0.1: si escucha en loopback,
//    el otro equipo no lo alcanza y la prueba mide dos procesos locales otra vez.

import DHT from 'hyperdht'

const argv = process.argv.slice(2)
const arg  = (n, d) => { const i = argv.indexOf('--' + n); return i === -1 ? d : argv[i + 1] }

const host = arg('host', '0.0.0.0')
const port = Number(arg('port', '49737'))

if (host === '127.0.0.1' || host === 'localhost') {
  console.error('\n  🔴 host es loopback. El otro equipo NO va a poder conectarse.')
  console.error('     Usa la IP de LAN:  --host 192.168.68.57\n')
  process.exit(1)
}

const node = DHT.bootstrapper(port, host, { host, port, firewalled: false })
await node.ready()

console.log('[BOOTSTRAP] escuchando en', JSON.stringify(node.address()))
console.log('[BOOTSTRAP] el otro equipo debe usar:  --bootstrap ' + host + ':' + node.address().port)
console.log('[BOOTSTRAP] Ctrl+C para parar')

process.once('SIGINT',  () => { node.destroy(); process.exit(0) })
process.once('SIGTERM', () => { node.destroy(); process.exit(0) })
