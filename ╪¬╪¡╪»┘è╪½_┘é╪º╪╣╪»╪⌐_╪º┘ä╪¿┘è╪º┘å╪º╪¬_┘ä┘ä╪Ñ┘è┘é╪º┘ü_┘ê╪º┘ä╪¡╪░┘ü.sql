-- شغّل هذا الملف مرة واحدة من Supabase Dashboard > SQL Editor
-- يضيف حالة الإيقاف المؤقت وتاريخ انتهاء الإيقاف إلى جدول العملاء.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS is_suspended boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suspended_until date NULL;

CREATE INDEX IF NOT EXISTS clients_suspension_idx
  ON public.clients (is_suspended, suspended_until);

-- سياسات RLS الحالية للمستخدمين المسجلين تسمح بالتحديث والحذف.
-- حذف العميل يحذف الحركات المالية المرتبطة به تلقائيًا لأن payments.client_id
-- مُعرّف بعلاقة ON DELETE CASCADE في المخطط الأصلي.
