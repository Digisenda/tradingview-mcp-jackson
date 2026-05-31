"use client";

const STEPS = [
  { label: "Paquete" },
  { label: "Empresa" },
  { label: "Socio Principal" },
  { label: "Co-propietario" },
  { label: "Agente" },
  { label: "Confirmación" },
];

export function StepIndicator({ current }: { current: number }) {
  return (
    <nav className="mb-8">
      <ol className="flex items-center gap-0">
        {STEPS.map((step, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={i} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors
                    ${done ? "bg-blue-600 border-blue-600 text-white" : ""}
                    ${active ? "border-blue-600 text-blue-600 bg-white" : ""}
                    ${!done && !active ? "border-gray-300 text-gray-400 bg-white" : ""}
                  `}
                >
                  {done ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </div>
                <span
                  className={`mt-1 text-xs font-medium hidden sm:block ${
                    active ? "text-blue-600" : done ? "text-gray-700" : "text-gray-400"
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mx-1 ${done ? "bg-blue-600" : "bg-gray-200"}`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
