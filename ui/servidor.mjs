#!/usr/bin/env node
// ui/servidor.mjs — la interfaz. `node:http` y nada más.
//
// ═══════════════════════════════════════════════════════════════════════════
//   Cero dependencias. Cero paso de compilación. Cero framework.
//   El juez abre el navegador y ya está.
// ═══════════════════════════════════════════════════════════════════════════
//
// ── POR QUÉ NO HAY REACT AQUÍ ──────────────────────────────────────────────
//
// No es purismo. Es que React + Vite son dos o tres horas de andamiaje **y un
// paso de compilación que el jurado tiene que ejecutar para ver algo**. En un
// hackathon de 48 horas eso compra unos degradados y cuesta la única cosa que
// de verdad importa: que quien evalúa vea el sistema funcionando al primer
// intento. Design vale 10 puntos; Completion y Technical valen 45.
//
// ── ESCUCHA SOLO EN LOOPBACK, Y ES DELIBERADO ──────────────────────────────
//
// `127.0.0.1` a propósito: un expediente bancario no se sirve a la red por
// accidente porque alguien arrancó la demo en un café. Si hiciera falta
// exponerlo, sería una decisión explícita, no el valor por defecto.
//
// PROHIBIDO aquí: importar @qvac/sdk. Verificado por scripts/verificar-frontera.mjs

import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cargarEsquema } from '../core/esquema.mjs'
import { abrirExpediente, aCsv } from '../core/expediente.mjs'
import { calidad, preguntasPendientes } from '../core/calidad.mjs'
import { agrupar } from '../core/dedup.mjs'
import { proyectar } from '../core/proyeccion.mjs'
import { leer as leerLedger, verificarCadena } from '../core/ledger.mjs'
import { cargarDominio } from '../scripts/cargar-dominio.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..')

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i === -1 ? d : argv[i + 1] }

const PUERTO = Number(arg('puerto', process.env.PORT ?? '7301'))
// `resolve` y no `join`: con `join`, una ruta absoluta se CONCATENA a la raíz
// del proyecto —«/proyecto» + «/tmp/x» = «/proyecto/tmp/x»— y el servidor mira
// donde no hay nada, sin decir una palabra. `resolve` respeta la absoluta y
// sigue resolviendo la relativa contra la raíz, que es lo que se espera.
const DATOS = resolve(RAIZ, arg('datos', 'datos'))
const esquema = cargarEsquema(arg('esquema', 'instancias/banca/esquema.json'))
// El reloj se puede fijar aquí igual que en el CLI: si no, los expedientes
// de ejemplo caducan solos y la interfaz enseña rechazos que no son reales.
const hoy = arg('hoy', null) ? new Date(`${arg('hoy')}T12:00:00Z`) : new Date()
const dominio = await cargarDominio(esquema, { hoy })

const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
                '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' }

/**
 * Quién está mirando ahora mismo.
 *
 * Vive en memoria a propósito: si el servidor se reinicia, los navegadores
 * reconectan solos —para eso está el `retry`— y no hay nada que recuperar.
 * Un registro persistente de conexiones sería estado que se puede desfasar.
 */
const oyentes = new Set()

