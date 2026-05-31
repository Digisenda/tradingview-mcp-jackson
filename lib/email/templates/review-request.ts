interface ReviewEmailProps {
  clientName: string;
  llcName: string;
  googleMapsUrl: string;
}

export function reviewEmailHtml({ clientName, llcName, googleMapsUrl }: ReviewEmailProps): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Comparte tu experiencia</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">

  <div style="border-bottom: 3px solid #1a56db; padding-bottom: 20px; margin-bottom: 30px;">
    <h1 style="color: #1a56db; font-size: 22px; margin: 0;">DigiSenda AI</h1>
    <p style="color: #666; margin: 4px 0 0;">Servicio de Creación de LLC en Texas</p>
  </div>

  <p>Hola <strong>${clientName}</strong>,</p>

  <p>Esperamos que todo esté marchando bien con <strong>${llcName}</strong>.</p>

  <p>Ha sido un placer acompañarle en el proceso de creación de su LLC. Su satisfacción es muy importante para nosotros.</p>

  <div style="text-align: center; background: #f0f7ff; border-radius: 8px; padding: 30px 20px; margin: 28px 0;">
    <p style="font-size: 32px; margin: 0 0 8px;">⭐⭐⭐⭐⭐</p>
    <h2 style="margin: 0 0 12px; color: #1a56db;">¿Cómo fue su experiencia?</h2>
    <p style="margin: 0 0 20px; color: #555;">Si nuestro servicio le fue de utilidad, le agradecería mucho que compartiera su opinión en Google. Su reseña ayuda a que más personas puedan encontrar este servicio.</p>
    <a href="${googleMapsUrl}" style="background: #1a56db; color: white; padding: 14px 32px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block; font-size: 16px;">
      Dejar mi reseña en Google
    </a>
    <p style="margin: 16px 0 0; font-size: 12px; color: #888;">Solo toma 2 minutos y es completamente opcional</p>
  </div>

  <p style="font-size: 14px; color: #666;">Si tiene alguna pregunta sobre su documentación o necesita apoyo adicional, no dude en escribirnos.</p>

  <p>¡Mucho éxito con su empresa!</p>

  <p>
    <strong>Juan Aguilera Leyva</strong><br>
    DigiSenda AI<br>
    <a href="mailto:admin@digisendaai.com">admin@digisendaai.com</a>
  </p>

</body>
</html>`;
}

export function reviewEmailSubject(llcName: string): string {
  return `Comparte tu experiencia — ${llcName} | DigiSenda AI`;
}
