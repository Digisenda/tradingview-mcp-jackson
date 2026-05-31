export interface DocumentVariables {
  NOMBRE_LLC: string;
  TIPO_LLC: string;
  FECHA_HOY: string;
  FECHA_INICIO: string;
  NOMBRE_SOCIO_1: string;
  NOMBRE_SOCIO_2?: string;
  DIRECCION_SOCIO_1: string;
  DIRECCION_SOCIO_2?: string;
  PORCENTAJE_SOCIO_1: string;
  PORCENTAJE_SOCIO_2?: string;
  ACTIVIDAD_LLC: string;
  NOMBRE_AGENTE: string;
  DIRECCION_AGENTE: string;
  DIRECCION_LLC: string;
  CLIENT_ID: string;
  ORGANIZER_NAME: string;
  MEMBER_NAME: string;
  MEMBER_ADDRESS: string;
  DATE: string;
}

export function fillTemplate(template: string, vars: DocumentVariables): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = vars[key as keyof DocumentVariables];
    return value ?? `{{${key}}}`;
  });
}
