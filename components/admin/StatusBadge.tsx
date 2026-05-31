const STATUS_CONFIG: Record<string, { label: string; classes: string }> = {
  NUEVO: { label: "Nuevo", classes: "bg-blue-100 text-blue-800" },
  EN_PROCESO: { label: "En Proceso", classes: "bg-yellow-100 text-yellow-800" },
  GENERAR_DOCS: { label: "Generando Docs", classes: "bg-orange-100 text-orange-800" },
  REVISADO: { label: "Revisado", classes: "bg-emerald-100 text-emerald-800" },
  ENVIADO: { label: "Enviado", classes: "bg-green-100 text-green-800" },
};

export function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? { label: status, classes: "bg-gray-100 text-gray-700" };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.classes}`}>
      {config.label}
    </span>
  );
}

export const ALL_STATUSES = Object.keys(STATUS_CONFIG);
