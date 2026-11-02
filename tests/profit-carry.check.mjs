/**
 * Regression checks for the carried-profit-balance engine and the printed A4 totals.
 * Executes the real functions extracted from index.html (no Supabase, no browser).
 *
 * Coverage:
 *  1. Carry-over between days (balance moves to the next day).
 *  2. Expense fully covered by the carried balance.
 *  3. Expense exceeding the carried balance (difference hits today's income).
 *  4. Single-day and period selection (no double counting).
 *  5. Edit and delete recompute the carried balance and the totals.
 *  6. Printed report contains the five required totals + filters + movement table.
 */

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const failures = [];
const ok = (cond, msg, extra = '') => {
  if (cond) console.log('  \u2714 ' + msg);
  else failures.push(msg + (extra ? ' \u2014 ' + extra : ''));
};
const eq = (actual, expected, msg) =>
  ok(actual === expected, msg, `got ${actual}, expected ${expected}`);

/* ---------- 1. Extract the real calculation code ---------- */

const start = html.indexOf('const parseAmount=');
const endAnchor = html.indexOf("\n['dashCustomerSearch'");
if (start < 0 || endAnchor < 0 || endAnchor <= start) {
  console.error('FAIL: could not locate the profit calculation block in index.html');
  process.exit(1);
}
const source = html.slice(start, endAnchor);

const printStart = html.indexOf("$('printDailyProfit')?.addEventListener('click',()=>{");
const printEndAnchor = "},800)});";
const printEnd = html.indexOf(printEndAnchor, printStart);
if (printStart < 0 || printEnd < 0) {
  console.error('FAIL: could not locate the print handler in index.html');
  process.exit(1);
}
const printSource = html.slice(printStart, printEnd + printEndAnchor.length);

for (const fn of [
  'carryLedger',
  'carryReport',
  'decorateProfitRows',
  'filteredProfitRows',
  'applyProfitFilters',
  'profitRowEntries'
]) {
  ok(source.includes(fn), `index.html still defines ${fn}()`);
}
ok(html.includes('profitTotalCarried'), 'UI exposes the carried-balance card');
ok(html.includes('profitTotalRemaining'), 'UI exposes the remaining-balance card');
ok(printSource.includes('print-summary'), 'print report renders the totals summary block');

/* ---------- 2. DOM shim ---------- */

const fmt = (v) =>
  Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

let printedHtml = '';
let printCalls = 0;

function makeRow({ date, income, expenses, notes = '' }) {
  const cell = (textContent) => ({ textContent, innerHTML: textContent });
  return {
    dataset: {
      date: String(date).slice(0, 10),
      income: String(income),
      expenses: String(expenses)
    },
    cells: [
      cell(String(date)),
      cell(fmt(income)),
      cell(fmt(expenses)),
      cell(fmt(Number(income) - Number(expenses))),
      cell(notes),
      cell('')
    ],
    hidden: false
  };
}

function run(rows, filter = {}) {
  const totals = {};
  const inputs = {
    profitFilterFrom: { value: filter.from || '' },
    profitFilterTo: { value: filter.to || '' },
    profitFilterText: { value: filter.q || '' },
    profitFilterType: {
      value: filter.type || 'all',
      selectedOptions: [{ textContent: filter.typeLabel || 'الكل' }]
    }
  };
  const body = { querySelectorAll: (sel) => (sel === 'tr' ? rows : []) };
  const tableHead = { outerHTML: '<thead><tr><th>التاريخ</th></tr></thead>' };
  const handlerRef = { fn: null };
  const printArea = {
    classList: { add() {}, remove() {} },
    set innerHTML(v) {
      printedHtml = v;
    },
    get innerHTML() {
      return printedHtml;
    }
  };

  const $ = (id) => {
    if (id === 'profitHistoryBody') return body;
    if (id === 'printArea') return printArea;
    if (id === 'profitDailyProfit') return null;
    if (id in inputs) return inputs[id];
    if (id === 'printDailyProfit')
      return {
        addEventListener: (_ev, fn) => {
          handlerRef.fn = fn;
        }
      };
    // totals targets
    return {
      set textContent(v) {
        totals[id] = v;
      },
      get textContent() {
        return totals[id] ?? '';
      }
    };
  };

  const doc = {
    querySelectorAll: (sel) => (sel === '#profitHistoryBody tr' ? rows : []),
    querySelector: (sel) =>
      sel === '#profitHistoryTable thead' ? tableHead : null,
    body: { classList: { add() {}, remove() {} } }
  };

  const win = {
    print: () => {
      printCalls += 1;
    }
  };

  const factory = new Function(
    'document',
    '$',
    'fmt',
    'canvasChart',
    'window',
    'setTimeout',
    `${source}\n${printSource}\n
     return { filteredProfitRows, applyProfitFilters, carryLedger, carryReport,
              allProfitRows, profitRowEntries, decorateProfitRows,
   };`
  );

  const api = factory(doc, $, fmt, () => {}, win, (fn) => fn());

  api.applyProfitFilters();

  return { api, totals, rows, handler: handlerRef.fn };
}

