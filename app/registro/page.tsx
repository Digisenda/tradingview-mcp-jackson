"use client";

import { useState } from "react";
import { useForm, UseFormRegister, FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { llcFormSchema, LLCFormValues } from "@/lib/utils/schema";
import { StepIndicator } from "@/components/form/StepIndicator";
import { FormField } from "@/components/form/FormField";

const TOTAL_STEPS = 6;

export default function RegistroPage() {
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const {
    register,
    handleSubmit,
    watch,
    trigger,
    formState: { errors },
  } = useForm<LLCFormValues>({
    resolver: zodResolver(llcFormSchema),
    defaultValues: {
      paquete: "ESENCIAL",
      empresa_estado: "TX",
      socio1_estado: "TX",
      empresa_empleados: 0,
    },
  });

  const tipoLLC = watch("empresa_tipo");
  const isMultiMember = tipoLLC === "LLC (Multi Member)";

  const STEP_FIELDS: (keyof LLCFormValues)[][] = [
    ["paquete"],
    [
      "empresa_nombre_principal",
      "empresa_direccion",
      "empresa_ciudad",
      "empresa_estado",
      "empresa_zip",
      "empresa_actividad",
      "empresa_fecha_inicio",
      "empresa_tipo",
    ],
    [
      "socio1_nombre",
      "socio1_nacimiento",
      "socio1_email",
      "socio1_telefono",
      "socio1_direccion",
      "socio1_ciudad",
      "socio1_estado",
      "socio1_zip",
      "socio1_ssn",
      "socio1_porcentaje",
    ],
    isMultiMember
      ? [
          "socio2_nombre",
          "socio2_nacimiento",
          "socio2_email",
          "socio2_telefono",
          "socio2_direccion",
          "socio2_porcentaje",
        ]
      : [],
    ["agente_nombre", "agente_direccion", "organizador_nombre", "organizador_direccion"],
    ["confirmacion_firma", "confirmacion_info", "confirmacion_servicio", "confirmacion_autorizacion", "confirmacion_tarifas"],
  ];

  async function nextStep() {
    const fields = STEP_FIELDS[step];
    const valid = fields.length === 0 || (await trigger(fields));
    if (valid) setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  }

  function prevStep() {
    setStep((s) => Math.max(s - 1, 0));
  }

  async function onSubmit(values: LLCFormValues) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error al enviar");
      router.push(`/gracias?clientId=${json.clientId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Registro de LLC en Texas</h1>
          <p className="text-gray-500 mt-1">DigiSenda AI — Servicio administrativo profesional</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border p-6 sm:p-8">
          <StepIndicator current={step} />

          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            {/* PASO 0: Paquete */}
            {step === 0 && <StepPaquete register={register} errors={errors} watch={watch} />}

            {/* PASO 1: Empresa */}
            {step === 1 && <StepEmpresa register={register} errors={errors} />}

            {/* PASO 2: Socio Principal */}
            {step === 2 && <StepSocio1 register={register} errors={errors} />}

            {/* PASO 3: Co-propietario (solo Multi Member) */}
            {step === 3 && (
              isMultiMember ? (
                <StepSocio2 register={register} errors={errors} />
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <p>LLC Single Member — No se requiere co-propietario.</p>
                </div>
              )
            )}

            {/* PASO 4: Agente y Organizador */}
            {step === 4 && <StepAgente register={register} errors={errors} watch={watch} />}

            {/* PASO 5: Confirmación */}
            {step === 5 && <StepConfirmacion register={register} errors={errors} watch={watch} />}

            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                {error}
              </div>
            )}

            {/* Navigation */}
            <div className="flex justify-between mt-8 pt-4 border-t">
              <button
                type="button"
                onClick={prevStep}
                disabled={step === 0}
                className="px-5 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Anterior
              </button>

              {step < TOTAL_STEPS - 1 ? (
                <button
                  type="button"
                  onClick={nextStep}
                  className="px-6 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Siguiente
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2 text-sm font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-60 transition-colors"
                >
                  {submitting ? "Enviando..." : "Enviar Solicitud"}
                </button>
              )}
            </div>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          Servicio administrativo. No constituye asesoría legal, fiscal ni contable.
        </p>
      </div>
    </main>
  );
}

// ─── Step Components ────────────────────────────────────────────────────────────────────────────────

function StepPaquete({ register, errors, watch }: { register: UseFormRegister<LLCFormValues>; errors: FieldErrors<LLCFormValues>; watch: any }) {
  const selected = watch("paquete");
  const packages = [
    {
      id: "ESENCIAL",
      name: "Esencial LLC",
      price: "$199",
      time: "7–10 días hábiles",
      features: ["Filing estatal Texas", "EIN (IRS)", "Declaración del Organizador", "Acuerdo Operativo", "Resolución Bancaria", "Guía y Checklist"],
    },
    {
      id: "PROFESIONAL",
      name: "Profesional LLC ⭐",
      price: "$249",
      time: "3–5 días hábiles",
      features: ["Todo lo del Esencial", "Revisión guiada del nombre", "Prioridad en ejecución", "Acompañamiento personal"],
      recommended: true,
    },
    {
      id: "EXPRESS",
      name: "Express LLC",
      price: "$349",
      time: "1–2 días hábiles*",
      features: ["Todo lo del Profesional", "Filing acelerado", "Entrega prioritaria"],
    },
  ];

  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">Seleccione su paquete</h2>
      <p className="text-gray-500 text-sm mb-6">El fee estatal de Texas no está incluido en ningún paquete.</p>
      <div className="space-y-3">
        {packages.map((pkg) => (
          <label
            key={pkg.id}
            className={`flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-colors
              ${selected === pkg.id ? "border-blue-600 bg-blue-50" : "border-gray-200 hover:border-gray-300"}`}
          >
            <input
              {...register("paquete")}
              type="radio"
              value={pkg.id}
              className="mt-1 accent-blue-600"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{pkg.name}</span>
                {pkg.recommended && (
                  <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full">Recomendado</span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-lg font-bold text-blue-600">{pkg.price}</span>
                <span className="text-sm text-gray-500">{pkg.time}</span>
              </div>
              <ul className="mt-2 text-xs text-gray-600 space-y-0.5">
                {pkg.features.map((f) => (
                  <li key={f} className="flex items-center gap-1">
                    <span className="text-green-500">✓</span> {f}
                  </li>
                ))}
              </ul>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

function StepEmpresa({ register, errors }: { register: UseFormRegister<LLCFormValues>; errors: FieldErrors<LLCFormValues> }) {
  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">Datos de la Empresa</h2>
      <p className="text-gray-500 text-sm mb-6">Información de la LLC a registrar.</p>
      <div className="grid gap-4">
        <FormField label="Nombre de la LLC" name="empresa_nombre_principal" register={register} error={errors.empresa_nombre_principal} required placeholder="Ej: TrueHand Service Group LLC" />
        <FormField label="2da opción del nombre (opcional)" name="empresa_nombre_alternativo" register={register} hint="Por si el nombre principal no está disponible" />
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <FormField label="Dirección del negocio" name="empresa_direccion" register={register} error={errors.empresa_direccion} required placeholder="Calle y número" />
          </div>
          <FormField label="Ciudad" name="empresa_ciudad" register={register} error={errors.empresa_ciudad} required placeholder="San Antonio" />
          <FormField label="Estado" name="empresa_estado" register={register} error={errors.empresa_estado} required placeholder="TX" />
          <FormField label="ZIP Code" name="empresa_zip" register={register} error={errors.empresa_zip} required placeholder="78229" />
        </div>
        <FormField label="Descripción del negocio" name="empresa_actividad" register={register} error={errors.empresa_actividad} required placeholder="Ej: Servicios de limpieza comercial y residencial" />
        <FormField label="Fecha de formación" name="empresa_fecha_inicio" register={register} error={errors.empresa_fecha_inicio} required type="date" />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Tipo de LLC <span className="text-red-500">*</span>
          </label>
          <div className="grid sm:grid-cols-2 gap-3">
            {(["LLC (Single Member)", "LLC (Multi Member)"] as const).map((tipo) => (
              <label key={tipo} className="flex items-center gap-2 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                <input {...register("empresa_tipo")} type="radio" value={tipo} className="accent-blue-600" />
                <div>
                  <div className="text-sm font-medium">{tipo}</div>
                  <div className="text-xs text-gray-500">
                    {tipo === "LLC (Single Member)" ? "Un solo propietario" : "Dos o más propietarios"}
                  </div>
                </div>
              </label>
            ))}
          </div>
          {errors.empresa_tipo && <p className="mt-1 text-xs text-red-600">{errors.empresa_tipo.message}</p>}
        </div>
        <FormField label="¿Tendrá empleados bajo nómina?" name="empresa_empleados" register={register} error={errors.empresa_empleados} type="number" placeholder="0" hint="Número de empleados (0 si no tendrá)" />
      </div>
    </div>
  );
}

function StepSocio1({ register, errors }: { register: UseFormRegister<LLCFormValues>; errors: FieldErrors<LLCFormValues> }) {
  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">Socio Principal</h2>
      <p className="text-gray-500 text-sm mb-6">Datos del propietario principal de la LLC.</p>
      <div className="grid gap-4">
        <FormField label="Nombre completo" name="socio1_nombre" register={register} error={errors.socio1_nombre} required />
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label="Fecha de nacimiento" name="socio1_nacimiento" register={register} error={errors.socio1_nacimiento} required type="date" />
          <FormField label="% de Propiedad" name="socio1_porcentaje" register={register} error={errors.socio1_porcentaje} required placeholder="100%" />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label="Email principal" name="socio1_email" register={register} error={errors.socio1_email} required type="email" placeholder="nombre@email.com" />
          <FormField label="Teléfono" name="socio1_telefono" register={register} error={errors.socio1_telefono} required placeholder="2108675124" hint="10 dígitos sin espacios ni guiones" />
        </div>
        <FormField label="Dirección física" name="socio1_direccion" register={register} error={errors.socio1_direccion} required placeholder="Calle y número" />
        <div className="grid sm:grid-cols-3 gap-4">
          <FormField label="Ciudad" name="socio1_ciudad" register={register} error={errors.socio1_ciudad} required />
          <FormField label="Estado" name="socio1_estado" register={register} error={errors.socio1_estado} required placeholder="TX" />
          <FormField label="ZIP Code" name="socio1_zip" register={register} error={errors.socio1_zip} required />
        </div>
        <FormField
          label="Número de Seguro Social (SSN)"
          name="socio1_ssn"
          register={register}
          error={errors.socio1_ssn}
          required
          type="password"
          placeholder="9 dígitos sin guiones"
          hint="Su SSN es cifrado y almacenado de forma segura. No se comparte con terceros."
        />
        <FormField label="Beneficiario designado (opcional)" name="socio1_beneficiario" register={register} placeholder="Nombre de la persona que actuaría en su nombre" hint="Si falleciera o no pudiera actuar, ¿a quién designaría?" />
      </div>
    </div>
  );
}

function StepSocio2({ register, errors }: { register: UseFormRegister<LLCFormValues>; errors: FieldErrors<LLCFormValues> }) {
  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">Co-propietario (Socio 2)</h2>
      <p className="text-gray-500 text-sm mb-6">Datos del segundo socio para LLC Multi Member.</p>
      <div className="grid gap-4">
        <FormField label="Nombre completo" name="socio2_nombre" register={register} error={errors.socio2_nombre} required />
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label="Fecha de nacimiento" name="socio2_nacimiento" register={register} error={errors.socio2_nacimiento} required type="date" />
          <FormField label="% de Propiedad" name="socio2_porcentaje" register={register} error={errors.socio2_porcentaje} required placeholder="50%" />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label="Email principal" name="socio2_email" register={register} error={errors.socio2_email} required type="email" />
          <FormField label="Teléfono" name="socio2_telefono" register={register} error={errors.socio2_telefono} required placeholder="2108675124" />
        </div>
        <FormField label="Dirección física" name="socio2_direccion" register={register} error={errors.socio2_direccion} required />
        <div className="grid sm:grid-cols-3 gap-4">
          <FormField label="Ciudad" name="socio2_ciudad" register={register} error={errors.socio2_ciudad} required />
          <FormField label="Estado" name="socio2_estado" register={register} error={errors.socio2_estado} required placeholder="TX" />
          <FormField label="ZIP Code" name="socio2_zip" register={register} error={errors.socio2_zip} required />
        </div>
        <FormField label="SSN del co-propietario" name="socio2_ssn" register={register} type="password" placeholder="9 dígitos sin guiones" hint="Cifrado y almacenado de forma segura." />
        <FormField label="Beneficiario designado (opcional)" name="socio2_beneficiario" register={register} />
      </div>
    </div>
  );
}

function StepAgente({ register, errors, watch }: { register: UseFormRegister<LLCFormValues>; errors: FieldErrors<LLCFormValues>; watch: any }) {
  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">Agente y Organizador</h2>
      <p className="text-gray-500 text-sm mb-6">Por defecto, estos datos coinciden con el socio principal.</p>

      <div className="mb-6">
        <h3 className="text-base font-semibold text-gray-800 mb-3">Agente Registrado</h3>
        <div className="grid gap-4">
          <FormField label="Nombre del agente registrado" name="agente_nombre" register={register} error={errors.agente_nombre} required />
          <FormField label="Dirección del agente" name="agente_direccion" register={register} error={errors.agente_direccion} required />
          <FormField label="Email del agente (opcional)" name="agente_email" register={register} error={errors.agente_email} type="email" />
        </div>
      </div>

      <div>
        <h3 className="text-base font-semibold text-gray-800 mb-3">Organizador</h3>
        <div className="grid gap-4">
          <FormField label="Nombre del organizador" name="organizador_nombre" register={register} error={errors.organizador_nombre} required />
          <FormField label="Dirección del organizador" name="organizador_direccion" register={register} error={errors.organizador_direccion} required />
        </div>
      </div>

      <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800">
        💡 En la mayoría de los casos, el agente registrado y el organizador son el mismo que el socio principal.
      </div>
    </div>
  );
}

function StepConfirmacion({ register, errors, watch }: { register: UseFormRegister<LLCFormValues>; errors: FieldErrors<LLCFormValues>; watch: any }) {
  const confirmations = [
    { name: "confirmacion_info", label: "Confirmo que la información proporcionada es correcta y verídica." },
    { name: "confirmacion_servicio", label: "Entiendo que este servicio es de carácter administrativo y no constituye asesoría legal, fiscal ni contable." },
    { name: "confirmacion_autorizacion", label: "Autorizo a DigiSenda AI a presentar la LLC en mi nombre ante el Texas Secretary of State." },
    { name: "confirmacion_tarifas", label: "Entiendo que las tarifas del estado de Texas no son reembolsables una vez presentada la solicitud." },
  ] as const;

  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">Confirmaciones y Firma</h2>
      <p className="text-gray-500 text-sm mb-6">Revise y acepte los siguientes términos para completar su solicitud.</p>

      <div className="space-y-3 mb-6">
        {confirmations.map(({ name, label }) => (
          <label key={name} className="flex items-start gap-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
            <input
              {...register(name as any)}
              type="checkbox"
              className="mt-0.5 w-4 h-4 accent-blue-600 flex-shrink-0"
            />
            <span className="text-sm text-gray-700">{label}</span>
          </label>
        ))}
      </div>

      {(Object.keys(errors) as any[]).some((k) => k.startsWith("confirmacion_") && k !== "confirmacion_firma") && (
        <p className="text-xs text-red-600 mb-4">Debe marcar todas las confirmaciones para continuar.</p>
      )}

      <FormField
        label="Firma electrónica"
        name="confirmacion_firma"
        register={register}
        error={errors.confirmacion_firma}
        required
        placeholder="Escriba su nombre completo como firma"
        hint="Al escribir su nombre completo, acepta que esta constituye su firma electrónica."
      />

      <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
        <strong>⚠️ Alcance del servicio:</strong> DigiSenda AI presta un servicio administrativo de creación de LLC. No ofrecemos asesoría legal, fiscal ni contable. Las tarifas del estado de Texas no están incluidas en nuestros paquetes.
      </div>
    </div>
  );
}
