-- نفّذ هذا الأمر مرة واحدة في Supabase > SQL Editor > New query
-- يجعل أرقام الموبايل الجديدة 11 رقمًا بدلًا من 12.
-- NOT VALID يتجنب الفشل إذا كانت هناك سجلات قديمة مسجلة بالفعل بطول 12 رقمًا.
ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_mobile_check;

ALTER TABLE public.clients
  ADD CONSTRAINT clients_mobile_check
  CHECK (mobile ~ '^[0-9]{11}$') NOT VALID;
