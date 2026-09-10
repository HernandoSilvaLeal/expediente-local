// pruebas/frontera.test.mjs — QUE EL NÚMERO QUE SE DICE EN CÁMARA SEA EL REAL.
//
// ═══════════════════════════════════════════════════════════════════════════
//   Este proyecto publicó «94,4 % determinista» durante días. Era falso: el
//   contador daba por hecho que solo `ia/` toca el modelo, y contaba CARPETAS
//   en vez de mirar qué importa cada archivo. El número real era 83,3 %.
//
//   Nadie lo notó porque no había ninguna prueba sobre el contador. Esta suite
//   existe para que no vuelva a pasar en silencio.
// ═══════════════════════════════════════════════════════════════════════════
//
// Lo que se protege aquí no es un porcentaje: es la distinción entre las tres
// cosas que ese porcentaje puede querer decir. Fundirlas en una es el fallo que
// el proyecto entero existe para atacar, cometido sobre nosotros mismos.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { contarFrontera, modulosDelSistema, CARPETAS } from '../scripts/frontera.mjs'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const f = contarFrontera(RAIZ)

// ── LOS TRES CORTES SON TRES, Y ESTÁN ANIDADOS ──────────────────────────────

test('los tres cortes están anidados: decidir ⊆ inferir ⊆ importar', () => {
  // Si un módulo decide qué entra sin inferir, o infiere sin importar el SDK,
  // el contador se ha roto de una forma que ningún porcentaje delataría: los
  // tres números seguirían saliendo, solo que sin significar lo que dicen.
  for (const m of f.decidenQueEntra) assert.ok(f.ejecutanInferencia.includes(m),
    `${m} decide qué entra pero no ejecuta inferencia`)
  for (const m of f.ejecutanInferencia) assert.ok(f.importanSdk.includes(m),
    `${m} infiere pero no importa el SDK`)
})

test('los tres cortes son estrictamente distintos entre sí', () => {
  // El día que los tres den lo mismo, publicar tres números pasa a ser ruido
  // con aspecto de rigor. Esta prueba obliga a mirar por qué antes de seguir
  // afirmándolo.
  assert.ok(f.importanSdk.length > f.ejecutanInferencia.length,
    'algún módulo debe importar el SDK sin inferir — hoy es el transporte P2P')
  assert.ok(f.ejecutanInferencia.length > f.decidenQueEntra.length,
    'algún módulo debe inferir para OTRO dispositivo sin meter datos aquí')
})

// ── EL CASO QUE MOTIVÓ TODO ESTO ────────────────────────────────────────────

test('el proveedor de la malla importa el SDK y NO cuenta como que infiere', () => {
  // `malla/proveedor.mjs` usa startQVACProvider/stopQVACProvider: abre el
  // transporte entre aparatos. Contarlo como «toca IA» es correcto; contarlo
  // como «infiere» sería falso, y contarlo como «puede meter un dato en el
  // expediente» sería una mentira con decimales.
  const m = 'malla/proveedor.mjs'
  assert.ok(f.importanSdk.includes(m), 'debería contar como que importa el SDK')
  assert.ok(!f.ejecutanInferencia.includes(m), 'NO debería contar como que infiere')
  assert.ok(!f.decidenQueEntra.includes(m), 'NO debería contar como que decide')
})

test('el motor de la malla infiere, pero para OTRO dispositivo', () => {
  const m = 'malla/motor.mjs'
  assert.ok(f.ejecutanInferencia.includes(m), 'el motor sí infiere')
  assert.ok(!f.decidenQueEntra.includes(m),
    'su salida sirve a otro aparato: no entra a este expediente')
})

test('el extractor es el único cuya salida puede acabar en un expediente', () => {
  // Es el número que sostiene la doctrina, así que es el que más vigilancia
  // necesita: si algún día son dos, la frase «uno solo» deja de ser cierta y
  // hay que cambiarla antes de decirla en voz alta.
  assert.deepEqual(f.decidenQueEntra, ['ia/extraer.mjs'])
})

// ── QUE EL CONTADOR CUENTE LO QUE DICE CONTAR ───────────────────────────────

