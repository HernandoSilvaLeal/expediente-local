<p align="center">
  <img src="docs/banner.jpeg" alt="Expediente Local — si internet se cae, sigue pensando" width="700">
</p>

# Expediente Local

> Admisión y validación de expedientes de cliente en una sucursal bancaria,
> con toda la inteligencia artificial corriendo en el propio equipo del banco.

| | |
|---|---|
| **Equipo** | DevCors — Hernando Silva Leal |
| **Evento** | Decentralized AI Hackathon · ISD / Tether-QVAC · septiembre 2026 |
| **Desafíos** | AI Descentralizada para la Banca (Caja de Ahorros) · Sovereign Intelligence at the Edge |
| **Video** | *(pendiente)* |
| **SDK** | `@qvac/sdk@0.18.2` — **versión fijada exacta**, sin `^`, sin `latest` |
| **Inferencia** | **100 % en el dispositivo.** Cero llamadas a APIs de IA |

---

## El problema

Un banco necesita convertir documentos en datos estructurados.
Un modelo de lenguaje lo hace rápido y **miente con formato perfecto**.

Medido en esta máquina el 9-sep-2026, con un modelo local, `json_schema` activo y temperatura 0:

```
Entrada:  "tres resonadores magnéticos Siemens y un tomógrafo.
           UNO de los resonadores parece de unos ocho años"

Salida:   MRI ×3, antigüedad: 8         ← la edad se propagó a los TRES
          CT  ×1, fabricante: Siemens   ← la marca saltó al tomógrafo
          confianza: "Confirmado"       ← sobre un "parece"
```

**Tres errores. JSON perfectamente válido. Factualmente falso.**
El modelo garantiza la **forma**. Nunca el **fondo**.

---

## La respuesta

Cada campo que el modelo devuelve viene obligado por el esquema a traer su **cita**: el fragmento
literal del texto de donde salió. Una función pura comprueba, con `indexOf` sobre texto
normalizado, que esa cita **existe literalmente** en la fuente y que el valor **está dentro de la
cita**. Lo que no encaja no entra: se marca como desconocido, **con el motivo**.

> ### 🔑 LA REGLA DE ORO
> **El modelo no puede alucinar una cita que el software va a buscar con `indexOf`.**

No es un umbral de confianza inventado. No es coincidencia difusa. Es una comprobación
determinista y reproducible, y **los tres errores de arriba están como tests** en
[`pruebas/anclaje.test.mjs`](pruebas/anclaje.test.mjs). No son casos imaginados para lucirse:
son los fallos que este modelo produjo en esta máquina.

**Al modelo tampoco se le pregunta cuánta confianza tiene.** El reto pide un puntaje de confianza
y el sistema lo da, pero lo calcula el código leyendo *cómo lo dijo la fuente*: un atenuador
(«parece», «unos») baja a `Estimado`; un afirmador («según el documento», «consta») permite
`Confirmado`; una afirmación llana es `Reportado`. Ante la duda, baja.
*Un modelo calificándose a sí mismo es un examen sin vigilante.*

---

## ⚡ Compruébalo tú, en dos minutos

**No hace falta descargar ningún modelo para verificar casi todo.** El núcleo determinista corre
sin modelo, sin red y sin el SDK, y eso también es comprobable:

```bash
git clone https://github.com/HernandoSilvaLeal/expediente-local
cd expediente-local && npm ci
```

| Qué quieres comprobar | Comando | Qué sale |
|---|---|---|
| Que el núcleo funciona | `npm test` | **324 tests** en menos de un segundo |
| Que el núcleo **no puede** tocar el modelo | `npm run test:frontera` | falla con código 1 si `core/` importa el SDK |
| Que el sistema **corre sin red** | `unshare -rn bash -c 'npm run smoke'` | `lo: DOWN`, `curl → 000`, y JSON válido |
| Que nada descalifica | `npm run verify:entrega` | **13 puertas**, cada una eliminatoria |
| Que **cada guardia** hace su trabajo | `npm run casos` | **17 casos trampa**, cobertura G1..G10 — una por guardia, sin excepción |
| Que los datos del disco están sanos | `npm run verify:invariantes` | **5/5** invariantes, y `--demo` enseña el rojo |
| El estado real del proyecto | `npm run metricas` | el tablero, medido al ejecutarlo |
| **Los datos de ejemplo** | `npm run demo` | tres expedientes sembrados en 2 s: uno limpio, uno con invenciones, uno en conflicto |
| **La interfaz** | `npm start` → http://127.0.0.1:7301 | cero dependencias, cero build |

