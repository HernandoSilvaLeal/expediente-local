# FSM del registro — generada desde `core/estado.mjs`

> Este documento NO se edita a mano. Se genera de la tabla `TRANSICIONES`,
> así que el código y la ficha no pueden divergir.

| Estado | Puede pasar a |
|---|---|
| `CAPTURADO` | `EXTRAIDO` · `DESCARTADO` |
| `EXTRAIDO` | `VALIDADO` · `DESCARTADO` |
| `VALIDADO` | `COMPLETO` · `DUPLICADO` · `DESCARTADO` |
| `COMPLETO` | `APROBADO` · `RECHAZADO` · `DUPLICADO` |
| `APROBADO` **(terminal)** 👤 | — |
| `RECHAZADO` **(terminal)** 👤 | — |
| `DESCARTADO` **(terminal)** | — |
| `DUPLICADO` **(terminal)** | — |

**10 transiciones legales de 64 combinaciones posibles.**
Las otras 54 lanzan `TransicionIlegal`.

👤 = solo lo puede decidir una persona: APROBADO, RECHAZADO

Exigen motivo: DESCARTADO, RECHAZADO, DUPLICADO
