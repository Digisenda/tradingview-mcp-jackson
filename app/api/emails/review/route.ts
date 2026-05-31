import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email/resend";
import { reviewEmailHtml, reviewEmailSubject } from "@/lib/email/templates/review-request";

export async function POST(request: NextRequest) {
  try {
    const { clientId } = await request.json();
    if (!clientId) return NextResponse.json({ error: "clientId requerido" }, { status: 400 });

    const supabase = createServiceClient();

    const { data: client, error } = await supabase
      .from("clients")
      .select("id, client_id, socio1_nombre, socio1_email, empresa_nombre_principal, email_entrega_enviado")
      .eq("id", clientId)
      .single();

    if (error || !client) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    if (!client.email_entrega_enviado) {
      return NextResponse.json(
        { error: "El email de entrega debe enviarse primero" },
        { status: 400 }
      );
    }

    const googleMapsUrl =
      process.env.GOOGLE_MAPS_PROFILE_URL ?? "https://g.page/r/your-place-id/review";

    const subject = reviewEmailSubject(client.empresa_nombre_principal);
    const html = reviewEmailHtml({
      clientName: client.socio1_nombre,
      llcName: client.empresa_nombre_principal,
      googleMapsUrl,
    });

    const result = await sendEmail({
      to: client.socio1_email,
      subject,
      html,
      cc: [],
    });

    await supabase.from("email_logs").insert({
      client_id: clientId,
      type: "review",
      to_email: client.socio1_email,
      subject,
      status: "sent",
      resend_id: result?.id,
    });

    await supabase
      .from("clients")
      .update({
        email_review_enviado: true,
        email_review_timestamp: new Date().toISOString(),
      })
      .eq("id", clientId);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Review email error:", err);
    return NextResponse.json({ error: "Error enviando email de reseña" }, { status: 500 });
  }
}
