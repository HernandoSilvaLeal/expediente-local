# El problema

> Este documento tiene **dos caras** y las dos van hasta el fondo, porque son
> dos problemas distintos que se cruzan en el mismo sitio.
>
> **Parte I · El problema de negocio** — qué se rompe en un banco, y quién lo sufre.
> **Parte II · El problema técnico** — por qué un modelo de lenguaje no puede arreglarlo solo.
> **Parte III** — dónde se cruzan, que es donde vive este proyecto.

---

# Parte I · EL PROBLEMA DE NEGOCIO

## En una frase

**El dato se separa del papel en el momento en que alguien lo teclea. Y ya no
vuelve a juntarse nunca.**

Desde ese instante el expediente es *«lo que alguien escribió que decía el
documento»*, no *«lo que el documento dice»*. Son cosas distintas, y el sistema
del banco no puede distinguirlas.

## Sistémicamente

Un expediente es una **cadena de afirmaciones sobre una persona**, y cada eslabón
vino de un papel: una cédula, un recibo, una carta laboral.

La digitación **corta la cadena**. Guarda el resultado y tira el vínculo con el
origen.

Después, todo el edificio de controles del banco —cumplimiento, auditoría
interna, el supervisor— trabaja sobre datos **cuya procedencia ya no existe**.

Por eso esos controles verifican **completitud** —¿está lleno el campo?— y no
**veracidad** —¿es cierto?—. No es pereza ni falta de rigor: verificar veracidad
significa volver al papel, uno por uno, y eso no escala.

> ### Y la IA, tal como se está usando, empeora esto
>
> El dato ahora lo escribe un modelo en vez de una persona, **y sigue sin vínculo
> con el papel**. Se digita más rápido lo mismo de infundado, y con más volumen.
>
> Un sistema que extrae mil campos por hora sin procedencia no ha resuelto el
> problema: lo ha multiplicado por mil.

## Individualmente · quién lo sufre, y cómo

### El oficial de cuenta — el que teclea

Su problema **no es el tiempo**. Es que si dentro de un año aparece un error,
**no puede probar que copió bien**: es su palabra contra un papel, si el papel
aparece.

Y lo hace con un cliente delante, esperando.

### El gerente de sucursal — el que firma

**Firma expedientes que no armó.** Su única opción real es confiar, porque
verificar de verdad significaría rehacer el trabajo entero con el cliente ya
fuera de la oficina.

Pone su nombre en algo que no comprobó. Todos los días.

### El oficial de cumplimiento — el que revisa

Revisa muestras. Cuando encuentra algo raro tiene que **reconstruir qué pasó**:
quién capturó el dato, de qué documento, quién aprobó y con qué criterio.

Eso significa buscar personas que quizá ya no están y papeles de hace meses.
**El coste de investigar es tan alto que solo se investiga lo que ya explotó.**

### Auditoría interna — el que certifica

Le piden verificar doscientos expedientes. Verifica que **estén completos**, no
que sean **ciertos** — y lo sabe.

Firma un informe que dice menos de lo que parece decir.

### El supervisor bancario — el que pregunta

Pide reconstruir una operación de hace tres años. El banco tiene los datos.
**No tiene la cadena.**

El **Acuerdo 1-2026** de la Superintendencia de Bancos de Panamá —vigente desde
el 16 de enero de 2026, que deroga el 10-2015— usa esa palabra exacta en su
**artículo 29**: *reconstrucción*. Y en el **10.4** exige **constancia
documentada** de la debida diligencia.

## Lo que cuesta hoy, dicho sin adornos

| Quién | Qué le cuesta |
|---|---|
| oficial | responder por un error que no puede probar que no cometió |
| gerente | firmar sin poder verificar |
| cumplimiento | investigar solo lo que ya explotó |
| auditoría | certificar completitud y llamarlo control |
| banco | un expediente que **parece** completo y no lo está — el peor de todos, porque nadie repregunta |

---

# Parte II · EL PROBLEMA TÉCNICO

