// pruebas/fixtures.mjs — el expediente de referencia, en un solo sitio.
//
// ═══════════════════════════════════════════════════════════════════════════
//   Existe porque el esquema de banca se amplió a lo que exige el
//   artículo 18 del Acuerdo 1-2026, y cada suite tenía su propia copia
//   de «un expediente correcto» con dos campos.
// ═══════════════════════════════════════════════════════════════════════════
//
// Diecinueve tests se pusieron en rojo a la vez, y estaban en lo cierto: un
// expediente con nombre y cédula ya NO está completo. Nunca lo estuvo para el
// regulador; lo estaba solo para nuestro esquema de juguete.
//
// La lección de diseño va aquí escrita para que no se repita: **cuando la misma
// constante está copiada en cinco archivos, un cambio legítimo de contrato
// parece una rotura masiva.** No lo era. Era el contrato haciéndose más
// exigente en un sitio y cinco copias sin enterarse.
//
// TODO ES SINTÉTICO Y FICTICIO. Ninguna persona real, ningún cliente real: el
// enunciado del reto prohíbe datos reales de clientes de cualquier entidad.

/** El dictado del oficial. Contiene, literalmente, todo lo que el art. 18 pide. */
export const FUENTE_ART18 =
  'Apertura de cuenta de ahorros en sucursal. El titular es Juan Pérez González, ' +
  'cédula 8-123-456, nacido el 14 de marzo de 1988, género masculino, de nacionalidad ' +
  'panameña, nacido en Panamá y con país de domicilio Panamá. De profesión u oficio es ' +
  'contador y su actividad de fuente de ingreso es empleo asalariado. El origen de los ' +
  'recursos es Panamá y el destino de los recursos es Panamá. Su dirección es Vía España, ' +
  'edificio Marbella, apartamento 12-B, corregimiento de Bella Vista, y su contacto es el ' +
  'teléfono 6123-4567. Solicita el producto cuenta de ahorros, con tipo de transacción ' +
  'depósito en efectivo, monto transaccional estimado de 800.00 balboas, frecuencia mensual ' +
  'y canal de sucursal. Presenta el recibo del IDAAN del 20 de agosto de 2026 por 45.30 ' +
  'balboas. Trae además una carta laboral que consta firmada y sellada.'

/** El día en que están fechados los datos + tres semanas: dentro de los 90 de G7. */
export const HOY_ART18 = new Date('2026-09-10T12:00:00Z')

/** Los datos del titular que exige el art. 18, cada uno con su cita literal. */
export const titularArt18 = () => ({
  nombre:             { valor: 'Juan Pérez González', cita: 'El titular es Juan Pérez González' },
  cedula:             { valor: '8-123-456', cita: 'cédula 8-123-456' },
  fecha_nacimiento:   { valor: '14 de marzo de 1988', cita: 'nacido el 14 de marzo de 1988' },
  genero:             { valor: 'masculino', cita: 'género masculino' },
  nacionalidad:       { valor: 'panameña', cita: 'de nacionalidad panameña' },
  pais_nacimiento:    { valor: 'Panamá', cita: 'nacido en Panamá' },
  pais_domicilio:     { valor: 'Panamá', cita: 'con país de domicilio Panamá' },
  profesion_u_oficio: { valor: 'contador', cita: 'profesión u oficio es contador' },
  actividad_ingreso:  { valor: 'empleo asalariado', cita: 'actividad de fuente de ingreso es empleo asalariado' },
  origen_recursos:    { valor: 'Panamá', cita: 'El origen de los recursos es Panamá' },
  destino_recursos:   { valor: 'Panamá', cita: 'el destino de los recursos es Panamá' },
  direccion:          { valor: 'Vía España, edificio Marbella, apartamento 12-B, corregimiento de Bella Vista',
                        cita: 'Su dirección es Vía España, edificio Marbella, apartamento 12-B, corregimiento de Bella Vista' },
  contacto:           { valor: '6123-4567', cita: 'el teléfono 6123-4567' }
})

/** El uso esperado de la cuenta: puntos 10 a 14 del perfil del art. 18. */
export const operacionArt18 = () => ({
  producto:            { valor: 'cuenta de ahorros', cita: 'el producto cuenta de ahorros' },
  tipo_transaccion:    { valor: 'depósito en efectivo', cita: 'tipo de transacción depósito en efectivo' },
  monto_transaccional: { valor: 800.00, cita: 'monto transaccional estimado de 800.00 balboas' },
  frecuencia:          { valor: 'mensual', cita: 'frecuencia mensual' },
  canal:               { valor: 'sucursal', cita: 'canal de sucursal' }
})

/** El recibo de servicio, vigente respecto de HOY_ART18. */
export const documentoArt18 = () => ({
  tipo: 'RECIBO_SERVICIO',
  emisor:        { valor: 'IDAAN', cita: 'el recibo del IDAAN' },
  fecha_emision: { valor: '20 de agosto de 2026', cita: 'del 20 de agosto de 2026' },
  monto:         { valor: 45.30, cita: 'por 45.30 balboas' }
})

/**
 * Un expediente que cumple el art. 18 entero.
 *
 * Se devuelve NUEVO en cada llamada a propósito: un test que estropea el
 * expediente para probar una guardia no puede contaminar al siguiente.
 */
export const expedienteArt18 = () => ({
  titular: titularArt18(),
  operacion: operacionArt18(),
  documentos: [documentoArt18()]
})
