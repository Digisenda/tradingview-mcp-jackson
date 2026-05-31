import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { generateClientId } from "@/lib/utils/client-id";
import { llcFormSchema } from "@/lib/utils/schema";

// Simple XOR-based obfuscation for SSN (replace with proper encryption in production)
function encryptSSN(ssn: string): string {
  const key = process.env.SSN_ENCRYPTION_KEY ?? "digisenda-llc-2024";
  let encrypted = "";
  for (let i = 0; i < ssn.length; i++) {
    encrypted += String.fromCharCode(ssn.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return Buffer.from(encrypted).toString("base64");
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = llcFormSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const supabase = createServiceClient();
    const clientId = generateClientId();

    const insertData = {
      client_id: clientId,
      status: "NUEVO",
      paquete: data.paquete,

      // Socio 1
      socio1_nombre: data.socio1_nombre,
      socio1_nacimiento: data.socio1_nacimiento,
      socio1_email: data.socio1_email,
      socio1_telefono: data.socio1_telefono,
      socio1_direccion: data.socio1_direccion,
      socio1_ciudad: data.socio1_ciudad,
      socio1_estado: data.socio1_estado,
      socio1_zip: data.socio1_zip,
      socio1_ssn_encrypted: data.socio1_ssn ? encryptSSN(data.socio1_ssn) : null,
      socio1_ssn_last4: data.socio1_ssn ? data.socio1_ssn.slice(-4) : null,
      socio1_porcentaje: data.socio1_porcentaje,
      socio1_beneficiario: data.socio1_beneficiario ?? null,

      // Socio 2
      socio2_nombre: data.socio2_nombre ?? null,
      socio2_nacimiento: data.socio2_nacimiento ?? null,
      socio2_email: data.socio2_email || null,
      socio2_telefono: data.socio2_telefono ?? null,
      socio2_direccion: data.socio2_direccion ?? null,
      socio2_ciudad: data.socio2_ciudad ?? null,
      socio2_estado: data.socio2_estado ?? null,
      socio2_zip: data.socio2_zip ?? null,
      socio2_ssn_encrypted: data.socio2_ssn ? encryptSSN(data.socio2_ssn) : null,
      socio2_ssn_last4: data.socio2_ssn ? data.socio2_ssn.slice(-4) : null,
      socio2_porcentaje: data.socio2_porcentaje ?? null,
      socio2_beneficiario: data.socio2_beneficiario ?? null,

      // Empresa
      empresa_nombre_principal: data.empresa_nombre_principal,
      empresa_nombre_alternativo: data.empresa_nombre_alternativo ?? null,
      empresa_direccion: data.empresa_direccion,
      empresa_ciudad: data.empresa_ciudad,
      empresa_estado: data.empresa_estado,
      empresa_zip: data.empresa_zip,
      empresa_actividad: data.empresa_actividad,
      empresa_fecha_inicio: data.empresa_fecha_inicio,
      empresa_tipo: data.empresa_tipo,
      empresa_empleados: data.empresa_empleados,

      // Organizador y agente
      organizador_nombre: data.organizador_nombre,
      organizador_direccion: data.organizador_direccion,
      agente_nombre: data.agente_nombre,
      agente_direccion: data.agente_direccion,
      agente_email: data.agente_email || null,

      // Confirmación
      confirmacion_firma: data.confirmacion_firma,
      confirmacion_timestamp: new Date().toISOString(),
    };

    const { data: created, error } = await supabase
      .from("clients")
      .insert(insertData)
      .select("id, client_id")
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return NextResponse.json({ error: "Error al guardar" }, { status: 500 });
    }

    return NextResponse.json({ success: true, clientId: created.client_id, id: created.id });
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function GET() {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("clients")
    .select(
      "id, client_id, status, paquete, empresa_nombre_principal, empresa_tipo, socio1_nombre, socio1_email, email_entrega_enviado, created_at"
    )
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ clients: data });
}
