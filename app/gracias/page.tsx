import Link from "next/link";

export default function GraciasPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string }>;
}) {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-sm border p-8 text-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">¡Solicitud recibida!</h1>
        <p className="text-gray-600 mb-6">
          Hemos recibido su información. Nuestro equipo revisará su solicitud y se pondrá en contacto en las próximas horas.
        </p>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 text-left">
          <h2 className="font-semibold text-blue-900 mb-2">Próximos pasos</h2>
          <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
            <li>Revisaremos su información en máximo 24 horas</li>
            <li>Le confirmaremos el inicio del proceso por email</li>
            <li>Realizaremos el filing ante el Texas Secretary of State</li>
            <li>Le entregaremos toda la documentación completada</li>
          </ol>
        </div>

        <p className="text-sm text-gray-500 mb-4">
          ¿Preguntas? Escríbanos a{" "}
          <a href="mailto:admin@digisendaai.com" className="text-blue-600 hover:underline">
            admin@digisendaai.com
          </a>
        </p>

        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
          Este servicio es de carácter administrativo y no constituye asesoría legal, fiscal ni contable.
        </p>
      </div>
    </main>
  );
}
