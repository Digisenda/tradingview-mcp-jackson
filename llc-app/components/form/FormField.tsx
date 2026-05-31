"use client";

import { UseFormRegister, FieldError } from "react-hook-form";

interface FormFieldProps {
  label: string;
  name: string;
  register: UseFormRegister<any>;
  error?: FieldError;
  type?: string;
  placeholder?: string;
  required?: boolean;
  hint?: string;
}

export function FormField({
  label,
  name,
  register,
  error,
  type = "text",
  placeholder,
  required,
  hint,
}: FormFieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <input
        {...register(name)}
        type={type}
        placeholder={placeholder}
        className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors
          ${error ? "border-red-400 bg-red-50" : "border-gray-300 bg-white"}`}
      />
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error.message}</p>}
    </div>
  );
}