> **Si acabas de clonar, empieza por `npm run demo`.** El repositorio no trae
> datos —`datos/` está en el `.gitignore`, y un expediente bancario no se
> versiona— así que `npm start` a secas abre una página que solo sabe decirte
> que corras eso. Los tres expedientes que siembra son la explicación entera
> del proyecto, y son sintéticos y ficticios: ninguna persona real.

**El flujo completo, sin modelo:**

```bash
node cli.mjs revisar \
  --texto "$(cat instancias/banca/seed/dictado-01.txt)" \
  --extraccion instancias/banca/seed/extraccion-01-con-invenciones.json \
  --ledger /tmp/demo/e.jsonl
```

Ese archivo de extracción contiene, a propósito, **tres invenciones del tipo que un modelo
comete de verdad**. La salida enseña qué entró, qué no, y **qué guardia paró cada cosa**:

```
  LO QUE ENTRÓ AL EXPEDIENTE      cada valor con la cita que lo sostiene
     ● titular.nombre             Juan Pérez González
        «El titular es Juan Pérez González»

  LO QUE NO ENTRÓ, Y POR QUÉ      un hueco explicado vale más que un dato inventado
     ○ titular.cedula             G3 · SIN_ANCLAJE
     ○ documentos[0].emisor       G3 · SIN_ANCLAJE
```

### ⚔ Y cuando dos documentos del mismo expediente no dicen lo mismo

El formulario de apertura dice que el titular es Juan Pérez González. La carta
laboral del mismo expediente dice María Gómez Batista, con **la misma cédula**.

Las dos citas son literales, así que el anclaje no puede ayudar: ninguna de las
dos fuentes está inventando nada — **se contradicen entre ellas**. Un sistema
donde la última escritura gana convierte un expediente en otro sin que nadie se
entere, y eso en banca tiene nombre.

```
  ⚔ DOS FUENTES SE CONTRADICEN   el sistema NO elige: decide una persona
     ⚔ titular.nombre
        asentado:  «Juan Pérez González»   ←  El titular es Juan Pérez González
        propuesto: «María Gómez Batista»   ←  el titular es María Gómez Batista
```

El valor asentado **se conserva**, el conflicto queda levantado con las dos citas
enfrentadas, y la firma se para en seco:

```bash
node cli.mjs aprobar --ledger datos/EXP-003.jsonl --oficial "A. Ruiz" --texto "visto bueno"
#  ✗ No se puede aprobar: hay un campo con dos fuentes que se contradicen
#    (titular.nombre). Resuélvase el conflicto antes de firmar.
```

### ✍ Y no se firma sin decir quién firma

El evento de decisión decía `origen: HUMANO` y ahí se acababa la trazabilidad:
no decía **qué** humano. Un expediente aprobado del que no consta quién lo
aprobó es inauditable.

El **Acuerdo 1-2026** de la Superintendencia de Bancos de Panamá —vigente desde
el 16 de enero de 2026, que **deroga el 10-2015**— exige constancia documentada
de la debida diligencia (art. 10.4) y que el expediente permita **reconstruir**
la operación durante cinco años (art. 29). Sin firmante no hay reconstrucción.

```bash
node cli.mjs aprobar --ledger datos/EXP-001.jsonl --texto "Documentación conforme"
#  ✗ Aprobar exige identificar al oficial que firma. Una decisión sin firmante
#    no se puede reconstruir, y el expediente debe poder reconstruirse durante
#    cinco años.
```

