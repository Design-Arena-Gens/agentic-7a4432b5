// Local storage and data model
const STORAGE_KEY = 'aiacct_data_v1';

const DataStore = {
  state: null,
  load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    this.state = raw ? JSON.parse(raw) : null;
    return this.state;
  },
  save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
  },
  initDefault(firm, pinHash, securityQuestions) {
    this.state = {
      firm,
      pinHash,
      securityQuestions, // [{q, aHash}]
      accounts: defaultAccounts(),
      journals: [],
      inventory: [],
      invoices: [],
      counters: { invoice: 1 },
      createdAt: new Date().toISOString(),
    };
    this.save();
  },
};

function defaultAccounts() {
  return [
    { name: 'Cash', type: 'Asset' },
    { name: 'Bank', type: 'Asset' },
    { name: 'Accounts Receivable', type: 'Asset' },
    { name: 'Inventory', type: 'Asset' },
    { name: 'Input GST', type: 'Asset' },

    { name: 'Accounts Payable', type: 'Liability' },
    { name: 'Output GST', type: 'Liability' },

    { name: 'Capital', type: 'Equity' },
    { name: 'Retained Earnings', type: 'Equity' },

    { name: 'Sales', type: 'Income' },
    { name: 'Other Income', type: 'Income' },

    { name: 'Purchases', type: 'Expense' },
    { name: 'COGS', type: 'Expense' },
    { name: 'Rent Expense', type: 'Expense' },
    { name: 'Salary Expense', type: 'Expense' },
    { name: 'Electricity Expense', type: 'Expense' },
    { name: 'Misc Expense', type: 'Expense' },
  ];
}
