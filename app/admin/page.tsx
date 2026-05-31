import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/admin/StatusBadge";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const supabase = createServiceClient();
  const { data: clients } = await supabase
    .from("clients")
    .select("id, client_id, status, paquete, empresa_nombre_principal, empresa_tipo, socio1_nombre, socio1_email, email_entrega_enviado, email_review_enviado, created_at")
    .order("created_at", { ascending: false });

  const counts = {
    total: clients?.length ?? 0,
    nuevo: clients?.filter((c) => c.status === "NUEVO").length ?? 0,
    en_proceso: clients?.filter((c) => c.status === "EN_PROCESO").length ?? 0,
    enviado: clients?.filter((c) => c.status === "ENVIADO").length ?? 0,
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Clientes LLC</h1>
        <a
          href="/registro"
          target="_blank"
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
        >
          Ver formulario público →
        </a>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total", value: counts.total, color: "text-gray-900" },
          { label: "Nuevos", value: counts.nuevo, color: "text-blue-600" },
          { label: "En proceso", value: counts.en_proceso, color: "text-yellow-600" },
          { label: "Completados", value: counts.enviado, color: "text-green-600" },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-lg border p-4">
            <p className="text-sm text-gray-500">{stat.label}</p>
            <p className={`text-3xl font-bold mt-1 ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">ID / LLC</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Cliente</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Tipo</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Paquete</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Emails</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Fecha</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {clients?.map((client) => (
                <tr key={client.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-mono text-xs text-gray-500">{client.client_id}</div>
                    <div className="font-semibold text-gray-900">{client.empresa_nombre_principal}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-gray-900">{client.socio1_nombre}</div>
                    <div className="text-xs text-gray-500">{client.socio1_email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      client.empresa_tipo === "LLC (Multi Member)"
                        ? "bg-purple-100 text-purple-800"
                        : "bg-gray-100 text-gray-700"
                    }`}>
                      {client.empresa_tipo === "LLC (Multi Member)" ? "Multi" : "Single"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium text-gray-700">{client.paquete}</span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={client.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${client.email_entrega_enviado ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-400"}`}>
                        {client.email_entrega_enviado ? "✓ Entrega" : "○ Entrega"}
                      </span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${client.email_review_enviado ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-400"}`}>
                        {client.email_review_enviado ? "✓ Reseña" : "○ Reseña"}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {new Date(client.created_at).toLocaleDateString("es-MX")}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/clientes/${client.id}`}
                      className="text-blue-600 hover:underline text-xs font-medium whitespace-nowrap"
                    >
                      Ver detalles →
                    </Link>
                  </td>
                </tr>
              ))}
              {(!clients || clients.length === 0) && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                    No hay clientes registrados aún.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