Con firmante, queda escrito **dentro de la cadena de hashes** — cambiar el
nombre del oficial rompe `npm run verify:invariantes`:

```
  ✍ APROBAR  M. Batista · oficial de cuenta · suc. Vía España
     2026-09-10T12:33:42.309Z  ·  «Revisado en sucursal. Documentación conforme.»
```

Rechazarlo sí se permite: cerrar un expediente contradictorio es exactamente lo
que un oficial debe poder hacer. Fijado por **CU-19** y **CU-23**.

### 🧑 Y la salida del conflicto es una persona — el humano en el bucle

Parar sin dar salida no es cautela: es un callejón, y en una sucursal significa
un cliente que se va. El sistema detecta la contradicción y **se detiene ahí**,
porque cuál de los dos documentos vale no se resuelve leyendo los papeles: se
resuelve mirando a quien los trajo.

El comando sin argumentos enseña qué hay que resolver **y el comando exacto
para hacerlo**:

```bash
node cli.mjs resolver --ledger datos/EXP-003.jsonl
#  ⚔ UN CONFLICTO ABIERTO   elige una persona, y queda firmado
#     ⚔ titular.nombre
#        «Juan Pérez González»   ← El titular es Juan Pérez González
#        «María Gómez Batista»   ← el titular es María Gómez Batista
```

**Tres candados, y no se abren ni para el oficial:**

```bash
node cli.mjs resolver --ledger datos/EXP-003.jsonl \
  --campo titular.nombre --valor "Pedro Ramírez Him" \
  --oficial "A. Ruiz" --texto "me suena mejor"
#  ✗ «Pedro Ramírez Him» no es ninguno de los dos valores en disputa. Si el valor
#    correcto es otro, hace falta el documento que lo diga: ni una persona puede
#    asentar un dato que ninguna fuente afirma.
```

| El candado | Por qué existe |
|---|---|
| El **valor** es uno de los dos que ya están, con su cita | ni el humano introduce un dato sin fuente. Esa regla no tiene excepción |
| El **oficial**, obligatorio | una resolución anónima no se puede reconstruir |
| El **motivo**, obligatorio | un supervisor dentro de cuatro años necesita saber qué vio el oficial que el sistema no podía ver |

Resuelto, el campo se queda con **la cita de su propio documento** y la evidencia
**baja a Reportado**: una decisión humana entre dos documentos es un dato bien
fundado, no un dato mejor probado. Lo descartado **no se borra** — queda escrito
junto a quién lo descartó y por qué.

Es uno de los dos únicos eventos que pueden bajar el grado de evidencia de un
campo, y los dos los firma una persona. Fijado por **CU-25** y **T5-E03**.

También se hace desde la interfaz: es **el único sitio de toda la página donde
alguien escribe**. Todo lo demás se lee.

Y el expediente **no se puede aprobar** tampoco cuando le falta un campo crítico:

```bash
node cli.mjs aprobar --ledger /tmp/demo/e.jsonl --texto "confío" --oficial "A. Ruiz"
#  ✗ No se puede aprobar un expediente en estado VALIDADO
```

### ⭐ Y el mismo binario, con OTRA entidad

Sin recompilar y sin tocar una línea de `core/`. **Solo cambia un `.json`:**

```bash
node cli.mjs revisar \
  --esquema instancias/salud/esquema.json \
  --expediente EQ-001 \
  --texto "$(cat instancias/salud/seed/dictado-01.txt)" \
  --extraccion instancias/salud/seed/extraccion-01-los-tres-errores-medidos.json \
  --ledger /tmp/salud/e.jsonl
```

Esa extracción **es literalmente la que el modelo devolvió** el 9-sep-2026 sobre inventario
hospitalario, con los tres errores del principio de este README. El resultado:

```
  LO QUE NO ENTRÓ, Y POR QUÉ
     ○ equipos[0].antiguedad_anios   G3 · SIN_ANCLAJE   ← la edad propagada a los TRES
     ○ equipos[1].fabricante         G3 · SIN_ANCLAJE   ← la marca que saltó al tomógrafo
     ○ equipos[1].antiguedad_anios   G3, G4 · …         ← una edad que nadie dijo
```

