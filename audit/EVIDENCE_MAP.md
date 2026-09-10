# Mapa de evidencia

> Cada afirmación de este proyecto, con **el archivo que la implementa y el comando que la
> comprueba**. Generado por `npm run audit:all` — no escrito a mano.

**Por qué existe este archivo:** porque nadie entrega el mapa que hace su propio trabajo fácil
de auditar, y es exactamente lo que convierte «confíe en mí» en «compruébelo usted».

Regenerado: 2026-09-10T17:21:50.233Z

| Afirmación | Dónde vive | Evidencia | Comando |
|---|---|---|---|
| El núcleo corre sin modelo, sin red y sin el SDK | `core/*` | 349 tests | `npm test` |
| Hay un test que falla si el núcleo importa el SDK | `scripts/verificar-frontera.mjs` | verificado en positivo y negativo | `npm run test:frontera` |
| El sistema funciona con la red cortada | `scripts/smoke.mjs` | lo:DOWN, curl→000, JSON válido | `unshare -rn bash -c 'npm run smoke'` |
| El sistema se niega a hacer 54 de 64 transiciones | `core/estado.mjs` | T2-ilegal, una por cada una | `npm run metricas` |
| Un valor sin cita literal no entra al dataset | `core/anclaje.mjs` | T3-01..05 | `npm test` |
| Los errores del modelo son REALES, no inventados | `pruebas/anclaje.test.mjs` | T3-medido-1..5 | `npm test` |
| El software nunca aprueba solo | `core/estado.mjs · SOLO_HUMANO` | T2-humano ×6 | `npm test` |
| Y no se aprueba sin decir QUIÉN firma | `core/expediente.mjs · decidir()` | CU-24 | `npm test` |
| El firmante va dentro del hash: cambiarlo rompe la cadena | `core/ledger.mjs · crearEvento` | CU-24 | `npm run verify:invariantes` |
| Dos fuentes que se contradicen NO se resuelven solas | `core/proyeccion.mjs · asentar()` | CU-19, CU-20, CU-23 | `npm test` |
| Un conflicto abierto impide cerrar Y impide firmar | `core/calidad.mjs · puedeCerrar` | CU-23 | `npm test` |
| El log de inferencia NO afirma dónde corrió, porque el SDK no lo dice | `ia/extraer.mjs · ejecutadoEn` | NO_REPORTADO, declarado | `cat audit/inference_log.csv` |
| El anclaje es determinista | `core/anclaje.mjs` | T3-19, mil corridas | `npm test` |
| El expediente se regenera del ledger | `core/proyeccion.mjs` | T5-O5, matando el proceso | `npm test` |
| No existe forma de actualizar ni borrar un hecho | `core/ledger.mjs` | T5-01, once nombres prohibidos | `npm test` |
| Los cinco invariantes se cumplen sobre datos reales | `scripts/verificar-invariantes.mjs` | 5/5 | `npm run verify:invariantes` |
| El verificador SÍ detecta las violaciones | `pruebas/invariantes.test.mjs` | T15, once corrupciones | `npm test` |
| De cero a funcionando en un clon limpio | `audit/clon-limpio.json` | 193 s sin caché | `ver el JSON` |
| Dos corridas producen el mismo resultado | `audit/determinismo.json` | idénticas | `npm run audit:all` |
| Nada de lo que descalifica está presente | `scripts/verificar-entrega.mjs` | REVISAR | `npm run verify:entrega` |
| La delegación existe en 0.18.2 y no en 0.19.0 | `malla/proveedor.mjs` | clave pública en 8.419 ms | `node malla/proveedor.mjs` |
| ⚫ Inferencia delegada entre dos máquinas | `—` | **NO MEDIDO** | `pendiente` |

---

## Lo que NO está medido

Se lista aquí y no en letra pequeña. **Un número que no se puede reproducir delante de alguien
no se publica.**

| Qué | Por qué falta |
|---|---|
| Inferencia delegada entre dos máquinas físicas | El proveedor arranca y emite clave pública en 8.419 ms, con identidad reproducible. Falta un consumidor conectándose y recibiendo inferencia de vuelta |
| `audit/inference_log.csv` | Se rellena al correr `ia/extraer.mjs` contra el modelo. Se emite **vacío** a propósito |
| `strace` sobre una demo completa | El análisis estático de `remote_calls.json` demuestra que el código no PIDE la red; solo `strace` demuestra que el proceso no la USA |
| OCR sobre fotografías reales | Lo probado es imagen sintética |
| Tiempo de descarga de los pesos | El clon limpio SÍ está medido: 193 s |

---

## Cómo regenerar todo esto

```bash
npm ci
npm run audit:all        # regenera cada artefacto de este directorio
```

Si algún número de aquí no coincide con el que sale en tu máquina, **el que vale es el tuyo**.