## En una frase

**Un modelo de lenguaje produce texto que parece un dato, y no hay forma —dentro
del modelo— de distinguir un dato leído de un dato generado.**

Los dos salen con la misma forma, la misma fluidez y la misma confianza aparente.

## Por qué el modelo no puede resolverlo solo

Un modelo bien gobernado **garantiza la FORMA**: con `json_schema` traducido a
gramática, no puede devolver un JSON inválido ni un campo fuera del esquema.

**Nunca garantiza el FONDO.** La gramática impide que el JSON esté mal formado;
no impide que el contenido sea falso.

Medido en esta máquina el 9 de septiembre de 2026, con MedPsy 1.7B:

```
Entrada:  «tres resonadores magnéticos Siemens y un tomógrafo.
           UNO de los resonadores parece de unos ocho años»

Salida:   MRI ×3, antigüedad 8      → la edad se propagó a los TRES
          CT ×1, fabricante Siemens → la marca saltó al tomógrafo
          confianza: "Confirmado"   → «parece» es Estimado, no Confirmado
```

**Tres errores. JSON perfectamente válido. Factualmente falso.**

> Y preguntarle al modelo cuánta confianza tiene **no arregla nada**: es pedirle
> que evalúe su propia ignorancia. Sale un número que describe su fluidez, no la
> verdad de lo que dijo.

## Las diecisiete formas de que un dato falso entre

No son teóricas. **Cada una tiene su caso de prueba en el repositorio**, y cuatro
salieron de salidas reales del modelo, no de nuestra imaginación:

| # | La forma | Se para con |
|---|---|---|
| 1 | **Invención pura** — una cédula que nadie dijo | G3 |
| 2 | **Invención con coartada** — la cita es real, el valor no sale de ella | G3 |
| 3 | **Cantidad cambiada** — el número no está en su propia cita | G3 |
| 4 | **El monto que nadie dijo** — «500 balboas» es sufijo de «4500 balboas» | G3 |
| 5 | **La cédula truncada** — un dígito de menos crea una segunda persona | G3 |
| 6 | **Tipo equivocado** — un número que llega como texto | G1 |
| 7 | **Enum inventado** — un tipo de documento que no existe | G2 |
| 8 | **Unidad ausente** — un monto cuya cita no habla de dinero | G4 |
| 9 | **Campo intruso** — el modelo devuelve algo que nadie le pidió | G5 |
| 10 | **Provincia imposible** — el error de OCR que ningún modelo detecta | G6 |
| 11 | **Documento vencido** — un recibo de hace medio año | G7 |
| 12 | **Aritmética que no cuadra** — tres números que se contradicen | G8 |
| 13 | **Atribución cruzada** — dos entidades reclaman la misma palabra | G9 |
| 14 | **La cita que salta de frase** — la fecha es de otro documento | G10 |
| 15 | **El dato atenuado** — la fuente duda, y el sistema no debe afirmar | escala de evidencia |
| 16 | **Dos fuentes que se contradicen** — ninguna miente, y no coinciden | conflicto |
| 17 | **Todo mal a la vez** — y aun así lo verdadero tiene que sobrevivir | todas |

```bash
npm run casos     # las diecisiete, en 82 ms
```

### Las dos que más enseñan

**La 4 · el sufijo.** La fuente dice *«4500 balboas»*, el modelo devuelve `500`
con la cita *«500 balboas»*. La cita **existe literalmente**. Es la comprobación
ingenua fallando: comparar por texto donde hace falta frontera de palabra.

**La 13 · la cita ancha.** Con citas **cien por cien literales** se le puede
atribuir a una entidad lo que la fuente dijo de otra. No hace falta inventar una
cita: basta con **ensancharla**.

## Por qué lo que existe hoy no basta

Verificar una extracción contra su fuente **no es invento nuestro** — y decir lo
contrario se comprueba en treinta segundos:

