-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TABLE: clients
-- ============================================================
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT UNIQUE NOT NULL,

  -- Status flow: NUEVO → EN_PROCESO → GENERAR_DOCS → REVISADO → ENVIADO
  status TEXT NOT NULL DEFAULT 'NUEVO'
    CHECK (status IN ('NUEVO','EN_PROCESO','GENERAR_DOCS','REVISADO','ENVIADO')),

  -- Paquete contratado
  paquete TEXT NOT NULL DEFAULT 'ESENCIAL'
    CHECK (paquete IN ('ESENCIAL','PROFESIONAL','EXPRESS')),

  -- Socio 1 (obligatorio)
  socio1_nombre TEXT NOT NULL,
  socio1_nacimiento DATE NOT NULL,
  socio1_email TEXT NOT NULL,
  socio1_telefono TEXT NOT NULL,
  socio1_direccion TEXT NOT NULL,
  socio1_ciudad TEXT,
  socio1_estado TEXT DEFAULT 'TX',
  socio1_zip TEXT,
  socio1_ssn_encrypted TEXT,      -- AES encrypted SSN
  socio1_ssn_last4 TEXT,          -- Last 4 digits for display only
  socio1_porcentaje TEXT NOT NULL DEFAULT '100%',
  socio1_beneficiario TEXT,

  -- Socio 2 (opcional — Multi Member LLC)
  socio2_nombre TEXT,
  socio2_nacimiento DATE,
  socio2_email TEXT,
  socio2_telefono TEXT,
  socio2_direccion TEXT,
  socio2_ciudad TEXT,
  socio2_estado TEXT,
  socio2_zip TEXT,
  socio2_ssn_encrypted TEXT,
  socio2_ssn_last4 TEXT,
  socio2_porcentaje TEXT,
  socio2_beneficiario TEXT,

  -- Empresa
  empresa_nombre_principal TEXT NOT NULL,
  empresa_nombre_alternativo TEXT,
  empresa_direccion TEXT NOT NULL,
  empresa_ciudad TEXT NOT NULL,
  empresa_estado TEXT NOT NULL DEFAULT 'TX',
  empresa_zip TEXT NOT NULL,
  empresa_actividad TEXT NOT NULL,
  empresa_fecha_inicio DATE NOT NULL,
  empresa_tipo TEXT NOT NULL CHECK (empresa_tipo IN ('LLC (Single Member)','LLC (Multi Member)')),
  empresa_empleados INTEGER NOT NULL DEFAULT 0,

  -- Organizador (puede ser mismo que socio1)
  organizador_nombre TEXT NOT NULL,
  organizador_direccion TEXT NOT NULL,

  -- Agente registrado (puede ser mismo que socio1)
  agente_nombre TEXT NOT NULL,
  agente_direccion TEXT NOT NULL,
  agente_email TEXT,

  -- Confirmación del cliente
  confirmacion_firma TEXT,
  confirmacion_timestamp TIMESTAMPTZ,

  -- Meta / tracking
  folder_id TEXT,             -- Google Drive folder ID (carpeta 06)
  folder_url TEXT,            -- Google Drive URL para compartir
  notes TEXT,                 -- Notas internas del admin

  -- Email tracking
  email_entrega_enviado BOOLEAN NOT NULL DEFAULT false,
  email_entrega_timestamp TIMESTAMPTZ,
  email_review_enviado BOOLEAN NOT NULL DEFAULT false,
  email_review_timestamp TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- TABLE: documents
-- ============================================================
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'organizer_declaration',
    'operating_agreement',
    'banking_resolution',
    'aportes_iniciales',
    'carta_separacion'
  )),
  filename TEXT NOT NULL,
  storage_path TEXT,          -- Path in Supabase Storage
  public_url TEXT,            -- Public URL for download
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- TABLE: email_logs
-- ============================================================
CREATE TABLE IF NOT EXISTS email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('entrega','review')),
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  resend_id TEXT,             -- Resend message ID for tracking
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_clients_status ON clients(status);
CREATE INDEX idx_clients_created_at ON clients(created_at DESC);
CREATE INDEX idx_documents_client ON documents(client_id);
CREATE INDEX idx_email_logs_client ON email_logs(client_id);

-- ============================================================
-- TRIGGER: updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- STORAGE BUCKET
-- ============================================================
-- Run this in Supabase dashboard or via CLI:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('llc-documents', 'llc-documents', false);

-- ============================================================
-- RLS POLICIES (Row Level Security)
-- ============================================================
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;

-- Only authenticated admins can read/write clients
CREATE POLICY "admin_all_clients" ON clients
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "admin_all_documents" ON documents
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "admin_all_email_logs" ON email_logs
  FOR ALL USING (auth.role() = 'authenticated');

-- Service role bypasses RLS (used in API routes)
