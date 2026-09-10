<p align="center">
  <img src="docs/banner.jpeg" alt="Expediente Local — si internet se cae, sigue pensando" width="700">
</p>

# Expediente Local

> Admisión y validación de expedientes de cliente en una sucursal bancaria, con toda la
> inteligencia artificial corriendo en el propio equipo del banco.

| | |
|---|---|
| **Equipo** | DevCors — Hernando Silva Leal |
| **Evento** | Decentralized AI Hackathon · ISD / Tether-QVAC · septiembre 2026 |
| **Desafíos** | Soluciones de AI Descentralizada para la Banca (Caja de Ahorros) · Sovereign Intelligence at the Edge |
| **Video** | *(pendiente)* |
| **SDK** | `@qvac/sdk@0.18.2` — **versión fijada**, sin `^`, sin `latest` |
| **Inferencia** | **100 % en el dispositivo.** Cero llamadas a APIs de IA |

---

## English summary

An on-device intake system for bank customer files. A branch officer dictates or photographs the
documents; a local model proposes the fields, and **nine deterministic guards decide which ones
make it in** — anything not found literally in the source is marked *unknown* rather than invented.

No AI inference ever leaves the machine, and that claim is **verifiable with a command**, not
asserted in prose. Every number in this README has the command that produced it next to it.

---

## Estado

> ⚠️ **En construcción.** Este repositorio se está escribiendo durante las 48 horas del evento.
> El historial de commits es la evidencia (T&C art. 11b).

- [ ] Núcleo determinista
- [ ] Extracción con esquema
- [ ] Interfaz
- [ ] Malla entre dispositivos
- [ ] Artefactos de auditoría
- [ ] Video

---

## Estructura

```
core/         El núcleo determinista. NO importa el SDK — hay un test que lo verifica
ia/           El único directorio que toca @qvac/sdk
malla/        Sincronización y delegación entre dispositivos
instancias/   El esquema de entidad como DATO, por dominio
ui/           Interfaz: HTML + CSS + JS a mano, sin build
audit/        Artefactos de auditoría
pruebas/      Tests deterministas — corren sin modelo cargado
```

---

## Instalación

*(pendiente — se completa con los tiempos medidos en máquina limpia)*

```bash
git clone https://github.com/HernandoSilvaLeal/expediente-local
cd expediente-local
npm ci                     # NO usar `npm install`: el SDK va fijado exacto
npm run setup              # descarga los modelos, verifica SHA-256
npm start                  # desde aquí, 100 % sin red
```

---

## Base preexistente declarada

> **T&C art. 11c:** *«Toda base preexistente utilizada debe declararse en el archivo README del
> repositorio, con indicación de su origen. La omisión es causal de descalificación.»*

**Se declara por exceso.** Si existía antes de las 08:00 del 9-sep-2026, está en esta tabla.

| Componente | Versión | Origen | Licencia | Qué aporta |
|---|---|---|---|---|
| `@qvac/sdk` | 0.18.2 | https://qvac.tether.io | Apache-2.0 | SDK obligatorio del evento |
| *(modelos, pendiente)* | | `registry://` | | |

**Asistentes de IA (art. 11d):** se usaron asistentes de programación basados en IA durante el
desarrollo. Las decisiones de arquitectura, la frontera entre código determinista e inferencia, el
diseño de las guardias y el guion son del participante.

**Logo y banner:** generados con una herramienta de IA a partir de prompts propios, el 9-sep-2026,
dentro de la ventana del evento.

Todo el contenido de `core/`, `ia/`, `malla/`, `ui/`, `audit/` y `pruebas/` se escribió entre el
**9-sep-2026 08:00** y el **11-sep-2026 08:00**, hora de Panamá.

---

## Licencia

Apache-2.0 — ver [LICENSE](LICENSE).
