-- إضافة خانة ملاحظات ثانية للحركات المالية دون حذف أو تغيير البيانات الحالية
ALTER TABLE public.payments
ADD COLUMN IF NOT EXISTS notes2 text NOT NULL DEFAULT '';