/** Avisa a todos los dispositivos de que algo cambió. NO manda el qué. */
function avisar (que) {
  for (const res of oyentes) {
    try { res.write(`event: cambio\ndata: ${JSON.stringify({ que })}\n\n`) }
    catch { oyentes.delete(res) }
  }
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PUERTO}`)
  const enviar = (codigo, cuerpo, tipo = 'application/json; charset=utf-8') => {
    res.writeHead(codigo, {
      'content-type': tipo,
      // Sin caché: en una demo, ver datos viejos y no saberlo es peor que esperar.
      'cache-control': 'no-store',
      // La página no carga NADA de fuera. Que se pueda comprobar en las
      // herramientas del navegador es parte del argumento del proyecto.
      'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:"
    })
    res.end(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo, null, 2))
  }

  try {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return enviar(200, readFileSync(join(AQUI, 'index.html'), 'utf8'), TIPOS['.html'])
    }

    if (url.pathname === '/api/expedientes') {
      const lista = expedientes()
      return enviar(200, {
        expedientes: lista.map(resumir),
        grupos: agrupar(lista, esquema),
        esquema: { dominio: esquema.dominio, entidad: esquema.entidad, criticos: esquema.camposCriticos }
      })
    }

    if (url.pathname.startsWith('/api/expediente/')) {
      const id = decodeURIComponent(url.pathname.split('/').pop())
      const ruta = join(DATOS, `${id}.jsonl`)
      if (!existsSync(ruta)) return enviar(404, { error: `no hay expediente ${id}` })

      const eventos = leerLedger(ruta)
      const e = proyectar(eventos)
      return enviar(200, {
        expediente: e,
        calidad: calidad(e, esquema),
        preguntas: preguntasPendientes(e, esquema),
        cadena: verificarCadena(eventos),
        hechos: eventos.map(h => ({ seq: h.seq, ts: h.ts, tipo: h.tipo, origen: h.origen, motivo: h.motivo })),
        csv: aCsv(e)
      })
    }

    // ── TODA ESCRITURA PASA POR AQUÍ ANTES QUE POR NINGÚN SITIO ─────────────
    //
    // El cuerpo se lee UNA vez y viaja al guardián y al manejador: el rol viene
    // dentro, y un `req` ya consumido no se puede volver a leer.
    let cuerpo = null
    if (req.method === 'POST') {
      const tipo = String(req.headers['content-type'] ?? '').split(';')[0].trim()
      if (tipo === 'application/json') {
        try { cuerpo = await leerCuerpo(req) } catch { cuerpo = null }
      }
      const no = escrituraRechazada(req, url, cuerpo)
      if (no) return enviar(no.codigo, { ok: false, error: no.error })
    }

    // ⭐ LOS DISPOSITIVOS SE ENTERAN — `text/event-stream`, sin dependencias
    //
    // Marta resuelve un conflicto en la tableta y el celular de Ricardo mostraba
    // datos viejos hasta que él recargara a mano. Con dos personas actuando en
    // la misma escena, eso se ve y rompe la ilusión de sistema vivo.
    //
    // Se elige SSE y no WebSocket por tres razones, y las tres importan aquí:
    // `node:http` lo soporta sin instalar nada; el navegador reconecta solo; y
    // encaja con el CSP que ya servimos (`default-src 'self'`).
    //
    // No lleva datos: solo avisa de que algo cambió. Quien reciba el aviso pide
    // lo que necesite por la API de siempre. Un canal que empuja estado es un
    // segundo sitio donde el estado puede quedar desfasado, y ya tenemos uno.
    if (url.pathname === '/api/eventos') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive'
      })
      res.write('retry: 3000\n\n')
      oyentes.add(res)
      // Un latido cada 25 s: sin él, un proxy o el propio sistema operativo
      // cierran la conexión por inactividad y el aviso deja de llegar sin que
      // nadie se entere — que es peor que no tener canal.
      const latido = setInterval(() => { try { res.write(': latido\n\n') } catch { /* cerrada */ } }, 25000)
      req.on('close', () => { clearInterval(latido); oyentes.delete(res) })
      return
    }

    // ⭐ CAPTURAR — lo que le faltaba a la ventanilla para existir
    //
    // Hasta aquí la interfaz solo sabía LEER y decidir sobre lo ya capturado.
    // Para iniciar un expediente había que abrir una terminal, y ese es
    // exactamente el momento en que se pierde a quien está mirando.
    //
    // Recibe el texto tal cual lo dictó o lo tecleó el oficial, y la propuesta
    // del modelo si ya la hay. Sin propuesta, el expediente queda CAPTURADO con
    // su fuente guardada entera — que es un estado legítimo: lo que se dijo ya
    // está a salvo aunque nadie lo haya interpretado todavía.
    //
    // ⚠️ Este endpoint SÍ crea expedientes, y es el único. Por eso no pasa por
    // la comprobación de existencia del guardián: capturar es, literalmente,
    // hacer que algo exista. Lo que sí comprueba es el rol.
    if (url.pathname.startsWith('/api/capturar/') && req.method === 'POST') {
      const id = decodeURIComponent(url.pathname.split('/').pop())
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) {
        return enviar(400, { ok: false, error: `"${id}" no sirve como identificador de expediente` })
      }
      const texto = String(cuerpo?.texto ?? '').trim()
      if (!texto) return enviar(400, { ok: false, error: 'capturar necesita el texto de la fuente' })

      const exp = abrirExpediente({
        ruta: join(DATOS, `${id}.jsonl`), esquema, id,
        guardiasDominio: dominio.revisar, guardiasRegistro: dominio.revisarRegistro,
        contextoDominio: dominio.contexto
      })
      try {
        exp.capturar(texto)
        // La propuesta del modelo es opcional: se puede capturar primero y
        // asentar después, que es como funciona una ventanilla de verdad.
        const revision = cuerpo?.extraccion ? exp.asentar(cuerpo.extraccion).revision : null
        const e = exp.leer()
        avisar('capturado')
        return enviar(200, {
          ok: true, id, estado: e.estado,
          anclados: revision ? revision.resumen.aceptados : 0,
          rechazados: revision ? revision.resumen.rechazados : 0
        })
      } catch (err) {
        return enviar(409, { ok: false, error: err.message })
      }
    }

    // ⭐ Resolver un conflicto entre fuentes: el humano en el bucle, desde el
    // navegador. Las tres reglas —valor de la disputa, oficial, motivo— viven
    // en core/expediente.mjs y NO se repiten aquí: si se validara también en el
    // servidor, tarde o temprano las dos copias dirían cosas distintas.
    if (url.pathname.startsWith('/api/resolver/') && req.method === 'POST') {
      const id = decodeURIComponent(url.pathname.split('/').pop())
      const exp = abrirExpediente({
        ruta: join(DATOS, `${id}.jsonl`), esquema, id,
        guardiasDominio: dominio.revisar, guardiasRegistro: dominio.revisarRegistro,
        contextoDominio: dominio.contexto
      })
      try {
        const e = exp.resolver(cuerpo.campo, {
          valor: cuerpo.valor, oficial: cuerpo.oficial ?? null, motivo: cuerpo.motivo ?? null
        })
        avisar('resuelto')
        return enviar(200, { ok: true, conflictos: e.conflictos.length })
      } catch (err) {
        return enviar(409, { ok: false, error: err.message })
      }
    }

    // Las decisiones que solo puede tomar una persona pasan por aquí, y por
    // ningún otro sitio: la política vive en core/estado.mjs, no en el navegador.
    if (url.pathname.startsWith('/api/decidir/') && req.method === 'POST') {
      const id = decodeURIComponent(url.pathname.split('/').pop())
      const exp = abrirExpediente({
        ruta: join(DATOS, `${id}.jsonl`), esquema, id,
        guardiasDominio: dominio.revisar, guardiasRegistro: dominio.revisarRegistro,
        contextoDominio: dominio.contexto
      })
      try {
        const e = exp.decidir(cuerpo.que, {
          motivo: cuerpo.motivo ?? null, oficial: cuerpo.oficial ?? null
        })
        avisar('decidido')
        return enviar(200, { ok: true, estado: e.estado })
      } catch (err) {
        // 409, no 500: no es que el servidor falle, es que la operación no es
        // legal en ese estado. La diferencia importa para quien lee el log.
        return enviar(409, { ok: false, error: err.message })
      }
    }

    const estatico = join(AQUI, url.pathname.replace(/^\//, ''))
    if (estatico.startsWith(AQUI) && existsSync(estatico) && extname(estatico)) {
      return enviar(200, readFileSync(estatico, 'utf8'), TIPOS[extname(estatico)] ?? 'text/plain')
    }
    enviar(404, { error: 'no existe' })
  } catch (e) {
    enviar(500, { error: e.message })
  }
})

function expedientes () {
  if (!existsSync(DATOS)) return []
  return readdirSync(DATOS)
    .filter(f => f.endsWith('.jsonl'))
    .sort()                                  // orden estable: la lista no baila
    .map(f => { try { return proyectar(leerLedger(join(DATOS, f))) } catch { return null } })
    .filter(Boolean)
}

function resumir (e) {
  const q = calidad(e, esquema)
  return {
    id: e.id, estado: e.estado, duplicadoDe: e.duplicadoDe,
    anclados: Object.keys(e.campos).length,
    huecos: Object.keys(e.huecos ?? {}).length,
    completitud: q.completitud, puedeCerrar: q.puedeCerrar,
    porEvidencia: e.resumen.porEvidencia
  }
}

/**
 * ⭐ ¿Se rechaza esta escritura? Devuelve el motivo, o null si puede pasar.
 *
 * ── EL SOFTWARE SÍ APROBABA SOLO ──────────────────────────────────────────
 *
 * Encontrado por una auditoría adversarial, y es el hallazgo que más duele
 * porque contradice la frase con la que se presenta el proyecto entero.
 *
 * Bastaba esto, desde una pestaña cualquiera que el oficial tuviera abierta:
 *
 *   curl -X POST http://127.0.0.1:7301/api/decidir/EXP-9 \
 *        -H 'Content-Type: text/plain;charset=UTF-8' \
 *        -H 'Origin: https://sitio-cualquiera.example' \
 *        --data '{"que":"aprobar","motivo":"aprobado por el oficial"}'
 *
 *   → {"ok":true,"estado":"APROBADO"}
 *
 * Y el ledger append-only quedaba con un hecho `origen: HUMANO` que ninguna
 * persona escribió. Irreversible, porque no hay borrado.
 *
 * `text/plain` no es un descuido del atacante: es la forma conocida de que el
 * navegador NO pida permiso al servidor antes de enviar (una petición simple no
 * dispara la comprobación previa de CORS). Por eso exigir JSON no es cosmética:
 * es lo que obliga al navegador a preguntar primero, y a que este servidor
 * pueda decir que no.
 *
 * Peor todavía: con un identificador inexistente, el mismo POST CREABA un
 * expediente cuyo primer y único hecho era una aprobación humana.
 *
 * ── LO QUE ESTO **NO** ES ─────────────────────────────────────────────────
 *
 * No es autenticación. Aquí no la hay, y está declarado en el README como
 * límite conocido: `--oficial` es un texto que alguien escribe, no una
 * identidad verificada contra un directorio. En una instalación de verdad, esa
 * identidad la pone el sistema del banco.
 *
 * Lo que sí impide es que una página web ajena escriba en el expediente sin
 * que nadie de la sucursal haya tocado nada, que era lo que pasaba.
 */
function escrituraRechazada (req, url, cuerpo) {
  // 1 · Solo JSON. Cierra la vía de la petición «simple» sin comprobación previa.
  const tipo = String(req.headers['content-type'] ?? '').split(';')[0].trim()
  if (tipo !== 'application/json') {
    return { codigo: 415, error: 'las escrituras exigen content-type: application/json' }
  }

  // 2 · El origen tiene que ser ESTE MISMO servidor. Si no hay cabecera es que
  //     no viene de un navegador (curl, un script): eso se permite, porque es
  //     exactamente cómo el juez reproduce la demostración desde la terminal.
  //
  //     «Este mismo servidor» se deduce de la cabecera Host, no de una
  //     constante: cuando la tableta de ventanilla abre la interfaz por la IP
  //     de la sucursal, su Origin es esa IP y no 127.0.0.1. Comparar contra un
  //     literal dejaba fuera al único dispositivo para el que se abrió el
  //     servidor a la red — verificado antes de que pasara en una demostración.
  const origen = req.headers.origin
  if (origen && origen !== `http://${req.headers.host}` && origen !== `https://${req.headers.host}`) {
    return { codigo: 403, error: `una página de ${origen} no escribe en un expediente de esta sucursal` }
  }
  // Y si el navegador dice de dónde viene, se le cree cuando dice que es de fuera.
  if (String(req.headers['sec-fetch-site'] ?? 'same-origin') !== 'same-origin') {
    return { codigo: 403, error: 'petición de otro sitio: no se escribe en el expediente' }
  }

  // 3 · Un POST NO crea expedientes. Escribir sobre lo que no existe creaba un
  //     ledger cuyo primer hecho era una firma humana que nadie firmó.
  const id = decodeURIComponent(url.pathname.split('/').pop())
  // `capturar` es la excepción declarada: es el único que puede crear, porque
  // capturar ES hacer que algo exista. Todo lo demás escribe sobre lo que ya hay.
  const esCaptura = url.pathname.startsWith('/api/capturar/')
  if (!esCaptura && !existsSync(join(DATOS, `${id}.jsonl`))) {
    return { codigo: 404, error: `no existe el expediente ${id}: una decisión no lo crea` }
  }

  // 4 · ── EL ROL, Y AQUÍ ES DONDE TIENE QUE ESTAR ──────────────────────────
  //
  // Esconder el botón NO es aplicar un rol: es disimularlo. Cualquiera con la
  // dirección puede llamar a la API sin abrir la interfaz —de hecho, así lo
  // prueba la suite—, así que la separación de funciones vive aquí o no vive.
  //
  // Quién puede qué lo dice el ESQUEMA (`instancias/banca/esquema.json`), no
  // este archivo. El servidor solo comprueba lo que el esquema declara.
  //
  // Un esquema SIN roles no limita a nadie: es como se comportaba antes de que
  // esto existiera, y el de salud no tiene ventanilla que separar.
  //
  // ⚠️ Y se dice lo que NO es: esto no autentica. Nadie comprueba que quien
  // dice ser Marta lo sea. Impide que un rol haga lo que su rol no hace, que
  // es más modesto y también más honesto.
  const roles = esquema.roles ?? {}
  if (Object.keys(roles).filter(r => !r.startsWith('$')).length) {
    // `decidir` no es una acción: son dos. Un banco puede querer que el mismo
    // rol apruebe y rechace, o que rechazar esté más repartido que aprobar —y
    // el esquema tiene que poder decirlo. Por eso la acción sale de `que`.
    const ruta = url.pathname.split('/')[2]
    const accion = ruta === 'decidir'
      ? String(cuerpo?.que ?? '').trim() || 'aprobar'
      : ACCION_DE_RUTA[ruta]
    const rol = String(cuerpo?.rol ?? '').trim()
    if (accion) {
      if (!rol) {
        return { codigo: 403, error: `esta sucursal separa funciones: di con qué rol actúas para ${accion}` }
      }
      const decl = roles[rol]
      if (!decl) {
        const hay = Object.keys(roles).filter(r => !r.startsWith('$'))
        return { codigo: 403, error: `el rol "${rol}" no existe aquí. Los declarados: ${hay.join(', ')}` }
      }
      if (!decl.puede.includes(accion)) {
        return {
          codigo: 403,
          error: `${decl.titulo ?? rol} no puede ${accion}` +
                 (decl.puede.length ? `: su función es ${decl.puede.join(', ')}` : ': su función es leer, no escribir') +
                 '. Es control dual, no un fallo.'
        }
      }
    }
  }
  return null
}