Y lo verdadero entró: tres resonadores Siemens, un tomógrafo, la sede y la ciudad.
**No es un rechazo indiscriminado: es una comprobación.**

> **La tesis de esta entrega: no le pedimos al jurado que nos crea.
> Le dejamos el comando que lo comprueba.**

---

## Instalación

**Todos los comandos de arriba funcionan solo con los pasos 1 y 2.** Los pasos 3 y 4 hacen falta
únicamente para la extracción con modelo, porque descargan pesos.

```bash
# 1 · Clonar                                       (segundos)
git clone https://github.com/HernandoSilvaLeal/expediente-local
cd expediente-local

# 2 · Dependencias                                 (190 s SIN caché · 217 paquetes)
npm ci                    # NO uses `npm install`: el SDK va fijado exacto a 0.18.2

# 3 · Comprobar que funciona                       (1 s)
npm test                  # 324 tests, sin modelo y sin red
npm run smoke             # el flujo completo. Sale JSON y código 0

# 4 · Modelos — SOLO si quieres extracción con IA  (pendiente de cronometrar)
npm run setup             # descarga los pesos por registry://
```

### 🔵 De cero a funcionando: **3 min 13 s**

Medido el 10-sep-2026 en un `HOME` nuevo, **sin caché de npm**, clonando desde la URL pública:

| Paso | Tiempo |
|---|---|
| `git clone` | 2 s |
| `npm ci` (217 paquetes, sin caché) | 190 s |
| `npm test` → **324/324** | 1 s |
| **TOTAL** | **193 s** |

Y en ese clon recién hecho: frontera intacta, `npm run smoke` en verde y **todas las
puertas de entrega en PASS** — eran 11 el día de la medición; hoy son 13. El detalle está en [`audit/clon-limpio.json`](audit/clon-limpio.json).

> Se publica el caso **peor**: 190 de los 193 segundos son la descarga sin caché. En una
> máquina que ya tenga caché de npm es mucho menos.

**Requisito:** Node.js ≥ 20. **GPU opcional** — el sistema corre en CPU pura, más lento.

> ⚠️ **El SDK va fijado a 0.18.2 y no es un descuido.** La delegación de inferencia entre pares
> (`startQVACProvider`) **existe en 0.18.2 y no existe en 0.19.0** — comprobado importando el
> módulo en ambas versiones. Un `^` en `package.json` resolvería a 0.19.0 en tu máquina y
> rompería la mitad del proyecto. El uso de 0.18.2 está autorizado por la organización.

---

## Cómo funciona

```
   ENTRADA        foto de documento  ·  voz  ·  texto
      │
      ├─ IA   OCR determinista, confianza por bloque
      ├─ IA   Visión: SOLO clasifica el tipo de documento. Cero números
      ├─ IA   Dictado por voz
      ├─ IA   Modelo local: texto → campos {valor, cita}
      ▼
╔══════════════════════════════════════════════════════════════════════════╗
║          D E   A Q U Í   A B A J O   N O   H A Y   U N   M O D E L O     ║
║                                                                          ║
║   esquema.mjs      el esquema de entidad es un .json, no código          ║
║   anclaje.mjs      LA REGLA DE ORO — la cita debe existir en la fuente   ║
║   estado.mjs       máquina de estados; la tabla es un DATO               ║
║   guardias.mjs     G1 tipo · G2 rango · G3 procedencia · G4 unidades     ║
║                    G5 escape hatch — nunca se falla en silencio          ║
║   ledger.mjs       append-only. No existe `actualizar`. No existe        ║
║                    `borrar`: las funciones NO están escritas             ║
║   proyeccion.mjs   el expediente se DEDUCE de los hechos, no se guarda   ║
╚══════════════════════════════════════════════════════════════════════════╝
      │
      └─  MALLA P2P   la tableta pide inferencia al equipo de al lado
```

**El software propone; nunca aprueba.** `APROBADO` y `RECHAZADO` son las dos únicas transiciones
que exigen `origen: HUMANO`, y hay **seis tests** que comprueban que ni el modelo, ni una regla,
ni otro dispositivo pueden provocarlas.

