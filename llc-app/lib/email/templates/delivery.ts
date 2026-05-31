interface DeliveryEmailProps {
  clientName: string;
  llcName: string;
  folderUrl?: string;
  clientId: string;
}

export function deliveryEmailHtml({ clientName, llcName, folderUrl, clientId }: DeliveryEmailProps): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Entrega de documentación – ${llcName}</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">

  <div style="border-bottom: 3px solid #1a56db; padding-bottom: 20px; margin-bottom: 30px;">
    <h1 style="color: #1a56db; font-size: 22px; margin: 0;">DigiSenda AI</h1>
    <p style="color: #666; margin: 4px 0 0;">Servicio de Creación de LLC en Texas</p>
  </div>

  <p>Hola <strong>${clientName}</strong>,</p>

  <p>Le confirmo que el proceso administrativo de creación de su LLC ha sido completado.</p>

  <p>En este mensaje encontrará acceso a la carpeta con la documentación final de su empresa, organizada y lista para su uso.</p>

  <div style="background: #f0f7ff; border-left: 4px solid #1a56db; padding: 16px 20px; margin: 24px 0; border-radius: 4px;">
    <h2 style="margin: 0 0 12px; font-size: 16px; color: #1a56db;">📁 Documentación entregada</h2>
    <p style="margin: 0 0 8px;">Dentro de la carpeta encontrará:</p>
    <ul style="margin: 0; padding-left: 20px;">
      <li><strong>Articles of Organization</strong> – Documento oficial del Texas Secretary of State</li>
      <li><strong>EIN / IRS CP 575</strong> – Confirmación oficial del número de identificación fiscal</li>
      <li><strong>Declaración del Organizador</strong> – Documento interno de la LLC</li>
      <li><strong>Acuerdo Operativo</strong> – Reglas básicas de funcionamiento de la empresa</li>
      <li><strong>Resolución Bancaria</strong> – Para apertura de cuenta bancaria</li>
      <li><strong>Registro de Aportes Iniciales</strong> – Control administrativo interno</li>
      <li><strong>Carta de Separación Personal/Empresa</strong> – Buenas prácticas de cumplimiento</li>
    </ul>
  </div>

  ${folderUrl ? `
  <div style="text-align: center; margin: 28px 0;">
    <a href="${folderUrl}" style="background: #1a56db; color: white; padding: 14px 28px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;">
      📂 Acceder a mis documentos
    </a>
  </div>
  ` : ""}

  <div style="background: #f9f9f9; padding: 16px 20px; border-radius: 4px; margin: 24px 0;">
    <h3 style="margin: 0 0 10px; font-size: 14px;">📌 Recomendaciones</h3>
    <ul style="margin: 0; padding-left: 20px; font-size: 14px;">
      <li>Conserve esta documentación en un lugar seguro.</li>
      <li>No modifique los documentos oficiales emitidos por el Estado o el IRS.</li>
      <li>Presente siempre los documentos completos cuando le sean solicitados.</li>
    </ul>
  </div>

  <div style="background: #fff8e1; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 4px; font-size: 13px; margin: 24px 0;">
    <strong>⚠️ Alcance del servicio:</strong> Este servicio es de carácter administrativo y no constituye asesoría legal, fiscal ni contable.
  </div>

  <p>Quedo a disposición para cualquier duda administrativa relacionada con esta documentación.</p>

  <p>Saludos,</p>
  <p>
    <strong>Juan Aguilera Leyva</strong><br>
    DigiSenda AI<br>
    <a href="mailto:admin@digisendaai.com">admin@digisendaai.com</a>
  </p>

  <div style="border-top: 1px solid #eee; padding-top: 16px; margin-top: 30px; font-size: 11px; color: #999;">
    Caso: ${clientId} | LLC: ${llcName}
  </div>

</body>
</html>`;
}

export function deliveryEmailSubject(llcName: string): string {
  return `Entrega de documentación – Creación de su LLC en Texas | ${llcName}`;
}