/**
 * Qué acción del esquema corresponde a cada ruta de escritura.
 *
 * `decidir` NO está aquí: se resuelve arriba a partir de `cuerpo.que`, porque
 * aprobar y rechazar son dos permisos distintos y un banco tiene derecho a
 * repartirlos de forma distinta.
 */
const ACCION_DE_RUTA = Object.freeze({
  resolver: 'resolver',
  capturar: 'capturar'
})

function leerCuerpo (req) {
  return new Promise((resolver, rechazar) => {
    let d = ''
    req.on('data', c => { d += c; if (d.length > 1e6) rechazar(new Error('cuerpo demasiado grande')) })
    req.on('end', () => { try { resolver(d ? JSON.parse(d) : {}) } catch (e) { rechazar(e) } })
  })
}

// ── A QUÉ INTERFAZ SE ESCUCHA, Y POR QUÉ HAY QUE PEDIRLO ──────────────────
//
// Por defecto, SOLO loopback: un expediente bancario no se sirve a la red
// porque alguien arrancó la demo en un café. Esa sigue siendo la postura.
//
// Pero una sucursal de verdad tiene la tableta de ventanilla y el equipo del
// fondo, y son dos máquinas. Para eso está `--host 0.0.0.0`: hay que
// escribirlo, se avisa en pantalla de lo que implica, y quien lo escribe sabe
// lo que hace. Un valor por defecto que expone a la red es un accidente
// esperando; una bandera explícita es una decisión.
const HOST = arg('host', '127.0.0.1')
const ABIERTO = HOST !== '127.0.0.1' && HOST !== 'localhost'