/* ---------- 3. Cases ---------- */

console.log('\nCase 1: the balance carries from one day to the next');
{
  const rows = [
    makeRow({ date: '2026-10-01', income: 1000, expenses: 200, notes: 'يوم أول' }),
    makeRow({ date: '2026-10-02', income: 500, expenses: 300, notes: 'يوم ثانٍ' })
  ];
  const { api } = run(rows);
  const led = api.carryLedger(api.profitRowEntries(api.allProfitRows()));
  eq(led.days.length, 2, 'ledger has one entry per day');
  eq(led.days[0].balance, 800, 'day 1 closing balance = 800');
  eq(led.days[1].carryIn, 800, 'day 2 receives the 800 carried in');
  eq(led.days[1].fromCarry, 300, 'day 2 expense taken from the carried balance');
  eq(led.days[1].fromToday, 0, 'nothing deducted from day 2 income');
  eq(led.days[1].balance, 1000, 'day 2 closing balance = 1000');
}

console.log('\nCase 2: an expense larger than the carried balance');
{
  const rows = [
    makeRow({ date: '2026-10-01', income: 100, expenses: 0 }),
    makeRow({ date: '2026-10-02', income: 200, expenses: 350, notes: 'خصم كبير' })
  ];
  const { api } = run(rows);
  const led = api.carryLedger(api.profitRowEntries(api.allProfitRows()));
  eq(led.days[1].carryIn, 100, 'carried balance available = 100');
  eq(led.days[1].fromCarry, 100, 'only 100 consumed from the carried balance');
  eq(led.days[1].fromToday, 250, 'the remaining 250 is deducted from today income');
  eq(led.days[1].net, -150, 'day 2 net = -150 (not double counted)');
  eq(led.days[1].balance, -50, 'day 2 closing balance = -50');
}

console.log('\nCase 3: selecting a single day');
{
  const rows = [
    makeRow({ date: '2026-10-01', income: 100, expenses: 0 }),
    makeRow({ date: '2026-10-02', income: 200, expenses: 350 })
  ];
  const { api, totals } = run(rows, { from: '2026-10-02', to: '2026-10-02' });
  const report = api.carryReport(
    api.profitRowEntries(api.allProfitRows()),
    api.profitRowEntries(api.filteredProfitRows())
  );
  eq(report.dayCount, 1, 'exactly one day selected');
  eq(report.totalIncome, 200, 'income of the selected day only = 200');
  eq(report.totalExpenses, 350, 'expenses of the selected day only = 350');
  eq(report.net, -150, 'net of the selected day = -150');
  eq(report.carriedIn, 100, 'carried-in from the previous day = 100');
  eq(report.remaining, -50, 'remaining after deductions = -50');
  eq(totals.profitTotalIncome, fmt(200), 'UI total income reflects the filter');
  eq(totals.profitTotalCarried, fmt(100), 'UI carried balance reflects the filter');
  eq(totals.profitTotalRemaining, fmt(-50), 'UI remaining balance reflects the filter');
}

console.log('\nCase 4: selecting a period (no double counting)');
{
  const rows = [
    makeRow({ date: '2026-10-01', income: 1000, expenses: 0 }),
    makeRow({ date: '2026-10-02', income: 500, expenses: 200 }),
    makeRow({ date: '2026-10-03', income: 300, expenses: 100 }),
    makeRow({ date: '2026-10-04', income: 999, expenses: 0 })
  ];
  const { api, totals } = run(rows, { from: '2026-10-02', to: '2026-10-03' });
  const report = api.carryReport(
    api.profitRowEntries(api.allProfitRows()),
    api.profitRowEntries(api.filteredProfitRows())
  );
  eq(report.dayCount, 2, 'two days inside the period');
  eq(report.carriedIn, 1000, 'carried-in = closing balance of 2026-10-01');
  eq(report.totalIncome, 800, 'period income = 800');
  eq(report.totalExpenses, 300, 'period expenses = 300');
  eq(report.net, 500, 'period net = 500');
  eq(report.remaining, 1500, 'remaining = 1000 + 500');
  eq(totals.profitTotalNet, fmt(500), 'UI net matches the period');
  eq(
    api.filteredProfitRows().length,
    2,
    'the day outside the period stays filtered out'
  );
}