| Quién | Qué hace | Dónde se queda |
|---|---|---|
| **Google · LangExtract** | posiciones exactas de carácter (jul-2025, Apache-2.0) | *«exact matching first, then fuzzy alignment fallback»* — **acepta lo que se le parece** |
| **Anthropic · Citations** | devuelve el fragmento que sostiene cada afirmación | no comprueba que el **valor** salga de él |
| **Rossum, Hyperscience** | procesamiento de documentos con confianza por campo | umbral probabilístico sobre salida probabilística |
| **Reducto** | citas de origen | su documentación las llama *«location markers rather than validation mechanisms»* |
| **Azure** | *correction feature*: reescribe la salida hasta que quede anclada | **le da al modelo una segunda oportunidad** |

**Ninguno rechaza.** Todos puntúan, y un puntaje bajo es una cifra que alguien
tiene que interpretar — casi siempre con prisa y con un cliente delante.

---

# Parte III · DÓNDE SE CRUZAN LOS DOS PROBLEMAS

Son problemas distintos con **la misma raíz**:

```
   NEGOCIO                          TÉCNICO
   el dato se separa del papel      el modelo genera texto que
   cuando alguien lo teclea         parece un dato leído
             │                                │
             └────────────┬───────────────────┘
                          ▼
          EN AMBOS CASOS SE PIERDE LA PROCEDENCIA

   y sin procedencia no se puede ni verificar (técnico)
   ni justificar (negocio)
```

**Por eso una solución que solo ataque una cara no sirve:**

- extraer con IA **sin procedencia** resuelve la velocidad y agrava el control
- exigir procedencia **sin extraer** deja el trabajo manual intacto

## Cómo se ataca

**No en el tecleo. En el corte.**

Cada dato guarda **la frase literal del documento** y **la posición exacta** donde
aparece. La cadena no se rompe. Y lo que no se puede probar **no entra**: queda
como hueco, con el nombre de la regla que lo paró.

| Cargo | Qué cambia |
|---|---|
| **oficial** | puede probar que copió bien — lo prueba el sistema, no su palabra |
| **gerente** | verificar deja de ser rehacer: ve de dónde salió cada dato |
| **cumplimiento** | investigar deja de ser caro, así que se investiga lo que **no** explotó |
| **auditoría** | puede certificar veracidad, no solo completitud |
| **supervisor** | la reconstrucción **existe** y se regenera con un comando |

## Y se comprueba, no se afirma

```bash
npm run casos               # las 17 formas de colar un dato falso
npm run verify:invariantes  # que toda cita del dataset sigue en su fuente
npm run test:frontera       # que el núcleo NO puede tocar el modelo
npm run calidad             # cuánto sobrevivió, y con qué respaldo
unshare -rn bash -c 'npm run smoke'    # el sistema entero, sin red
```

### La proporción, en tres cortes — porque son tres cosas distintas

Decir «el 83,3 % es determinista» es cómodo y no dice cuál de tres cosas se está
midiendo. **Importar el SDK, ejecutar inferencia y decidir qué entra al
expediente no son lo mismo**, así que se publican los tres, de 18 módulos:

| Corte | Cuántos | El resto | Qué mide exactamente |
|---|---|---|---|
| **importan el SDK** | 3 | **83,3 %** del sistema es código determinista | uno de los tres —`malla/proveedor.mjs`— lo usa como **transporte entre aparatos**, no para inferir |
| **ejecutan inferencia** | 2 | **88,9 %** no toca un modelo | `ia/extraer.mjs` y `malla/motor.mjs` |
| **deciden qué entra al expediente** | **1** | **94,4 %** no puede meter un dato | `malla/motor.mjs` infiere para **otro** dispositivo; su salida no entra aquí |

**El que se dice en cámara es el primero**, el 83,3 %, porque es el más exigente
contra nosotros: cuenta como «toca IA» hasta un módulo que solo abre un socket.

