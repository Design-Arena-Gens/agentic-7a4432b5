// Core accounting engine: post journals, ledgers, reports
const Accounting = {
  ensureAccount(name, typeGuess='Expense') {
    const a = DataStore.state.accounts.find(x => x.name === name);
    if (a) return a;
    const type = this.guessType(name) || typeGuess;
    const created = { name, type };
    DataStore.state.accounts.push(created);
    return created;
  },
  guessType(name){
    const n = name.toLowerCase();
    if (n.includes('cash') || n.includes('bank') || n.includes('receivable') || n.includes('inventory') || n.includes('input gst')) return 'Asset';
    if (n.includes('payable') || n.includes('output gst') || n.includes('loan')) return 'Liability';
    if (n.includes('capital') || n.includes('equity')) return 'Equity';
    if (n.includes('sale') || n.includes('revenue')) return 'Income';
    return 'Expense';
  },
  post({ date, debit, credit, amount, narration, meta }) {
    if (!date || !debit || !credit || !amount) throw new Error('Missing fields');
    this.ensureAccount(debit);
    this.ensureAccount(credit);
    DataStore.state.journals.unshift({ id: Utils.uid('j'), date, debit, credit, amount: Number(amount), narration: narration||'', meta: meta||{} });
    DataStore.save();
  },
  listJournals(limit=100) { return DataStore.state.journals.slice(0, limit); },
  ledgerBalances() {
    const bal = new Map();
    for (const acc of DataStore.state.accounts) bal.set(acc.name, 0);
    for (const j of DataStore.state.journals) {
      bal.set(j.debit, (bal.get(j.debit)||0) + j.amount);
      bal.set(j.credit, (bal.get(j.credit)||0) - j.amount);
    }
    return bal;
  },
  trialBalance() {
    const bal = this.ledgerBalances();
    const rows = [];
    for (const acc of DataStore.state.accounts) {
      const v = bal.get(acc.name)||0;
      rows.push({ account: acc.name, debit: v>0? v: 0, credit: v<0? -v: 0 });
    }
    return rows;
  },
  accountType(name) {
    const acc = DataStore.state.accounts.find(a => a.name === name);
    return acc ? acc.type : this.guessType(name);
  },
  pl() {
    const bal = this.ledgerBalances();
    let sales = 0, otherIncome = 0, cogs = 0, purchases = 0, expenses = 0;
    for (const [name, v] of bal.entries()) {
      const t = this.accountType(name);
      const s = v; // debit positive, credit negative
      if (t === 'Income') { if (name.toLowerCase().includes('sale')) sales -= s; else otherIncome -= s; }
      if (name === 'COGS') cogs += s; if (name === 'Purchases') purchases += s;
      if (t === 'Expense' && name !== 'COGS' && name !== 'Purchases') expenses += s;
    }
    const gross = sales - (cogs || purchases);
    const net = gross + otherIncome - expenses;
    return { sales, otherIncome, cogs, purchases, expenses, gross, net };
  },
  inventoryValuation() {
    // simple: sum of quantity * purchaseCost for items
    const inv = DataStore.state.inventory;
    return inv.reduce((sum, it) => sum + Number(it.quantity||0) * Number(it.purchaseCost||0), 0);
  },
  balanceSheet() {
    const bal = this.ledgerBalances();
    let assets = 0, liabilities = 0, equity = 0;
    for (const [name, v] of bal.entries()) {
      const t = this.accountType(name);
      if (t === 'Asset') assets += v;
      else if (t === 'Liability') liabilities -= v;
      else if (t === 'Equity') equity -= v;
    }
    assets += this.inventoryValuation();

    const pl = this.pl();
    const openingCapital = Number(DataStore.state.firm.openingCapital||0);
    const retained = pl.net;
    const capital = openingCapital + retained;

    return { assets, liabilities, equity: capital, check: assets - (liabilities + capital) };
  },
  monthSeries() {
    const byMonth = {};
    for (const j of DataStore.state.journals) {
      const m = Utils.monthKey(j.date);
      if (!byMonth[m]) byMonth[m] = { sales: 0, purchases: 0, expenses: 0 };
      if (j.credit.toLowerCase().includes('sales')) byMonth[m].sales += j.amount;
      if (j.debit.toLowerCase().includes('purchases')) byMonth[m].purchases += j.amount;
      const isExpense = this.accountType(j.debit) === 'Expense' || j.debit.toLowerCase().includes('expense');
      if (isExpense) byMonth[m].expenses += j.amount;
    }
    const keys = Object.keys(byMonth).sort();
    return { keys, byMonth };
  },
  taxSummary() {
    const bal = this.ledgerBalances();
    const inputGST = bal.get('Input GST')||0; // debit positive
    const outputGST = -(bal.get('Output GST')||0); // credit negative -> make positive
    return { inputGST, outputGST, due: outputGST - inputGST };
  },
};
