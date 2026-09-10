// scripts/lista-negra.mjs — lo que NO puede aparecer en un repositorio público.
//
// ═══════════════════════════════════════════════════════════════════════════
//   Vive en su propio archivo porque lo usan DOS scripts, y la copia que
//   tenía cada uno terminó cazándose a sí misma.
// ═══════════════════════════════════════════════════════════════════════════
//
// La historia, que vale la pena porque es un patrón y no un accidente:
//
//   1. `verificar-entrega.mjs` tenía la lista y comprobaba el repositorio.
//   2. `audit-all.mjs` guarda la salida de ese comando en `audit/entrega.json`.
//   3. Cuando una puerta fallaba, su diagnóstico NOMBRABA lo que encontró.
//   4. Al guardarlo, el artefacto público pasaba a contener ese término.
//   5. En la corrida siguiente, la puerta se encontraba a sí misma.
//
// Se intentó arreglar dando a `audit-all` su propia lista para sanear. Peor:
// entonces era `audit-all.mjs` el que contenía los literales, y la puerta lo
// señalaba a él. **Dos archivos con la misma lista, uno cazando al otro.**
//
// La lista vive aquí, sin ejecutar nada al importarse. Ese detalle importa:
// importar `verificar-entrega.mjs` corría las quince puertas como efecto
// secundario, así que `audit-all` las ejecutaba dos veces.
//
// Este archivo ES una excepción declarada de sí mismo: contiene los términos
// por definición. `verificar-entrega.mjs` lo excluye de su barrido, igual que
// se excluye a sí mismo.

/** Términos que descalifican si aparecen en el repositorio público. */
export const LISTA_NEGRA = Object.freeze([
  { re: /\bappcors\b/i,   por: 'nombre de la empresa: no pinta nada en este repo' },
  { re: /\bqinbix\b/i,    por: 'producto interno' },
  { re: /\bbraincors\b/i, por: 'producto interno' },
  { re: /\bcorsbuild\b/i, por: 'producto interno' },
  { re: /\bbasti[oó]n\b/i, por: 'jerga interna de organización' },
  { re: /\bcoronel(es)?\b/i, por: 'jerga interna de organización' },
  { re: /\btriaxis\b/i,   por: 'jerga interna' },
  { re: /\bvibranio\b/i,  por: 'jerga interna' },
  { re: /\bjarvisq\b/i,   por: 'proyecto de referencia ajeno al reto' },
  // `SOVEREIGN` en mayúsculas y solo, es el protocolo interno.
  // «Sovereign Intelligence» es el NOMBRE OFICIAL del track 03 y es legítimo.
  { re: /\bSOVEREIGN\b(?!\s+Intelligence)/, por: 'protocolo interno (el track 03 sí puede nombrarse)' },
  { re: /hackQVAC/,       por: 'ruta del repositorio de trabajo, que no se publica' },
  { re: /_contextInit|_metahack|_victoryPlan/, por: 'directorios del corpus privado' }
])

/**
 * Los archivos que contienen los términos POR DEFINICIÓN y no son una fuga.
 *
 * Es una lista corta y cerrada a propósito: cada entrada es un permiso para
 * esconder algo, y un permiso de más convierte la puerta en decorativa.
 */
export const AUTOEXCLUIDOS = Object.freeze([
  'scripts/lista-negra.mjs',
  'scripts/verificar-entrega.mjs'
])
