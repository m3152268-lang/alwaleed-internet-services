
/**
 * Regression check for daily-profit totals.
 * Executes the real functions extracted from index.html.
 * No Supabase connection or browser is required.
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

/* 1. Extract the real totals code */

const start = html.indexOf('const parseAmount=');
const endAnchor = html.indexOf("\n['dashCustomerSearch'");

if (start < 0 || endAnchor < 0 || endAnchor <= start) {
  console.error('FAIL: could not locate profit-totals code in index.html');
  process.exit(1);
}

const source = html.slice(start, endAnchor);

for (const fn of [
  'parseAmount',
  'rowMoney',
  'filteredProfitRows',
  'applyProfitFilters'
]) {
  ok(source.includes(fn), `index.html still defines ${fn}()`);
}

ok(
  !/Number\(r\.cells\[1\]\.textContent\.replace/.test(html) &&
  !/Number\(r\.cells\[2\]\.textContent\.replace/.test(html),
  'Totals no longer use the broken currency-text parsing regex'
);

/* 2. Minimal DOM shim */

const fmt = (v) =>
  Number(v || 0).toLocaleString('en-US', {
    maximumFractionDigits: 2
  }) + ' ج.م';

function makeRow({
  date,
  income,
  expenses,
  notes = '',
  withData = true
}) {
  const cell = (textContent) => ({
    textContent,
    hidden: false
  });

  return {
    dataset: withData
      ? {
          date: String(date).slice(0, 10),
          income: String(income),
          expenses: String(expenses)
        }
      : {},

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

function runCase(rows, filter = {}) {
  const totals = {
    profitTotalIncome: '',
    profitTotalExpenses: '',
    profitTotalNet: ''
  };

  const inputs = {
    profitFilterFrom: { value: filter.from || '' },
    profitFilterTo: { value: filter.to || '' },
    profitFilterText: { value: filter.q || '' },
    profitFilterType: { value: filter.type || 'all' }
  };

  const body = {
    querySelectorAll: (sel) => sel === 'tr' ? rows : []
  };

  const doc = {
    querySelectorAll: (sel) =>
      sel === '#profitHistoryBody tr' ? rows : []
  };

  const $ = (id) => {
    if (id in totals) {
      return {
        set textContent(v) {
          totals[id] = v;
        },
        get textContent() {
          return totals[id];
        }
      };
    }

    if (id in inputs) return inputs[id];
    if (id === 'profitHistoryBody') return body;

    return null;
  };

  const canvasChart = () => {};

  const factory = new Function(
    'document',
    '$',
    'fmt',
    'canvasChart',
    `${source}
      return { filteredProfitRows, applyProfitFilters };
    `
  );

  const api = factory(doc, $, fmt, canvasChart);

  api.applyProfitFilters();

  return {
    totals,
    visible: api.filteredProfitRows().length,
    rows
  };
}

/* 3. Test cases */

console.log('\nCase 1: Amount >= 1000');

{
  const { totals } = runCase([
    makeRow({
      date: '2026-10-01',
      income: 1250.5,
      expenses: 300
    })
  ]);

  ok(
    totals.profitTotalIncome === fmt(1250.5),
    'Total income = 1,250.5',
    totals.profitTotalIncome
  );

  ok(
    totals.profitTotalExpenses === fmt(300),
    'Total expenses = 300',
    totals.profitTotalExpenses
  );

  ok(
    totals.profitTotalNet === fmt(950.5),
    'Net profit = 950.5',
    totals.profitTotalNet
  );
}

console.log('\nCase 2: Expenses subtract from income');

{
  const rows = [
    makeRow({
      date: '2026-10-02',
      income: 5000,
      expenses: 0
    }),
    makeRow({
      date: '2026-10-02',
      income: 0,
      expenses: 1750.25,
      notes: 'خصم'
    }),
    makeRow({
      date: '2026-10-03',
      income: 250,
      expenses: 0
    })
  ];

  const { totals } = runCase(rows);

  ok(
    totals.profitTotalIncome === fmt(5250),
    'Total income = 5,250',
    totals.profitTotalIncome
  );

  ok(
    totals.profitTotalExpenses === fmt(1750.25),
    'Total expenses = 1,750.25',
    totals.profitTotalExpenses
  );

  ok(
    totals.profitTotalNet === fmt(3499.75),
    'Net profit = 3,499.75',
    totals.profitTotalNet
  );
}

console.log('\nCase 3: Totals follow active filters');

{
  const rows = [
    makeRow({
      date: '2026-10-02',
      income: 3000,
      expenses: 0
    }),
    makeRow({
      date: '2026-10-05',
      income: 0,
      expenses: 1200,
      notes: 'مصروف شبكة'
    })
  ];

  const { totals, visible } = runCase(rows, {
    type: 'expense'
  });

  ok(
    visible === 1,
    'Expense filter displays one entry',
    String(visible)
  );

  ok(
    totals.profitTotalExpenses === fmt(1200),
    'Filtered expenses = 1,200',
    totals.profitTotalExpenses
  );

  ok(
    totals.profitTotalNet === fmt(-1200),
    'Filtered net = -1,200',
    totals.profitTotalNet
  );

  const byText = runCase(rows, {
    q: 'شبكة'
  });

  ok(
    byText.totals.profitTotalExpenses === fmt(1200),
    'Search in notes works',
    byText.totals.profitTotalExpenses
  );
}

console.log('\nCase 4: Fallback parsing without data-*');

{
  const rows = [
    makeRow({
      date: '2026-10-07',
      income: 2500.75,
      expenses: 0,
      withData: false
    })
  ];

  const { totals } = runCase(rows);

  ok(
    totals.profitTotalIncome === fmt(2500.75),
    '2,500.75 currency text is parsed correctly',
    totals.profitTotalIncome
  );
}

console.log('\nCase 5: Empty state does not break totals');

{
  const empty = {
    dataset: {},
    cells: [
      { textContent: 'لا توجد سجلات بعد.' }
    ],
    hidden: false
  };

  const { totals, visible } = runCase([empty]);

  ok(
    visible === 0,
    'Empty-state row is excluded',
    String(visible)
  );

  ok(
    totals.profitTotalIncome === fmt(0) &&
    totals.profitTotalNet === fmt(0),
    'Totals equal zero',
    totals.profitTotalIncome
  );
}

/* 4. Final result */

if (failures.length) {
  console.error(`\nFAILED (${failures.length}):`);

  failures.forEach((f) => {
    console.error('  ✘ ' + f);
  });

  process.exit(1);
}

console.log('\nAll profit-totals regression checks passed.');