**Cambiar de dominio es cambiar un `.json`.** El núcleo no sabe qué es un banco: le pregunta al
esquema qué esperaba en cada campo, y las reglas de negocio **se le inyectan** — el esquema dice
dónde viven, y quien arranca las carga.

Y eso **también se comprueba con un comando**: `npm run test:frontera` verifica **dos** fronteras,
no una. Que el núcleo no importe el SDK (95/5) **y que no importe ningún dominio** (genericidad).
Si `core/` importara la cédula panameña, esta sección seguiría estando escrita y ya no sería cierta.

---

## Los números

**Medidos al ejecutar `npm run metricas`, no escritos a mano:**

| | |
|---|---|
| Tests | **324 / 324** verdes, sin modelo y sin red |
| De ellos, prueban que algo **NO** se puede | **195 de 322 → 60,6 %** |
| Casos de uso punta a punta | **25** |
| Casos trampa, uno por guardia | **17 / 17** — cobertura G1..G10 completa |
| Módulos deterministas / que tocan un modelo | **17 / 1** → **94,4 %** |
| Transiciones de estado legales / que lanzan | **10 / 54** → **84,4 %** de superficie cerrada |
| Puertas de entrega en PASS | **12 / 13** — la 13 exige que el SDK instalado sea el declarado |
| Invariantes O1..O5 sobre datos reales | **5 / 5** |

### ⚫ Lo que NO está medido

Se escribe aquí, y no en letra pequeña, porque **un número que no puedo reproducir delante de
usted no lo pongo**:

- **Inferencia delegada entre dos máquinas físicas.** El proveedor arranca y emite su clave
  pública en 8.419 ms, y su identidad es reproducible entre corridas. **Un consumidor conectándose
  y recibiendo inferencia de vuelta todavía NO se ha medido.**
- **Tiempo de descarga de los pesos.** El clon limpio SÍ está medido (3 min 13 s hasta tener
  el sistema corriendo), pero `npm run setup` todavía no se ha cronometrado.
- **OCR sobre fotografías reales.** Lo probado hasta ahora es imagen sintética.

---

## 🇵🇦 El esquema no lo inventamos: lo dicta el Acuerdo 1-2026

**El Acuerdo 10-2015 está derogado.** Desde el **16 de enero de 2026** rige el
**Acuerdo 1-2026** de la Superintendencia de Bancos de Panamá, y es el que este
esquema atiende — artículo por artículo, no de oídas.

| Artículo | Qué exige | Dónde vive aquí |
|---|---|---|
| **10.4** | constancia documentada de la debida diligencia | el ledger: cada hecho con su instante, su origen y su hash |
| **18** | perfil del cliente: **14 datos** + identificación mínima | `instancias/banca/esquema.json`, cada campo con su `$norma` |
| **29** | conservar 5 años y permitir **reconstruir** la operación | el expediente no se guarda: se **regenera** del ledger (invariante O5) |

Los catorce datos del perfil del artículo 18 —actividad de la fuente de ingreso,
fecha de nacimiento, género, profesión, nacionalidad, origen y destino de los
recursos, país de nacimiento y de domicilio, producto, tipo de transacción,
monto, frecuencia y canal— **son campos críticos del esquema**. Un expediente al
que le falte cualquiera de ellos no llega a completo y no se puede firmar:

```bash
npm run demo && node cli.mjs ver --ledger datos/EXP-002.jsonl
#  22 campos anclados · 3 rechazados
#  faltan críticos: titular.cedula, titular.profesion_u_oficio
```

