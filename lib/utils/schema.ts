import { z } from "zod";

const phoneRegex = /^\d{10}$/;
const ssnRegex = /^\d{9}$/;

const socioSchema = z.object({
  nombre: z.string().min(2, "Nombre requerido"),
  nacimiento: z.string().min(8, "Fecha de nacimiento requerida"),
  email: z.string().email("Email inválido"),
  telefono: z.string().regex(phoneRegex, "Teléfono: 10 dígitos sin espacios ni guiones"),
  direccion: z.string().min(5, "Dirección requerida"),
  ciudad: z.string().min(2, "Ciudad requerida"),
  estado: z.string().min(2, "Estado requerido"),
  zip: z.string().min(5, "ZIP code requerido"),
  ssn: z.string().regex(ssnRegex, "SSN: 9 dígitos sin guiones"),
  porcentaje: z.string().min(1, "Porcentaje requerido"),
  beneficiario: z.string().optional(),
});

const socio2Schema = socioSchema.partial().extend({
  nombre: z.string().optional(),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
});

export const llcFormSchema = z.object({
  // Paquete
  paquete: z.enum(["ESENCIAL", "PROFESIONAL", "EXPRESS"]),

  // Empresa
  empresa_nombre_principal: z.string().min(3, "Nombre de la empresa requerido"),
  empresa_nombre_alternativo: z.string().optional(),
  empresa_direccion: z.string().min(5, "Dirección requerida"),
  empresa_ciudad: z.string().min(2, "Ciudad requerida"),
  empresa_estado: z.string().min(2, "Estado requerido"),
  empresa_zip: z.string().min(5, "ZIP code requerido"),
  empresa_actividad: z.string().min(5, "Descripción de actividad requerida"),
  empresa_fecha_inicio: z.string().min(8, "Fecha de formación requerida"),
  empresa_tipo: z.enum(["LLC (Single Member)", "LLC (Multi Member)"]),
  empresa_empleados: z.coerce.number().min(0).default(0),

  // Socio 1
  socio1_nombre: z.string().min(2, "Nombre requerido"),
  socio1_nacimiento: z.string().min(8, "Fecha de nacimiento requerida"),
  socio1_email: z.string().email("Email inválido"),
  socio1_telefono: z.string().regex(phoneRegex, "10 dígitos sin espacios"),
  socio1_direccion: z.string().min(5, "Dirección requerida"),
  socio1_ciudad: z.string().min(2, "Ciudad requerida"),
  socio1_estado: z.string().min(2, "Estado requerido"),
  socio1_zip: z.string().min(5, "ZIP code requerido"),
  socio1_ssn: z.string().regex(ssnRegex, "9 dígitos sin guiones"),
  socio1_porcentaje: z.string().min(1, "Porcentaje requerido"),
  socio1_beneficiario: z.string().optional(),

  // Socio 2 (opcional)
  socio2_nombre: z.string().optional(),
  socio2_nacimiento: z.string().optional(),
  socio2_email: z.string().email("Email inválido").optional().or(z.literal("")),
  socio2_telefono: z.string().optional(),
  socio2_direccion: z.string().optional(),
  socio2_ciudad: z.string().optional(),
  socio2_estado: z.string().optional(),
  socio2_zip: z.string().optional(),
  socio2_ssn: z.string().optional(),
  socio2_porcentaje: z.string().optional(),
  socio2_beneficiario: z.string().optional(),

  // Agente (por defecto = socio1)
  agente_nombre: z.string().min(2, "Nombre del agente requerido"),
  agente_direccion: z.string().min(5, "Dirección del agente requerida"),
  agente_email: z.string().email("Email inválido").optional().or(z.literal("")),

  // Organizador (por defecto = socio1)
  organizador_nombre: z.string().min(2, "Nombre del organizador requerido"),
  organizador_direccion: z.string().min(5, "Dirección del organizador requerida"),

  // Confirmaciones
  confirmacion_info: z.boolean().refine(v => v, "Debe confirmar"),
  confirmacion_servicio: z.boolean().refine(v => v, "Debe aceptar"),
  confirmacion_autorizacion: z.boolean().refine(v => v, "Debe autorizar"),
  confirmacion_tarifas: z.boolean().refine(v => v, "Debe aceptar"),
  confirmacion_firma: z.string().min(2, "Firma requerida"),
});

export type LLCFormValues = z.infer<typeof llcFormSchema>;