servidor.listen(PUERTO, HOST, () => {
  const V = '\x1b[0;32m', A = '\x1b[0;33m', C = '\x1b[0;36m'
  const G = '\x1b[0;90m', B = '\x1b[1m', N = '\x1b[0m'
  console.log(`\n  ${V}✓${N} ${B}http://${ABIERTO ? ipDeLan() : '127.0.0.1'}:${PUERTO}${N}`)
  console.log(`  ${G}${esquema.dominio} / ${esquema.entidad} · datos en ${DATOS}${N}`)
  console.log(`  ${G}reglas de dominio: ${dominio.origen ?? 'ninguna declarada'}${N}`)
  if (ABIERTO) {
    console.log(`\n  ${A}${B}⚠ ABIERTO A LA RED LOCAL${N}  ${G}(--host ${HOST})${N}`)
    console.log(`  ${G}cualquiera en esta red puede abrir y firmar expedientes: aquí no hay`)
    console.log(`  autenticación. Vale para una red aislada de sucursal, no para un café.${N}`)
  } else {
    console.log(`  ${G}cero dependencias, cero build. Solo loopback: no se sirve a la red${N}`)
    console.log(`  ${G}para la tableta de ventanilla:  --host 0.0.0.0${N}`)
  }
  console.log(`\n  ${C}Ctrl+C para parar${N}\n`)
})

/** La IP de LAN, para poder teclearla en la tableta sin ir a buscarla. */
function ipDeLan () {
  for (const listas of Object.values(networkInterfaces())) {
    for (const i of listas ?? []) {
      if (i.family === 'IPv4' && !i.internal) return i.address
    }
  }
  return HOST
}

process.once('SIGINT', () => { servidor.close(); process.exit(0) })
process.once('SIGTERM', () => { servidor.close(); process.exit(0) })
