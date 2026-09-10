// core/prompt.mjs — el prompt se GENERA del esquema. Y por eso se puede probar.
//
// ═══════════════════════════════════════════════════════════════════════════
//   Un prompt escrito a mano se desincroniza del esquema en cuanto alguien
//   añade un campo, y el modelo empieza a devolver cosas que nadie valida.
// ═══════════════════════════════════════════════════════════════════════════
//
// Vive en `core/` y no en `ia/` porque es una función PURA del esquema: no
// necesita modelo, no necesita red, y sí necesita tests. El prompt es la
// instrucción más importante de todo el sistema y estaba a punto de quedarse
// en el único directorio donde los tests no llegan.
//
// ── LA INSTRUCCIÓN QUE NO ES OPCIONAL ──────────────────────────────────────
//
// La CITA. Sin ella, `anclaje.mjs` rechaza absolutamente todos los campos y el
// sistema no extrae nada. El esquema la exige por gramática —llama.cpp compila
// el json_schema a GBNF—, pero la gramática solo obliga a que el campo EXISTA:
// el modelo cumple el trámite devolviendo la cadena vacía. Hay que decirle para
// qué sirve, y que un programa la va a comprobar.
//
// PROHIBIDO aquí: importar @qvac/sdk. Verificado por scripts/verificar-frontera.mjs

/**
 * Construye el mensaje de sistema para un esquema dado.
 *
 * Las cinco reglas están en orden de importancia deliberado: los modelos
 * pequeños atienden más al principio de la instrucción que al final, así que
 * la cita va primero y el formato de salida va último.
 *
 * @param {object} esquema  el que devolvió cargarEsquema()
 * @returns {string}
 */
export function construirSistema (esquema) {
  const entidad = esquema?.entidad ?? 'registro'
  const dominio = esquema?.dominio ?? 'general'

  const lineas = [
    `Extraes campos de un ${entidad} en el dominio ${dominio}.`,
    '',
    'REGLAS, en orden de importancia:',
    '',
    '1. CADA campo lleva su "cita": el fragmento LITERAL del texto de entrada de',
    '   donde sale ese valor. Copia las palabras exactas, sin reescribirlas.',
    '2. Si un dato NO está en el texto, NO lo inventes: deja el valor vacío y la',
    '   cita vacía. Un hueco es una respuesta correcta.',
    '3. La cita tiene que contener el valor. Si citas una frase donde el valor no',
    '   aparece, el campo se descarta entero.',
    '4. No deduzcas ni completes. Si el texto dice que UNO de tres tiene ocho años,',
    '   eso NO significa que los tres los tengan.',
    '5. Responde solo con el JSON. Sin explicación, sin markdown, sin comentarios.'
  ]

  // Los campos críticos se nombran EXPLÍCITAMENTE. Son los que, si faltan,
  // impiden que el expediente llegue a COMPLETO, así que merecen el aviso.
  const criticos = esquema?.camposCriticos ?? []
  if (criticos.length) {
    lineas.push(
      '',
      `Presta especial atención a: ${criticos.join(', ')}.`,
      'Si alguno no está en el texto, déjalo vacío en vez de aproximarlo.'
    )
  }

  lineas.push(
    '',
    'Un programa comprueba cada cita con una búsqueda literal sobre el texto original.',
    'Lo que no encaje se descarta. Inventar no pasa desapercibido: solo pierde el campo.'
  )

  return lineas.join('\n')
}

/**
 * La regla 4 en un ejemplo, para cuando el modelo la ignore.
 *
 * No se añade al prompt por defecto: alarga el contexto y en las pruebas el
 * modelo cumplía sin él. Existe porque si en la medición del lote el fallo de
 * propagación vuelve a aparecer, esto es lo primero que se prueba — y estar ya
 * escrito ahorra tenerlo que redactar a las tres de la mañana.
 */
export const EJEMPLO_ANTIPROPAGACION = [
  'Ejemplo de lo que NO debes hacer:',
  '',
  '  Texto:  "hay tres equipos y UNO de ellos parece de unos ocho años"',
  '  MAL:    tres equipos, cada uno con antigüedad 8',
  '  BIEN:   tres equipos; solo uno con antigüedad 8, citando "UNO de ellos parece de unos ocho años"',
  '',
  'Lo que se dice de uno no se dice de todos.'
].join('\n')
