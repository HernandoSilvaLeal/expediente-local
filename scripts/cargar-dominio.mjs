// scripts/cargar-dominio.mjs — carga las guardias que el esquema declara.
//
// ═══════════════════════════════════════════════════════════════════════════
//   Esto vive FUERA de core/ a propósito, y no es un detalle de organización.
// ═══════════════════════════════════════════════════════════════════════════
//
// El núcleo no puede importar `instancias/*` —hay un verificador que lo impide—
// porque en el momento en que lo hiciera dejaría de ser genérico. Pero alguien
// tiene que cargar las reglas de banca, y ese alguien es quien ARRANCA el
// sistema: el CLI, el servidor de la interfaz, un test.
//
// El esquema dice DÓNDE están sus guardias. Este archivo las trae. `core/` las
// recibe ya cargadas y no sabe de dónde salieron.
//
// Cambiar de dominio sigue siendo cambiar un `.json`.

import { pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * @param {object} esquema   el que devolvió cargarEsquema()
 * @param {object} contexto  lo que las guardias necesitan de fuera: `hoy`, plazos…
 * @returns {{revisar: function|null, contexto: object, origen: string|null}}
 */
export async function cargarDominio (esquema, contexto = {}) {
  if (!esquema?.guardiasDominio) {
    // Un esquema sin guardias de dominio es legítimo: el de salud no tiene
    // cédulas panameñas que validar. No es un error, es otro dominio.
    return { revisar: null, contexto, origen: null }
  }

  try {
    const ruta = resolve(RAIZ, esquema.guardiasDominio)
    const mod = await import(pathToFileURL(ruta).href)
    if (typeof mod.revisarDominio !== 'function') {
      throw new Error('el módulo no exporta revisarDominio()')
    }
    return { revisar: mod.revisarDominio, contexto, origen: esquema.guardiasDominio }
  } catch (e) {
    // NO se sigue en silencio, y esa es la decisión importante de este archivo.
    //
    // Un expediente bancario validado SIN las reglas de banca **parece
    // validado y no lo está**. Es la clase de fallo que solo se descubre
    // cuando ya hay un dato malo firmado por una persona, y para entonces la
    // pregunta deja de ser técnica.
    throw new Error(
      `El esquema declara guardias de dominio en "${esquema.guardiasDominio}" y no se pudieron ` +
      `cargar: ${e.message}\n` +
      'Continuar sin ellas produciría expedientes que PARECEN validados y no lo están.')
  }
}