console.log('\nCase 5: editing an entry (income raised)');
{
  const rows = [
    makeRow({ date: '2026-10-01', income: 100, expenses: 0 }),
    makeRow({ date: '2026-10-02', income: 200, expenses: 350 })
  ];
  const before = run(rows);
  const beforeLedger = before.api.carryLedger(
    before.api.profitRowEntries(before.api.allProfitRows())
  );
  eq(beforeLedger.days[1].balance, -50, 'balance before the edit = -50');

  // Simulate the user editing the first entry: income 100 -> 500
  rows[0] = makeRow({ date: '2026-10-01', income: 500, expenses: 0 });
  const after = run(rows);
  const afterLedger = after.api.carryLedger(
    after.api.profitRowEntries(after.api.allProfitRows())
  );
  eq(afterLedger.days[1].carryIn, 500, 'carry-in updated to the edited 500');
  eq(afterLedger.days[1].fromCarry, 350, 'the whole expense is now covered by carry');
  eq(afterLedger.days[1].fromToday, 0, 'nothing deducted from today income');
  eq(afterLedger.days[1].balance, 350, 'balance after the edit = 350');
  eq(after.totals.profitTotalRemaining, fmt(350), 'UI remaining updated after edit');
  eq(after.totals.profitTotalIncome, fmt(700), 'UI total income updated after edit');
}

console.log('\nCase 6: deleting an entry');
{
  const rows = [
    makeRow({ date: '2026-10-01', income: 400, expenses: 100 }),
    makeRow({ date: '2026-10-02', income: 100, expenses: 0 }),
    makeRow({ date: '2026-10-03', income: 50, expenses: 0 })
  ];
  const before = run(rows);
  const beforeReport = before.api.carryReport(
    before.api.profitRowEntries(before.api.allProfitRows()),
    before.api.profitRowEntries(before.api.filteredProfitRows())
  );
  eq(beforeReport.remaining, 450, 'remaining before the delete = 450');

  rows.splice(1, 1); // delete the 2026-10-02 entry
  const after = run(rows);
  const afterReport = after.api.carryReport(
    after.api.profitRowEntries(after.api.allProfitRows()),
    after.api.profitRowEntries(after.api.filteredProfitRows())
  );
  eq(afterReport.totalIncome, 450, 'income after the delete = 450');
  eq(afterReport.remaining, 350, 'remaining after the delete = 350');
  eq(after.totals.profitTotalRemaining, fmt(350), 'UI remaining updated after delete');
  eq(after.api.filteredProfitRows().length, 2, 'the deleted row is gone from the table');
}

console.log('\nCase 7: unrelated days do not leak into the totals');
{
  const rows = [makeRow({ date: '2026-10-05', income: 900, expenses: 400 })];
  const { api } = run(rows, { q: 'غير موجود' });
  const report = api.carryReport(
    api.profitRowEntries(api.allProfitRows()),
    api.profitRowEntries(api.filteredProfitRows())
  );
  eq(report.totalIncome, 0, 'filtered-out rows contribute nothing to income');
  eq(report.totalExpenses, 0, 'filtered-out rows contribute nothing to expenses');
  eq(report.carriedIn, 0, 'no carried balance for an empty selection');
}

console.log('\nCase 8: printed A4 report totals');
{
  const rows = [
    makeRow({ date: '2026-10-01', income: 1000, expenses: 0 }),
    makeRow({ date: '2026-10-02', income: 500, expenses: 1200, notes: 'خصم كبير' })
  ];
  const { api, totals, handler } = run(rows, { from: '2026-10-02', to: '2026-10-02' });
  ok(!!handler, 'the print button has a handler');
  printedHtml = '';
  printCalls = 0;
  handler();

  const expected = [
    ['إجمالي الدخل', fmt(500)],
    ['إجمالي المصروفات', fmt(1200)],
    ['صافي الأرباح', fmt(-700)],
    ['الرصيد المُرحّل من الأيام السابقة', fmt(1000)],
    ['الرصيد المتبقي بعد الخصومات', fmt(300)]
  ];
  for (const [label, value] of expected) {
    ok(printedHtml.includes(label), `printed report shows «${label}»`);
    ok(
      printedHtml.includes(value),
      `printed «${label}» = ${value}`,
      printedHtml.slice(0, 0)
    );
  }
  ok(printedHtml.includes('dir="rtl"'), 'printed report is RTL');
  ok(printedHtml.includes('print-filters'), 'printed report keeps the selected filters');
  ok(printedHtml.includes('2026-10-02'), 'printed report keeps the movements table');
  ok(printedHtml.includes('print-note'), 'printed report explains the carry deduction');
  eq(printCalls, 1, 'window.print() called once');
  eq(totals.profitTotalRemaining, fmt(300), 'printed remaining matches the UI');
}

/* ---------- 4. Result ---------- */

if (failures.length) {
  console.error(`\nFAILED (${failures.length}):`);
  for (const f of failures) console.error('  \u2718 ' + f);
  process.exit(1);
}
console.log('\nAll carried-balance and printed-totals checks passed.');
