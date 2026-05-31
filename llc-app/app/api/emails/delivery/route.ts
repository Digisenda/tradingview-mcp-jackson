import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email/resend";
import { deliveryEmailHtml, deliveryEmailSubject } from "@/lib/email/templates/delivery";

export async function POST(request: NextRequest) {
  try {
    const { clientId } = await request.json();
    if (!clientId) return NextResponse.json({ error: "clientId requerido" }, { status: 400 });

    const supabase = createServiceClient();

    const { data: client, error } = await supabase
      .from("clients")
      .select("*")
      .eq("id", clientId)
      .single();

    if (error || !client) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    const to: string[] = [client.socio1_email];
    if (client.socio2_email) to.push(client.socio2_email);

    const subject = deliveryEmailSubject(client.empresa_nombre_principal);
    const html = deliveryEmailHtml({
      clientName: client.socio1_nombre,
      llcName: client.empresa_nombre_principal,
      folderUrl: client.folder_url ?? undefined,
      clientId: client.client_id,
    });

    const result = await sendEmail({ to, subject, html });

    // Log email
    await supabase.from("email_logs").insert({
      client_id: clientId,
      type: "entrega",
      to_email: to.join(", "),
      subject,
      status: "sent",
      resend_id: result?.id,
    });

    // Update client
    await supabase
      .from("clients")
      .update({
        email_entrega_enviado: true,
        email_entrega_timestamp: new Date().toISOString(),
        status: "ENVIADO",
      })
      .eq("id", clientId);

    return NextResponse.json({ success: true, sentTo: to });
  } catch (err) {
    console.error("Email delivery error:", err);
    return NextResponse.json({ error: "Error enviando email" }, { status: 500 });
  }
}