> **Lo que esto costó, y se cuenta porque es la parte interesante:** al ampliar
> el esquema, **19 tests se pusieron en rojo a la vez**. Todos tenían razón. Un
> expediente con nombre y cédula ya no está completo — y nunca lo estuvo para el
> regulador, solo para nuestro esquema de juguete.
>
> Y saltó un fallo de diseño: G7, la guardia de vigencia, decidía por el
> **nombre** del campo (`/fecha/`), así que `titular.fecha_nacimiento` salía
> rechazada como **documento vencido**. Una persona nacida en 1988 no está
> vencida. Ahora qué caduca y en cuántos días lo declara el esquema en
> `vigencia_dias`: es dato, como las unidades y la aritmética. Quien instale
> esto en otro banco cambia un `.json`, no una expresión regular.

**Todos los datos de ejemplo son sintéticos y ficticios.** Ninguna persona real,
ningún cliente real: el enunciado del reto prohíbe datos reales de clientes de
cualquier entidad financiera, y aquí se cumple.

---

## Trabajo previo · de quién aprendimos y en qué nos apartamos

Verificar una extracción contra su fuente **no es invento nuestro**, y decir lo
contrario sería el error más caro que podríamos cometer: se comprueba en treinta
segundos con un buscador y arrastraría la credibilidad de todo lo demás.

| Quién | Qué hace | Desde |
|---|---|---|
| **Google · LangExtract** | extracción con posiciones exactas de carácter sobre el texto original | jul-2025, Apache-2.0 |
| **Anthropic · Citations API** | devuelve el fragmento del documento que sostiene cada afirmación | ene-2025 |
| **Cohere, Vertex AI, Azure** | *spans* de origen y comprobación de fundamento (*groundedness*) | 2024-2025 |
| **Rossum, Hyperscience, Reducto** | procesamiento inteligente de documentos, con confianza por campo | mercado maduro |

**Lo que este proyecto añade son cuatro decisiones, y cada una tiene su comando:**

**1 · No hay alineación difusa.** El propio `resolver.py` de LangExtract lo dice:
*«exact matching first, then fuzzy alignment fallback if enabled»*, con
alineación por subsecuencia común y umbrales de cobertura. Aquí no hay red: la
cita aparece con frontera de palabra o el campo no entra. No es una omisión, es
la decisión — y **la propagación de «ocho años» a los tres resonadores que
medimos el 9-sep habría pasado por una alineación difusa**, porque se parece lo
suficiente.

**1-bis · Y la posición se publica.** Cada campo del expediente lleva `donde`,
el intervalo exacto sobre el texto donde ancló — la misma idea que el
`char_interval` de LangExtract. La interfaz lo usa para **resaltar el fragmento
del documento del que salió cada dato**: no hay que creerse nada, el trozo
pintado es el que el código encontró.

**2 · El valor tiene que estar DENTRO de la cita.** Los sistemas de arriba
comprueban que la cita existe. Ninguno comprueba que el valor salga de ella.
Medido aquí: cita *«y un tomógrafo»*, valor *«Siemens»*. La cita es real y el
valor no está en ella — una invención con coartada. Y dos guardias más cierran
la variante fina, que es **ensanchar** una cita literal hasta que abarque otra
entidad: G9 impide que dos entidades reclamen la misma palabra del documento, y
G10, que una cita salte de una frase a otra.

**3 · Lo que no ancla no baja de puntaje: queda como hueco, con su motivo y su
guardia.** Un puntaje bajo es una cifra que alguien tiene que interpretar. Un
hueco es una pregunta concreta para el cliente. Y la documentación de Reducto lo
dice de sus propias citas: *«location markers rather than validation
mechanisms»* — señales para mirar, no mecanismos que decidan.

**4 · Un crítico en hueco bloquea la firma.** No avisa: bloquea. Y con dos
fuentes en contradicción, tampoco se firma hasta que **una persona** lo zanje.

> **Lo que no hacemos, y es deliberado:** corregir automáticamente la
> alucinación. Azure reescribe la salida hasta que quede anclada; eso es darle
> al modelo una segunda oportunidad. Aquí se deja el hueco.

---

## English summary

An on-device intake system for bank customer files. A branch officer dictates or photographs the
documents; a local model proposes the fields, and **deterministic guards decide which ones make
it in** — anything not found *literally* in the source is marked unknown, with the reason, rather
than invented.

