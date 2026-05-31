"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { StatusBadge, ALL_STATUSES } from "@/components/admin/StatusBadge";
import { maskSSN } from "@/lib/utils/client-id";

type Client = Record<string, any>;

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchClient = useCallback(async () => {
    const res = await fetch(`/api/clients/${id}`);
    const json = await res.json();
    setClient(json.client);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchClient();
  }, [fetchClient]);

  async function updateField(key: string, value: unknown) {
    setSaving(true);
    const res = await fetch(`/api/clients/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    });
    const json = await res.json();
    if (json.success) {
      setClient((c) => c ? { ...c, [key]: value } : c);
      setMsg({ type: "success", text: "Guardado correctamente" });
    } else {
      setMsg({ type: "error", text: json.error ?? "Error al guardar" });
    }
    setSaving(false);
    setTimeout(() => setMsg(null), 3000);
  }

  async function generateDocs() {
    setSaving(true);
    const res = await fetch("/api/documents/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: id }),
    });
    const json = await res.json();
    if (json.success) {
      setMsg({ type: "success", text: `Documentos generados: ${json.generated.join(", ")}` });
      fetchClient();
    } else {
      setMsg({ type: "error", text: json.error });
    }
    setSaving(false);
  }

  async function sendDeliveryEmail() {
    setSaving(true);
    const res = await fetch("/api/emails/delivery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: id }),
    });
    const json = await res.json();
    if (json.success) {
      setMsg({ type: "success", text: `Email de entrega enviado a: ${json.sentTo.join(", ")}` });
      fetchClient();
    } else {
      setMsg({ type: "error", text: json.error });
    }
    setSaving(false);
  }

  async function sendReviewEmail() {
    setSaving(true);
    const res = await fetch("/api/emails/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: id }),
    });
    const json = await res.json();
    if (json.success) {
      setMsg({ type: "success", text: "Email de solicitud de reseña enviado" });
      fetchClient();
    } else {
      setMsg({ type: "error", text: json.error });
    }
    setSaving(false);
  }

  if (loading) {
    return <div className="text-center py-20 text-gray-500">Cargando...</div>;
  }

  if (!client) {
    return <div className="text-center py-20 text-red-500">Cliente no encontrado</div>;
  }

  const docs = client.documents ?? [];

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="text-sm text-gray-500 hover:text-gray-900">
          ← Volver
        </button>
        <h1 className="text-2xl font-bold text-gray-900">{client.empresa_nombre_principal}</h1>
        <StatusBadge status={client.status} />
      </div>

      {msg && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${msg.type === "success" ? "bg-green-50 border border-green-200 text-green-800" : "bg-red-50 border border-red-200 text-red-800"}`}>
          {msg.text}
        </div>
      )}

      <div className="grid gap-6">
        {/* Actions */}
        <div className="bg-white rounded-lg border p-5">
          <h2 className="font-semibold text-gray-800 mb-4">Acciones del proceso</h2>

          <div className="flex flex-wrap gap-3 mb-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Cambiar status</label>
              <select
                value={client.status}
                onChange={(e) => updateField("status", e.target.value)}
                className="text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {ALL_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={generateDocs}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              📄 Generar documentos PDF
            </button>

            <button
              onClick={sendDeliveryEmail}
              disabled={saving || client.email_entrega_enviado}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-60 transition-colors"
            >
              {client.email_entrega_enviado ? "✓ Email entrega enviado" : "📧 Enviar email de entrega"}
            </button>

            <button
              onClick={sendReviewEmail}
              disabled={saving || !client.email_entrega_enviado || client.email_review_enviado}
              className="px-4 py-2 bg-yellow-500 text-white text-sm font-medium rounded-lg hover:bg-yellow-600 disabled:opacity-60 transition-colors"
              title={!client.email_entrega_enviado ? "Primero envíe el email de entrega" : ""}
            >
              {client.email_review_enviado ? "✓ Reseña enviada" : "⭐ Solicitar reseña Google"}
            </button>
          </div>
        </div>

        {/* Drive folder */}
        <div className="bg-white rounded-lg border p-5">
          <h2 className="font-semibold text-gray-800 mb-3">Google Drive</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Folder ID (Drive)</label>
              <div className="flex gap-2">
                <input
                  defaultValue={client.folder_id ?? ""}
                  onBlur={(e) => updateField("folder_id", e.target.value)}
                  className="flex-1 text-sm border rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                  placeholder="1xxxxxxxxxxxxx"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">URL de la carpeta (para email)</label>
              <input
                defaultValue={client.folder_url ?? ""}
                onBlur={(e) => updateField("folder_url", e.target.value)}
                className="w-full text-sm border rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="https://drive.google.com/drive/folders/..."
              />
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="bg-white rounded-lg border p-5">
          <h2 className="font-semibold text-gray-800 mb-3">Notas internas</h2>
          <textarea
            defaultValue={client.notes ?? ""}
            onBlur={(e) => updateField("notes", e.target.value)}
            rows={4}
            className="w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Notas del proceso, observaciones, incidencias..."
          />
        </div>

        {/* Client data */}
        <div className="grid sm:grid-cols-2 gap-6">
          <DataSection title="Empresa">
            <DataRow label="Nombre principal" value={client.empresa_nombre_principal} />
            <DataRow label="Nombre alternativo" value={client.empresa_nombre_alternativo} />
            <DataRow label="Tipo" value={client.empresa_tipo} />
            <DataRow label="Paquete" value={client.paquete} />
            <DataRow label="Actividad" value={client.empresa_actividad} />
            <DataRow label="Dirección" value={`${client.empresa_direccion}, ${client.empresa_ciudad}, ${client.empresa_estado} ${client.empresa_zip}`} />
            <DataRow label="Fecha inicio" value={client.empresa_fecha_inicio} />
            <DataRow label="Empleados" value={String(client.empresa_empleados ?? 0)} />
          </DataSection>

          <DataSection title="Socio Principal">
            <DataRow label="Nombre" value={client.socio1_nombre} />
            <DataRow label="Email" value={client.socio1_email} />
            <DataRow label="Teléfono" value={client.socio1_telefono} />
            <DataRow label="Nacimiento" value={client.socio1_nacimiento} />
            <DataRow label="Dirección" value={`${client.socio1_direccion}, ${client.socio1_ciudad}`} />
            <DataRow label="SSN" value={client.socio1_ssn_last4 ? `***-**-${client.socio1_ssn_last4}` : "—"} />
            <DataRow label="% Propiedad" value={client.socio1_porcentaje} />
            <DataRow label="Beneficiario" value={client.socio1_beneficiario} />
          </DataSection>

          {client.socio2_nombre && (
            <DataSection title="Co-propietario (Socio 2)">
              <DataRow label="Nombre" value={client.socio2_nombre} />
              <DataRow label="Email" value={client.socio2_email} />
              <DataRow label="Teléfono" value={client.socio2_telefono} />
              <DataRow label="Nacimiento" value={client.socio2_nacimiento} />
              <DataRow label="Dirección" value={client.socio2_direccion} />
              <DataRow label="SSN" value={client.socio2_ssn_last4 ? `***-**-${client.socio2_ssn_last4}` : "—"} />
              <DataRow label="% Propiedad" value={client.socio2_porcentaje} />
            </DataSection>
          )}

          <DataSection title="Agente y Organizador">
            <DataRow label="Agente nombre" value={client.agente_nombre} />
            <DataRow label="Agente dirección" value={client.agente_direccion} />
            <DataRow label="Agente email" value={client.agente_email} />
            <DataRow label="Organizador nombre" value={client.organizador_nombre} />
            <DataRow label="Organizador dirección" value={client.organizador_direccion} />
          </DataSection>
        </div>

        {/* Documents */}
        <div className="bg-white rounded-lg border p-5">
          <h2 className="font-semibold text-gray-800 mb-3">Documentos generados</h2>
          {docs.length === 0 ? (
            <p className="text-sm text-gray-500">No hay documentos generados aún. Use el botón "Generar documentos PDF" para crearlos.</p>
          ) : (
            <div className="space-y-2">
              {docs.map((doc: any) => (
                <div key={doc.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{doc.filename}</p>
                    <p className="text-xs text-gray-500">{new Date(doc.generated_at).toLocaleString("es-MX")}</p>
                  </div>
                  {doc.public_url && (
                    <a href={doc.public_url} target="_blank" className="text-blue-600 hover:underline text-xs font-medium">
                      Descargar PDF
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Email logs */}
        {client.email_logs?.length > 0 && (
          <div className="bg-white rounded-lg border p-5">
            <h2 className="font-semibold text-gray-800 mb-3">Historial de emails</h2>
            <div className="space-y-2">
              {client.email_logs.map((log: any) => (
                <div key={log.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg text-sm">
                  <div>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${log.type === "entrega" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
                      {log.type === "entrega" ? "Entrega" : "Reseña"}
                    </span>
                    <span className="ml-2 text-gray-600">{log.to_email}</span>
                  </div>
                  <span className="text-xs text-gray-500">{new Date(log.sent_at).toLocaleString("es-MX")}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DataSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border p-5">
      <h2 className="font-semibold text-gray-800 mb-3">{title}</h2>
      <dl className="space-y-2">{children}</dl>
    </div>
  );
}

function DataRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-900 font-medium">{value}</dd>
    </div>
  );
}
