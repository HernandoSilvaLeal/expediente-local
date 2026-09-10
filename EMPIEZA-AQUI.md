# Empieza aquí

Un sistema para abrir expedientes de cliente en una sucursal bancaria. El
oficial dicta lo que trae el cliente, el sistema saca los datos, y **marca lo
que no puede probar en vez de inventarlo**.

Funciona **sin internet**. Nada sale del equipo.

## Cuatro pasos

```bash
node --version    # 1 · debe decir v20 o superior (si no: nodejs.org)
npm ci            # 2 · prepara el sistema (lo único que necesita internet)
npm run demo      # 3 · crea tres expedientes de ejemplo
npm start         # 4 · ábrelo en http://127.0.0.1:7301
```

## Qué vas a ver

| Expediente | Qué enseña |
|---|---|
| **EXP-001** | todo bien: cada dato con la frase del documento de la que sale |
| **EXP-002** | el sistema **rechazó tres datos inventados**, y dice por qué |
| **EXP-003** | dos documentos dan **titulares distintos** — el sistema no elige: para |

Arriba a la derecha escribe **tu nombre** y elige un **rol**:

- **oficial de cuenta** — atiende al cliente y prepara el expediente
- **gerente de sucursal** — firma, y solo él firma
- **auditoría interna** — lee todo, no toca nada

Con el rol de gerente, abre EXP-003: **no te deja firmar** hasta que alguien
resuelva la contradicción. Eso no es un error — es el punto.

## Si algo falla

| Pasa | Haz |
|---|---|
| la página está vacía | `npm run demo` |
| «command not found» | instala Node desde nodejs.org |
| quieres verlo en el móvil | `npm run sucursal` y usa la dirección que imprime |

**Los datos son inventados.** Ninguna persona real, ningún cliente real.
El detalle técnico está en [README.md](README.md).
