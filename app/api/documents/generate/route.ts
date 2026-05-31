import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  buildDocumentVariables,
  generatePDF,
  getDocumentFilename,
  DocumentType,
} from "@/lib/documents/generator";

const ALL_TYPES: DocumentType[] = [
  "organizer_declaration",
  "operating_agreement",
  "banking_resolution",
  "aportes_iniciales",
  "carta_separacion",
];

export async function POST(request: NextRequest) {
  try {
    const { clientId, types } = await request.json();
    if (!clientId) return NextResponse.json({ error: "clientId requerido" }, { status: 400 });

    const supabase = createServiceClient();

    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("*")
      .eq("id", clientId)
      .single();

    if (clientError || !client) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    const docTypes: DocumentType[] = types ?? ALL_TYPES;
    const vars = buildDocumentVariables(client as Record<string, unknown>);
    const generated: string[] = [];

    for (const type of docTypes) {
      const pdfBytes = await generatePDF(type, vars);
      const filename = getDocumentFilename(type, client.client_id);
      const storagePath = `${client.client_id}/${filename}`;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from("llc-documents")
        .upload(storagePath, pdfBytes, {
          contentType: "application/pdf",
          upsert: true,
        });

      if (uploadError) {
        console.error(`Upload error for ${type}:`, uploadError);
        continue;
      }

      const { data: urlData } = supabase.storage
        .from("llc-documents")
        .getPublicUrl(storagePath);

      // Save document record
      await supabase.from("documents").upsert(
        {
          client_id: clientId,
          type,
          filename,
          storage_path: storagePath,
          public_url: urlData.publicUrl,
        },
        { onConflict: "client_id,type" }
      );

      generated.push(type);
    }

    // Update client status to GENERAR_DOCS if was EN_PROCESO
    if (client.status === "EN_PROCESO") {
      await supabase
        .from("clients")
        .update({ status: "GENERAR_DOCS" })
        .eq("id", clientId);
    }

    return NextResponse.json({ success: true, generated });
  } catch (err) {
    console.error("Document generation error:", err);
    return NextResponse.json({ error: "Error generando documentos" }, { status: 500 });
  }
}
