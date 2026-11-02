/*
 * Regression check for the daily-profit totals shown on the الأرباح اليومية panel.
 *
 * It executes the REAL functions extracted from index.html
 * (parseAmount / rowMoney / filteredProfitRows / applyProfitFilters) against a
 * minimal DOM shim, so no Supabase connection, browser or build step is needed.
 *
 * Bug being guarded against: totals used to be recomputed by parsing the
 * rendered cell text with  Number(text.replace(/[^0-9.-]/g,'')) .
 * Because the formatter appends " ج.م" (which itself contains a dot),
 * "1,250.5 ج.م" became "1250.5." -> NaN -> 0, so every amount >= 1000 vanished
 * from إجمالي الدخل / إجمالي المصروفات / إجمالي صافي الربح, and expenses stopped
 * subtracting from income.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const failures = [];
const ok = (cond, msg, extra = '') => {
  if (cond) console.log('  ✔ ' + msg);
  else failures.push(msg + (extra ? ' — ' + extra : ''));
};

/* ---------- 1. extract the real source of the totals code ---------- */
const start = html.indexOf('const parseAmount=');
const endAnchor = html.indexOf("\n['dashCustomerSearch'");
if (start < 0 || endAnchor < 0 || endAnchor <= start) {
  console.error('FAIL: could not locate the profit-totals code inside index.html');
  process.exit(1);
}
const source = html.slice(start, endAnchor);
for (const fn of ['parseAmount', 'rowMoney', 'filteredProfitRows', 'applyProfitFilters']) {
  ok(source.includes(fn), `index.html still defines ${fn}()`);
}
ok(
  !/Number\(r\.cells\[1\]\.textContent\.replace/.test(html) &&
    !/Number\(r\.cells\[2\]\.textContent\.replace/.test(html),
  'totals no longer parse currency text with the broken [0-9.-] regex'
);

/* ---------- 2. minimal DOM shim ---------- */
const fmt = (v) => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ج.م';

function makeRow({ date, income, expenses, notes = '', withData = true }) {
  const cell = (textContent) => ({ textContent, hidden: false });
  const tr = {
    dataset: withData
      ? { date: String(date).slice(0, 10), income: String(income), expenses: String(expenses) }
      : {},
    cells: [
      cell(String(date)),
      cell(fmt(income)),
      cell(fmt(expenses)),
      cell(fmt(Number(income) - Number(expenses))),
      cell(notes),
      cell(''),
    ],
    hidden: false,
  };
  return tr;
}

function runCase(rows, filter = {}) {
  const totals = { profitTotalIncome: '', profitTotalExpenses: '', profitTotalNet: '' };
  const inputs = {
    profitFilterFrom: { value: filter.from || '' },
    profitFilterTo: { value: filter.to || '' },
    profitFilterText: { value: filter.q || '' },
    profitFilterType: { value: filter.type || 'all' },
  };
  const doc = {
    querySelectorAll: (sel) => (sel === '#profitHistoryBody tr' ? rows : []),
  };
  const $ = (id) => {
    if (id in totals) return { set textContent(v) { totals[id] = v; }, get textContent() { return totals[id]; } };
    if (id in inputs) return inputs[id];
    return null;
  };
  const canvasChart = () => {};
  const factory = new Function(
    'document', '$', 'fmt', 'canvasChart',
    `${source}\nreturn { filteredProfitRows, applyProfitFilters };`
  );
  const api = factory(doc, $, fmt, canvasChart);
  api.applyProfitFilters();
  return { totals, visible: api.filteredProfitRows().length, rows };
}

/* ---------- 3. assertions ---------- */
console.log('\nCase 1: amount >= 1000 (the reported symptom)');
{
  const { totals } = runCase([makeRow({ date: '2026-10-01', income: 1250.5, expenses: 300 })]);
  ok(totals.profitTotalIncome === fmt(1250.5), 'إجمالي الدخل = 1,250.5', totals.profitTotalIncome);
  ok(totals.profitTotalExpenses === fmt(300), 'إجمالي المصروفات = 300', totals.profitTotalExpenses);
  ok(totals.profitTotalNet === fmt(950.5), 'صافي الربح = 950.5 (المصروف مخصوم)', totals.profitTotalNet);
}

console.log('\nCase 2: several entries, expense subtracted from previous income');
{
  const rows = [
    makeRow({ date: '2026-10-02', income: 5000, expenses: 0 }),
    makeRow({ date: '2026-10-02', income: 0, expenses: 1750.25, notes: 'خصم' }),
    makeRow({ date: '2026-10-03', income: 250, expenses: 0 }),
  ];
  const { totals } = runCase(rows);
  ok(totals.profitTotalIncome === fmt(5250), 'الإجمالي الدخل = 5,250', totals.profitTotalIncome);
  ok(totals.profitTotalExpenses === fmt(1750.25), 'الإجمالي المصروفات = 1,750.25', totals.profitTotalExpenses);
  ok(totals.profitTotalNet === fmt(3499.75), 'الصافي = 3,499.75', totals.profitTotalNet);
}

console.log('\nCase 3: totals follow the active filter');
{
  const rows = [
    makeRow({ date: '2026-10-02', income: 3000, expenses: 0 }),
    makeRow({ date: '2026-10-05', income: 0, expenses: 1200, notes: 'مصروف شبكة' }),
  ];
  const { totals, visible } = runCase(rows, { type: 'expense' });
  ok(visible === 1, 'فلتر "مصروفات فقط" يعرض بيانًا واحدًا', String(visible));
  ok(totals.profitTotalExpenses === fmt(1200), 'المصروفات المفلترة = 1,200', totals.profitTotalExpenses);
  ok(totals.profitTotalNet === fmt(-1200), 'الصافي المفلتر = -1,200', totals.profitTotalNet);

  const byText = runCase(rows, { q: 'شبكة' });
  ok(byText.totals.profitTotalExpenses === fmt(1200), 'البحث في الملاحظات يعمل', byText.totals.profitTotalExpenses);
}

console.log('\nCase 4: fallback parsing of already-rendered rows (no data-*)');
{
  const rows = [makeRow({ date: '2026-10-07', income: 2500.75, expenses: 0, withData: false })];
  const { totals } = runCase(rows);
  ok(totals.profitTotalIncome === fmt(2500.75), "'2,500.75 ج.م' يُقرأ صحيحًا من النص", totals.profitTotalIncome);
}

console.log('\nCase 5: empty state row does not break the totals');
{
  const empty = { dataset: {}, cells: [{ textContent: 'لا توجد سجلات بعد.' }], hidden: false };
  const { totals, visible } = runCase([empty]);
  ok(visible === 0, 'صف "لا توجد سجلات" مستبعد', String(visible));
  ok(totals.profitTotalIncome === fmt(0) && totals.profitTotalNet === fmt(0), 'الإجماليات = 0', totals.profitTotalIncome);
}

/* ---------- result ---------- */
if (failures.length) {
  console.error(`\nFAILED (${failures.length}):`);
  failures.forEach((f) => console.error('  ✘ ' + f));
  process.exit(1);
}
console.log('\nAll profit-totals regression checks passed.');
