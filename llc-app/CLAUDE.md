# LLC Creation App — Claude Instructions

Aplicación web profesional para gestionar el proceso completo de creación de LLC en Texas.
Empresa: DigiSenda AI | Contacto: admin@digisendaai.com

## Stack Técnico

- **Framework:** Next.js 15 (App Router, TypeScript)
- **Base de datos:** Supabase (PostgreSQL)
- **Auth:** Supabase Auth (solo admin)
- **Email:** Resend
- **PDF:** pdf-lib (server-side)
- **Estilos:** Tailwind CSS v4 + shadcn/ui
- **Forms:** React Hook Form + Zod
- **Deploy:** Vercel

## Flujo del Proceso LLC

```
1. NUEVO          → Cliente llena el formulario público (multi-step)
2. EN_PROCESO     → Admin revisa y confirma datos
3. CREAR_ESTRUC.  → Admin crea carpeta en Drive (manual, fuera del app)
4. GENERAR_DOCS   → App genera PDFs automáticamente
5. REVISADO       → Admin revisó todos los documentos
6. ENVIADO        → App envió emails al cliente
```

## Estructura de Archivos Clave

```
llc-app/
├── app/
│   ├── page.tsx                    → Redirect a /registro
│   ├── registro/page.tsx           → Formulario multi-paso (público)
│   ├── gracias/page.tsx            → Confirmación de envío
│   ├── admin/
│   │   ├── page.tsx                → Dashboard: lista de clientes
│   │   ├── login/page.tsx          → Login admin (Supabase Auth)
│   │   └── clientes/[id]/page.tsx  → Detalle de cliente + acciones
│   └── api/
│       ├── clients/route.ts        → POST: crear cliente
│       ├── clients/[id]/route.ts   → GET/PATCH: leer y actualizar
│       ├── documents/generate/route.ts → POST: generar PDFs
│       ├── emails/delivery/route.ts    → POST: enviar email de entrega
│       └── emails/review/route.ts     → POST: enviar solicitud de reseña
├── components/
│   ├── form/                       → Pasos del formulario
│   └── admin/                      → Componentes del dashboard
├── lib/
│   ├── supabase/                   → Clientes de Supabase
│   ├── documents/                  → Generación de PDFs
│   ├── email/                      → Templates y envío de emails
│   └── utils/                      → Helpers (client-id, fechas, etc.)
└── supabase/migrations/            → Migraciones SQL
```

## Variables del Formulario (Google Forms → App)

**Socio 1 (obligatorio):**
- socio1_nombre, socio1_nacimiento, socio1_email, socio1_telefono
- socio1_direccion, socio1_ssn (cifrado), socio1_porcentaje, socio1_beneficiario

**Socio 2 (opcional — solo LLC Multi Member):**
- socio2_nombre, socio2_nacimiento, socio2_email, socio2_telefono
- socio2_direccion, socio2_ssn (cifrado), socio2_porcentaje, socio2_beneficiario

**Empresa:**
- empresa_nombre_principal, empresa_nombre_alternativo
- empresa_direccion, empresa_ciudad, empresa_estado, empresa_zip
- empresa_actividad, empresa_fecha_inicio
- empresa_tipo: "LLC (Single Member)" | "LLC (Multi Member)"
- empresa_empleados

**Organizador + Agente (mismo que Socio 1 por defecto):**
- organizador_nombre, organizador_direccion
- agente_nombre, agente_direccion, agente_email

**Paquete:** ESENCIAL ($199, 7-10 días) | PROFESIONAL ($249, 3-5 días) | EXPRESS ($349, 1-2 días)

## Variables en Plantillas de Documentos

```
{{NOMBRE_LLC}}        → empresa_nombre_principal
{{TIPO_LLC}}          → empresa_tipo
{{FECHA_HOY}}         → fecha actual formateada
{{FECHA_INICIO}}      → empresa_fecha_inicio
{{NOMBRE_SOCIO_1}}    → socio1_nombre
{{NOMBRE_SOCIO_2}}    → socio2_nombre
{{DIRECCION_SOCIO_1}} → socio1_direccion
{{DIRECCION_SOCIO_2}} → socio2_direccion
{{PORCENTAJE_SOCIO_1}} → socio1_porcentaje
{{PORCENTAJE_SOCIO_2}} → socio2_porcentaje
{{ACTIVIDAD_LLC}}     → empresa_actividad
{{NOMBRE_AGENTE}}     → agente_nombre
{{DIRECCION_AGENTE}}  → agente_direccion
{{DIRECCION_LLC}}     → empresa_direccion
{{CLIENT_ID}}         → client_id (LLC-YYYYMMDD-XXXX)
{{ORGANIZER_NAME}}    → organizador_nombre
{{MEMBER_NAME}}       → socio1_nombre
{{MEMBER_ADDRESS}}    → socio1_direccion
{{DATE}}              → fecha actual
```

## Documentos Generados

1. **Statement and Resignation of the Organizer** → PDF
2. **Operating Agreement** → PDF  
3. **Banking Resolution** → PDF
4. **Registro de Aportes Iniciales** → PDF
5. **Carta de Separación Personal/Empresa** → PDF

## Emails Enviados

### Email 1 — Confirmación de entrega (post-creación)
- **A:** socio1_email (+ socio2_email si existe)
- **Asunto:** "Entrega de documentación – Creación de su LLC en Texas"
- **Contenido:** Lista de documentos + enlace a carpeta 06 de Drive
- **CC:** admin@digisendaai.com

### Email 2 — Solicitud de reseña (después del Email 1)
- **A:** socio1_email
- **Asunto:** "Comparte tu experiencia — [empresa_nombre_principal]"
- **Contenido:** Solicitud de reseña en Google Maps con enlace al perfil
- **Enlace Google Maps:** configurado en ENV: GOOGLE_MAPS_PROFILE_URL

## Status Badges

| Status | Color | Descripción |
|--------|-------|-------------|
| NUEVO | azul | Formulario recibido |
| EN_PROCESO | amarillo | Admin trabajando |
| GENERAR_DOCS | naranja | Generando documentos |
| REVISADO | verde claro | Docs listos para envío |
| ENVIADO | verde | Email enviado al cliente |

## Variables de Entorno Requeridas

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Resend
RESEND_API_KEY=
FROM_EMAIL=admin@digisendaai.com
ADMIN_EMAIL=admin@digisendaai.com

# Business
GOOGLE_MAPS_PROFILE_URL=  # URL del perfil de Google Maps de DigiSenda AI
COMPANY_NAME=DigiSenda AI
```

## Reglas de Desarrollo

- SSN debe almacenarse cifrado — nunca en texto plano
- El formulario público NO requiere auth
- El dashboard admin SÍ requiere auth (Supabase Auth)
- Los PDFs se generan server-side (API routes) y se almacenan en Supabase Storage
- Nunca mostrar SSN completo en el admin — solo últimos 4 dígitos
- El alcance del servicio es administrativo — no asesoría legal
- El cliente_id tiene formato: `LLC-YYYYMMDD-XXXX` (XXXX = 4 chars aleatorios uppercase)

## Comandos

```bash
npm run dev          # Desarrollo local
npm run build        # Build de producción
npm run type-check   # Verificar tipos TypeScript
supabase db push     # Aplicar migraciones
```
