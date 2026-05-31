export const aportesInicialesTemplate = `REGISTRO DE APORTES INICIALES
{{NOMBRE_LLC}} – {{TIPO_LLC}} (Texas)

Fecha:  {{FECHA_HOY}}
Lugar:  Texas, USA

1. DATOS DE LA EMPRESA
  Nombre legal de la LLC:    {{NOMBRE_LLC}}
  Estado de formación:        Texas
  Tipo:                       {{TIPO_LLC}}
  Miembro principal (Owner):  {{NOMBRE_SOCIO_1}}
  Actividad:                  {{ACTIVIDAD_LLC}}

2. REGISTRO DEL APORTE INICIAL
Yo, {{NOMBRE_SOCIO_1}}, en calidad de Miembro de {{NOMBRE_LLC}}, declaro que realizo el siguiente aporte inicial a la empresa:

Tipo de aporte (marcar):
  [ ] Efectivo (cash)
  [ ] Transferencia bancaria
  [ ] Equipo / Activos
  [ ] Otro: ________________________

Monto del aporte (si aplica): $__________________ USD
Descripción del aporte (si no es efectivo): ___________________________
Fecha efectiva del aporte: {{FECHA_HOY}}

3. CLASIFICACIÓN CONTABLE DEL APORTE (marcar una)
  [ ] Aporte de capital del propietario (Owner Capital Contribution)
  [ ] Préstamo del propietario a la LLC (Owner Loan)

Nota: Si se marca "Préstamo", se recomienda documentar términos básicos (monto, fecha, pagos)
para mantener registros claros.

4. DECLARACIÓN
Este registro se emite para fines administrativos internos de la empresa y para mantener
documentación clara de aportes del propietario. No constituye asesoría legal, fiscal o contable.

Firma del Miembro (Owner):

Signature: _______________________________
Name:      {{NOMBRE_SOCIO_1}}
Title:     Owner / Member — {{NOMBRE_LLC}}
Date:      {{FECHA_HOY}}

Case ID: {{CLIENT_ID}}`;