test('se cuenta por imports, no por carpeta — el fallo original', () => {
  // La versión rota daba `conModelo = archivos de ia/`, o sea 1 de 18 → 94,4 %.
  // Si alguien vuelve a esa forma, este test se pone rojo: hay módulos fuera de
  // `ia/` que importan el SDK.
  const fueraDeIa = f.importanSdk.filter(m => !m.startsWith('ia/'))
  assert.ok(fueraDeIa.length > 0,
    'hay módulos fuera de ia/ que importan el SDK: contar por carpeta miente')
})

test('un comentario que NOMBRA el SDK no cuenta como importarlo', () => {
  // Casi todos los módulos del núcleo llevan escrito «PROHIBIDO aquí: importar
  // @qvac/sdk». Buscar el nombre a secas daba que el 89 % del sistema toca el
  // modelo, cuando es justo al revés. Van siete veces del mismo patrón.
  const menciona = modulosDelSistema(RAIZ).filter(m =>
    m.startsWith('core/') && readFileSync(join(RAIZ, m), 'utf8').includes('@qvac/sdk'))
  assert.ok(menciona.length > 0, 'debería haber módulos de core/ que lo mencionan')
  for (const m of menciona) assert.ok(!f.importanSdk.includes(m),
    `${m} solo lo menciona en un comentario: no puede contar como import`)
})

test('el contador se excluye a sí mismo y lo declara', () => {
  // El archivo que define los patrones los contiene, así que se contaría como
  // que importa el SDK. Es el verificador formando parte de lo verificado.
  assert.ok(!f.modulos.some(m => m.endsWith('frontera.mjs')))
})

// ── LOS PORCENTAJES, Y QUE NO SE PUEDAN INFLAR ──────────────────────────────

test('los porcentajes cuadran con las cuentas, sin redondeos amables', () => {
  const pct = n => +(100 * (f.total - n) / f.total).toFixed(1)
  assert.equal(f.porcentajeSinSdk, pct(f.importanSdk.length))
  assert.equal(f.porcentajeSinInferencia, pct(f.ejecutanInferencia.length))
  assert.equal(f.porcentajeNoDeciden, pct(f.decidenQueEntra.length))
  // Y el orden: cuanto más estricto el corte, mejor sale el número. Publicar
  // solo el mejor sería exagerar a nuestro favor.
  assert.ok(f.porcentajeSinSdk <= f.porcentajeSinInferencia)
  assert.ok(f.porcentajeSinInferencia <= f.porcentajeNoDeciden)
})

test('`scripts/` queda fuera del universo contado, a propósito', () => {
  // Meter las 15 herramientas de verificación subiría el porcentaje varios
  // puntos sin haber cambiado una línea del producto. Es la forma más fácil de
  // maquillar este número, así que se cierra con un test.
  assert.ok(!CARPETAS.includes('scripts'))
  assert.ok(!f.modulos.some(m => m.startsWith('scripts/')))
})

test('el universo contado no está vacío ni es sospechosamente pequeño', () => {
  // Un contador que no encuentra archivos devuelve 100 % determinista, que es
  // el número más bonito posible y el más falso. Falla ruidoso en vez de
  // publicar un perfecto.
  assert.ok(f.total >= 10, `solo ${f.total} módulos: el contador no está mirando el sistema`)
})

// ── Y QUE LO QUE SE PUBLICA COINCIDA CON LO QUE SE CUENTA ───────────────────

test('el README publica los tres cortes con las cifras medidas', () => {
  // El README es lo que lee el jurado. Si el contador cambia y el README no,
  // vuelve a haber una afirmación pública que ningún comando sostiene — que es
  // exactamente de lo que este proyecto acusa a los demás.
  const readme = readFileSync(join(RAIZ, 'README.md'), 'utf8').replace(/[*_`]/g, '')
  const coma = n => String(n).replace('.', ',')
  for (const n of [f.porcentajeSinSdk, f.porcentajeSinInferencia, f.porcentajeNoDeciden]) {
    assert.ok(readme.includes(`${coma(n)} %`), `el README no publica el ${coma(n)} %`)
  }
})