> Publicar solo el 94,4 % sería exagerar hacia arriba; publicar solo el 83,3 %
> como si fuera la frontera del dato sería confundir dos afirmaciones. **La
> tentación de fundirlas en una es exactamente el fallo que este proyecto existe
> para atacar** — y ya nos costó una cifra falsa: `metricas.mjs` publicó 94,4 %
> durante días porque asumía la respuesta **por la carpeta** en la que estaba
> cada archivo, en vez de mirar lo que el archivo importa.

```bash
npm run metricas         # los tres cortes, contados sobre el código
npm run test:frontera    # falla si el núcleo importa el SDK
```

---

## Lo NO MEDIDO — y por qué, con la causa exacta

### La delegación P2P entre dos máquinas físicas: **intentada, no lograda**

Se probó el 11 de septiembre de 2026 con dos portátiles Windows en la misma red:
un Dell Latitude 3410 como proveedor —con el modelo descargado— y un Acer
Aspire A314 como consumidor, con `~/.qvac/models` **vacío, verificado tres
veces antes y después de cada intento**.

**No llegó a conectar, y no fue por la red.** El proceso worker del SDK aborta
al arrancar:

```
AddonError: CANNOT_LOAD: Cannot load addon
  @qvac/llm-llamacpp/prebuilds/win32-x64/qvac__llm-llamacpp.bare
[cause]: Error: The specified procedure could not be found.
```

**El worker intenta cargar el motor de inferencia LOCAL aunque el plan sea
delegar todo al par.** Se comprobó con `fallbackToLocal: true` y con `false`: el
error es idéntico byte a byte, así que no es que el addon se cargue «por si
acaso» cuando el respaldo está activo — se carga incondicionalmente.

Se descartó que faltara el Visual C++ Redistributable (está instalado). El
binario del runtime es válido y corre solo.

**Consecuencia, dicha sin suavizar:** mientras el worker necesite ese addon
disponible solo para *hablarle* a un par, **la delegación pura no es posible en
hardware donde ese addon no carga**. Cargarlo de forma perezosa —solo si el
respaldo local se activa de verdad— lo resolvería.

Es una limitación del SDK `@qvac/sdk@0.18.2` en ese Windows concreto, no de este
proyecto. Y se publica aquí porque un límite encontrado y declarado vale más que
uno que nadie buscó.

### Lo que sí quedó demostrado en ese mismo laboratorio

> *«Este equipo corre el sistema entero —captura, guardias, registro encadenado
> y aprobación con firma humana— sin modelo, sin GPU y sin internet. Todo el
> núcleo es determinista.»*

Verificado en el Acer, con la carpeta de modelos vacía.

### Y tres fallos propios que ese laboratorio destapó

Ninguno se veía en la máquina de desarrollo:

| Qué | Por qué no se veía |
|---|---|
| el plazo de inferencia asumía GPU dedicada | la máquina de desarrollo tiene GPU |
| las rutas se comparaban con `/` y Windows usa `\` | rompía el contador y tres puertas |
| **un equipo sin modelo no podía delegar** | imposible por construcción; allí el modelo está siempre |

---

## Lo que este proyecto NO resuelve

Se dice aquí, y no en letra pequeña:

| No resuelve | Por qué |
|---|---|
| **la apertura digital de cuentas completa** | eso necesita app, biometría y un proveedor de verificación facial. Esto es la **pieza de validación** que va detrás |
| **la verificación de identidad** | que la cara coincida con la cédula es otro problema, y tiene proveedores especializados |
| **la lectura de fotografías reales** | el OCR está medido solo sobre imagen sintética |
| **el cifrado en reposo** | el registro es texto plano en el disco del banco |
| **la identidad verificada de quien firma** | el sistema garantiza que **nadie alteró** lo escrito, no que quien lo escribió fuera quien dice ser. Eso lo aporta el directorio del banco |

> **La frase honesta ante un banquero:** *«su proveedor de biometría le dirá si
> la cara coincide. Nadie le va a decir si el dato que entró al expediente estaba
> de verdad en el documento — y eso es lo que le van a preguntar dentro de cuatro
> años.»*