No AI inference ever leaves the machine, and that claim is **verifiable with a command**, not
asserted in prose: `npm run test:frontera` exits non-zero if the deterministic core imports the
AI SDK at all, and `unshare -rn bash -c 'npm run smoke'` runs the whole pipeline inside a network
namespace with no interfaces.

Every number in this README has the command that produced it next to it. What we did not measure
is listed as not measured.

---

## Base preexistente declarada

> **T&C art. 11c:** *«Toda base preexistente utilizada debe declararse en el archivo README del
> repositorio, con indicación de su origen. La omisión es causal de descalificación.»*

**Se declara por exceso.** Si existía antes de las 08:00 del 9-sep-2026, está en esta tabla.

| Componente | Versión | Origen | Licencia | Qué aporta |
|---|---|---|---|---|
| `@qvac/sdk` | 0.18.2 (exacta) | https://qvac.tether.io | Apache-2.0 | SDK obligatorio del evento: inferencia local y delegación entre pares |
| `hyperswarm`, `hyperdht`, `protomux` | ver `malla/package-lock.json` | Holepunch | MIT | Descubrimiento y transporte P2P de la malla propia |
| Node.js | ≥ 20 | nodejs.org | MIT | Tiempo de ejecución |
| **MedPsy 1.7B** | `d1fb95f7cec096ea…` · SHA-256 `41ee947d9cce72ec…` | `registry://` de QVAC | ver la ficha del modelo en el registro | texto → campos estructurados (json_schema → GBNF) |
| **OCR latin_g2** | `1bd09b23f28caa7e…` · SHA-256 `dd1c7a436e917590…` | `registry://` de QVAC | ver la ficha del modelo en el registro | reconocimiento de texto en imagen, determinista |
| **CRAFT mlt_25k** | `bb5d57baeb6ae9e7…` · SHA-256 `74501993caf4581c…` | `registry://` de QVAC | ver la ficha del modelo en el registro | detección de regiones de texto |
| **Whisper es-tiny q8_0** | `c4c6196526e47622…` · SHA-256 `e18a4e2374b5f915…` | `registry://` de QVAC | ver la ficha del modelo en el registro | transcripción de dictado en español |
| **Chatterbox s3gen** | `d2d7cb61032368ee…` · SHA-256 `44496b0fc6e9d165…` | `registry://` de QVAC | ver la ficha del modelo en el registro | síntesis de voz (no usado en el flujo principal) |
| **Chatterbox t3** | `d473922a753fa51a…` · SHA-256 `99645a36944f8337…` | `registry://` de QVAC | ver la ficha del modelo en el registro | síntesis de voz (no usado en el flujo principal) |

**Los pesos no se redistribuyen**: se descargan del registro de QVAC con
`npm run setup` y quedan en `~/.qvac/models/`. Los SHA-256 de arriba son los de
esta máquina, y sirven para comprobar que el archivo que baja es el mismo. El
nombre de archivo que asigna el registro empieza por su propio identificador,
que es lo que aparece entre comillas.

**Dependencias de terceros en el núcleo: ninguna.** `core/`, `pruebas/` y los scripts de
verificación usan solo la biblioteca estándar de Node.

**Asistentes de IA (art. 11d):** se usaron asistentes de programación basados en IA durante el
desarrollo. Las decisiones de arquitectura, la frontera entre código determinista e inferencia,
el diseño de las guardias y el guion del video son del participante.

**Logo y banner:** generados con una herramienta de IA a partir de prompts propios, el 9-sep-2026,
dentro de la ventana del evento.

**Datos:** todos los datos de ejemplo son **sintéticos y ficticios**. No hay ni un dato real de
cliente en este repositorio, y el enunciado del reto lo prohíbe expresamente.

Todo el contenido de `core/`, `ia/`, `malla/`, `ui/`, `audit/`, `scripts/` y `pruebas/` se
escribió entre el **9-sep-2026 08:00** y el **11-sep-2026 08:00**, hora de Panamá. El historial
de commits es la evidencia (art. 11b).

---

## Licencia

Apache-2.0 — ver [LICENSE](LICENSE).
