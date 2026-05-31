import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { fillTemplate, DocumentVariables } from "./templates/types";
import { organizerDeclarationTemplate } from "./templates/organizer-declaration";
import { operatingAgreementTemplate } from "./templates/operating-agreement";
import { bankingResolutionTemplate } from "./templates/banking-resolution";
import { aportesInicialesTemplate } from "./templates/aportes-iniciales";
import { cartaSeparacionTemplate } from "./templates/carta-separacion";
import { formatDate } from "@/lib/utils/client-id";

export type DocumentType =
  | "organizer_declaration"
  | "operating_agreement"
  | "banking_resolution"
  | "aportes_iniciales"
  | "carta_separacion";

const TEMPLATES: Record<DocumentType, string> = {
  organizer_declaration: organizerDeclarationTemplate,
  operating_agreement: operatingAgreementTemplate,
  banking_resolution: bankingResolutionTemplate,
  aportes_iniciales: aportesInicialesTemplate,
  carta_separacion: cartaSeparacionTemplate,
};

export function buildDocumentVariables(client: Record<string, unknown>): DocumentVariables {
  const today = formatDate(new Date());
  return {
    NOMBRE_LLC: String(client.empresa_nombre_principal ?? ""),
    TIPO_LLC: String(client.empresa_tipo ?? ""),
    FECHA_HOY: today,
    FECHA_INICIO: formatDate(String(client.empresa_fecha_inicio ?? new Date())),
    NOMBRE_SOCIO_1: String(client.socio1_nombre ?? ""),
    NOMBRE_SOCIO_2: client.socio2_nombre ? String(client.socio2_nombre) : undefined,
    DIRECCION_SOCIO_1: String(client.socio1_direccion ?? ""),
    DIRECCION_SOCIO_2: client.socio2_direccion ? String(client.socio2_direccion) : undefined,
    PORCENTAJE_SOCIO_1: String(client.socio1_porcentaje ?? "100%"),
    PORCENTAJE_SOCIO_2: client.socio2_porcentaje ? String(client.socio2_porcentaje) : undefined,
    ACTIVIDAD_LLC: String(client.empresa_actividad ?? ""),
    NOMBRE_AGENTE: String(client.agente_nombre ?? ""),
    DIRECCION_AGENTE: String(client.agente_direccion ?? ""),
    DIRECCION_LLC: [
      client.empresa_direccion,
      client.empresa_ciudad,
      client.empresa_estado,
      client.empresa_zip,
    ]
      .filter(Boolean)
      .join(", "),
    CLIENT_ID: String(client.client_id ?? ""),
    ORGANIZER_NAME: String(client.organizador_nombre ?? ""),
    MEMBER_NAME: String(client.socio1_nombre ?? ""),
    MEMBER_ADDRESS: String(client.socio1_direccion ?? ""),
    DATE: today,
  };
}

export async function generatePDF(
  type: DocumentType,
  vars: DocumentVariables
): Promise<Uint8Array> {
  const text = fillTemplate(TEMPLATES[type], vars);

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 60;
  const lineHeight = 16;
  const fontSize = 11;
  const pageWidth = 612;
  const pageHeight = 792;
  const maxWidth = pageWidth - margin * 2;

  const lines = text.split("\n");
  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  // Header
  page.drawText("DigiSenda AI — LLC Service", {
    x: margin,
    y: pageHeight - 30,
    size: 9,
    font,
    color: rgb(0.5, 0.5, 0.5),
  });
  page.drawText("Este servicio es de carácter administrativo. No constituye asesoría legal.", {
    x: margin,
    y: pageHeight - 42,
    size: 8,
    font,
    color: rgb(0.6, 0.6, 0.6),
  });

  y = pageHeight - 70;

  for (const rawLine of lines) {
    if (y < margin + lineHeight) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }

    const isHeading = rawLine.match(/^\d+\.|^[A-Z][A-Z\s/]+$/) && rawLine.length < 60;
    const usedFont = isHeading ? boldFont : font;
    const usedSize = isHeading ? 12 : fontSize;

    if (rawLine.trim() === "") {
      y -= lineHeight * 0.6;
      continue;
    }

    // Word wrap
    const words = rawLine.split(" ");
    let currentLine = "";
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const textWidth = usedFont.widthOfTextAtSize(testLine, usedSize);
      if (textWidth > maxWidth && currentLine) {
        if (y < margin + lineHeight) {
          page = pdfDoc.addPage([pageWidth, pageHeight]);
          y = pageHeight - margin;
        }
        page.drawText(currentLine, { x: margin, y, size: usedSize, font: usedFont, color: rgb(0, 0, 0) });
        y -= lineHeight;
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) {
      page.drawText(currentLine, { x: margin, y, size: usedSize, font: usedFont, color: rgb(0, 0, 0) });
      y -= lineHeight;
    }
  }

  return pdfDoc.save();
}

export function getDocumentFilename(type: DocumentType, clientId: string): string {
  const names: Record<DocumentType, string> = {
    organizer_declaration: "Declaracion-del-Organizador",
    operating_agreement: "Acuerdo-Operativo",
    banking_resolution: "Resolucion-Bancaria",
    aportes_iniciales: "Registro-Aportes-Iniciales",
    carta_separacion: "Carta-Separacion-Personal-Empresa",
  };
  return `${clientId}-${names[type]}.pdf`;
}
