// ─────────────────────────────────────────────────────────────────────────────
// LA FRONTERA, CONTADA UNA SOLA VEZ
// ─────────────────────────────────────────────────────────────────────────────
//
// Este archivo existe por un patrón que ya nos costó caro dos veces: la misma
// cuenta copiada en dos sitios, hasta que uno de los dos se queda viejo y acaba
// cazando al otro. Pasó con el expediente de prueba y pasó con la lista negra.
//
// Aquí la tentación era peor todavía, porque las dos copias tenían coartada:
//
//   · `scripts/metricas.mjs` publica los tres cortes en pantalla.
//   · `scripts/verificar-entrega.mjs` comprueba que `docs/PROBLEMA.md` no
//     afirma un número distinto del real — y NO puede llamar a metricas.mjs,
//     porque ese script corre los 370 tests por dentro y la puerta pasaría de
//     un segundo a más de dos minutos.
//
// Con la cuenta duplicada, la puerta habría comprobado el documento contra su
// PROPIA copia de la regla. Es P5 —el que comprueba siendo parte de lo
// comprobado— disfrazado de optimización. Aquí no hay efectos al importar: solo
// lee archivos y devuelve números.
//
// ── POR QUÉ TRES CORTES Y NO UN PORCENTAJE ───────────────────────────────────
//
// «El 83,3 % es determinista» suena a una afirmación y son tres. Importar el
// SDK, ejecutar inferencia y decidir qué entra al expediente son cosas
// distintas, y el proyecto afirma cosas distintas sobre cada una:
//
//   · `malla/proveedor.mjs` importa el SDK para abrir el transporte entre
//     aparatos (startQVACProvider). No infiere nada.
//   · `malla/motor.mjs` sí infiere, pero sirve a OTRO dispositivo: su salida no
//     entra a este expediente.
//   · `ia/extraer.mjs` es el único cuya salida puede acabar en un expediente, y
//     por eso es el que sostiene la doctrina.
//
// Fundir los tres en un número es la misma clase de error que este proyecto
// existe para atacar. Y ya nos pasó: durante días se publicó 94,4 % porque el
// contador asumía la respuesta POR LA CARPETA en vez de mirar los imports.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** Carpetas que forman «el sistema» a efectos de esta cuenta. `scripts/` queda
 *  fuera a propósito: son herramientas de verificación, no el entregable, y
 *  meterlas inflaría el porcentaje a nuestro favor sin haber cambiado nada. */
export const CARPETAS = Object.freeze(['core', 'ia', 'malla', 'ui'])

/** Un import de varias líneas —el de `ia/extraer.mjs` lo es— no cabe en una
 *  sola, así que se busca el `from '@qvac/sdk'` final y no la línea `import`.
 *  Buscarlo de la otra forma lo daba por ausente, y van siete veces del mismo
 *  patrón: buscar texto donde hace falta mirar el contenido. */
const IMPORTA_SDK = /from\s*['"]@qvac\/sdk['"]|import\s*\(\s*['"]@qvac\/sdk/

/** Las funciones del SDK que ponen un modelo a trabajar. `startQVACProvider` y
 *  `stopQVACProvider` NO están aquí, y esa ausencia es el punto entero del
 *  archivo: abren el transporte P2P, no infieren. */
const INFIERE = /\b(loadModel|completion|batchCompletion|embed|transcribe|ocr)\b/

/** Ficheros que se saltan: los que existen para comprobar la frontera acabarían
 *  contándose como si la cruzaran. Es P5, y se declara en vez de esconderse. */
const AUTOEXCLUIDOS = Object.freeze(['frontera.mjs'])

export function modulosDelSistema (raiz) {
  const modulos = []
  for (const dir of CARPETAS) {
    const d = join(raiz, dir)
    if (!existsSync(d)) continue
    for (const f of readdirSync(d).sort()) {
      if (f.endsWith('.mjs') && !AUTOEXCLUIDOS.includes(f)) modulos.push(join(dir, f))
    }
  }
  return modulos
}

/**
 * Cuenta los tres cortes sobre el código real. No corre tests, no arranca nada:
 * lee archivos. Por eso una puerta puede llamarlo veinte veces al día.
 */
export function contarFrontera (raiz) {
  const modulos = modulosDelSistema(raiz)
  const fuente = new Map(modulos.map(m => [m, readFileSync(join(raiz, m), 'utf8')]))

  const importanSdk = modulos.filter(m => IMPORTA_SDK.test(fuente.get(m)))
  const ejecutanInferencia = importanSdk.filter(m => INFIERE.test(fuente.get(m)))
  // Quien infiere para otro aparato no mete datos en ESTE expediente.
  const decidenQueEntra = ejecutanInferencia.filter(m => !m.startsWith('malla/'))

  const total = modulos.length
  const resto = n => (total ? +(100 * (total - n) / total).toFixed(1) : 0)

  return {
    total,
    modulos,
    importanSdk,
    ejecutanInferencia,
    decidenQueEntra,
    // El porcentaje que queda FUERA de cada corte: es la forma en que se afirma
    // en el README y en docs/PROBLEMA.md, y así la puerta compara lo mismo que
    // el documento dice, sin darle la vuelta por el camino.
    porcentajeSinSdk: resto(importanSdk.length),
    porcentajeSinInferencia: resto(ejecutanInferencia.length),
    porcentajeNoDeciden: resto(decidenQueEntra.length)
  }
}
