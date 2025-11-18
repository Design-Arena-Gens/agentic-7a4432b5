'use strict';

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

const App = {
  charts: { trend: null, expense: null },
  async init() {
    $('#year').textContent = new Date().getFullYear();
    const state = DataStore.load();
    this.bindGlobalNav();
    if (!state) { this.showOnboarding(); } else { this.showLogin(); }
  },
  bindGlobalNav() {
    $('#logoutBtn')?.addEventListener('click', ()=>{ sessionStorage.removeItem('logged'); location.reload(); });
    $('#topNav').addEventListener('click', (e)=>{
      if (e.target.matches('button[data-route]')) this.route(e.target.getAttribute('data-route'));
    });
    window.addEventListener('hashchange', ()=> this.route(location.hash||'#dashboard'));
  },
  showOnboarding() {
    $('#authSection').hidden = false; $('#onboarding').hidden = false; $('#login').hidden = true;
    $('#registerForm').addEventListener('submit', async (e)=>{
      e.preventDefault();
      const fd = new FormData(e.target);
      if (fd.get('pin') !== fd.get('pin2')) { alert('PIN mismatch'); return; }
      const pinHash = await Utils.sha256(fd.get('pin'));
      const firm = {
        orgName: fd.get('orgName'),
        contactPerson: fd.get('contactPerson'),
        taxId: fd.get('taxId'),
        gstin: fd.get('gstin'),
        gstEnabled: fd.get('gstEnabled'),
        defaultGstPercent: Number(fd.get('defaultGstPercent')||0),
        bankName: fd.get('bankName'),
        bankAccount: fd.get('bankAccount'),
        ifsc: fd.get('ifsc'),
        openingCapital: Number(fd.get('openingCapital')||0),
      };
      const securityQuestions = [1,2,3].map(i=>({ q: fd.get('q'+i), aHash: '' }));
      securityQuestions[0].aHash = await Utils.sha256(fd.get('a1'));
      securityQuestions[1].aHash = await Utils.sha256(fd.get('a2'));
      securityQuestions[2].aHash = await Utils.sha256(fd.get('a3'));
      DataStore.initDefault(firm, pinHash, securityQuestions);
      // Seed opening capital
      if (firm.openingCapital > 0) {
        Accounting.post({ date: Utils.todayISO(), debit: 'Cash', credit: 'Capital', amount: firm.openingCapital, narration: 'Opening Capital' });
      }
      alert('Registration successful. Please login.');
      location.reload();
    });
  },
  showLogin() {
    $('#authSection').hidden = false; $('#login').hidden = false; $('#onboarding').hidden = true;
    $('#topNav').hidden = true;
    $('#loginForm').addEventListener('submit', async (e)=>{
      e.preventDefault(); const pin = new FormData(e.target).get('pin');
      const ok = (await Utils.sha256(pin)) === DataStore.state.pinHash;
      if (!ok) { alert('Invalid PIN'); return; }
      sessionStorage.setItem('logged', '1');
      this.launchApp();
    });
    $('#forgotPinBtn').addEventListener('click', ()=> this.showResetPin());
  },
  async showResetPin() {
    const form = $('#resetForm'); form.innerHTML='';
    DataStore.state.securityQuestions.forEach((qa,i)=>{
      const div = document.createElement('div');
      div.innerHTML = `<label>${qa.q}</label><input name="qa${i}" placeholder="Answer" />`;
      form.appendChild(div);
    });
    const btn = document.createElement('button'); btn.className='primary mt-md'; btn.textContent='Verify & Reset'; form.appendChild(btn);
    $('#resetPin').hidden = false;
    form.onsubmit = async (e)=>{
      e.preventDefault();
      const answers = DataStore.state.securityQuestions.map((qa,i)=> $('#resetForm input[name="qa'+i+'"]').value);
      for (let i=0;i<answers.length;i++) {
        const aHash = await Utils.sha256(answers[i]);
        if (aHash !== DataStore.state.securityQuestions[i].aHash) { alert('Incorrect answer'); return; }
      }
      const newPin = prompt('Enter new 4-digit PIN');
      if (!newPin || !/^\d{4}$/.test(newPin)) { alert('Invalid PIN'); return; }
      DataStore.state.pinHash = await Utils.sha256(newPin); DataStore.save(); alert('PIN reset successful');
    };
  },
  launchApp() {
    $('#authSection').hidden = true; $('#topNav').hidden = false;
    this.route(location.hash || '#dashboard');
    this.initJournal();
    this.initInventory();
    this.initInvoicing();
    this.initSettings();
    this.refreshAll();
  },
  route(hash) {
    const route = hash.replace('#','');
    for (const sec of ['dashboard','journal','inventory','invoicing','reports','settings']) $('#'+sec).hidden = true;
    const show = $('#'+route); if (show) { show.hidden = false; }
    if (route==='dashboard') this.renderDashboard();
    if (route==='reports') this.renderReports();
  },
  refreshAll() {
    this.renderDashboard();
    this.renderJournals();
    this.renderInventory();
    this.renderInvoices();
    this.renderReports();
  },

  // Dashboard
  renderDashboard() {
    const pl = Accounting.pl();
    $('#mSales').textContent = Utils.formatINR(pl.sales);
    $('#mRevenue').textContent = Utils.formatINR(pl.sales + pl.otherIncome);
    const tax = Accounting.taxSummary();
    $('#mTax').textContent = Utils.formatINR(Math.max(0, tax.due));
    $('#mExpenses').textContent = Utils.formatINR(pl.expenses);
    $('#mPurchases').textContent = Utils.formatINR(pl.purchases);
    $('#mInventory').textContent = Utils.formatINR(Accounting.inventoryValuation());
    $('#mCapital').textContent = Utils.formatINR(Number(DataStore.state.firm.openingCapital||0) + pl.net);

    const ms = Accounting.monthSeries();
    const labels = ms.keys;
    const sales = labels.map(k=> ms.byMonth[k].sales);
    const purchases = labels.map(k=> ms.byMonth[k].purchases);
    const expenses = labels.map(k=> ms.byMonth[k].expenses);

    const trendCtx = $('#trendChart');
    if (this.charts.trend) this.charts.trend.destroy();
    this.charts.trend = new Chart(trendCtx, { type: 'line', data: { labels, datasets: [
      { label: 'Sales', data: sales, borderColor: '#7ba3ff', tension: .3 },
      { label: 'Purchases', data: purchases, borderColor: '#27c3a3', tension: .3 },
      { label: 'Expenses', data: expenses, borderColor: '#ff9db2', tension: .3 },
    ]}, options: { plugins: { legend: { labels: { color: '#c9d2e2' } } }, scales: { x: { ticks: { color:'#9aa3b2' } }, y: { ticks: { color:'#9aa3b2' } } } } });

    // expense breakdown by account
    const bal = Accounting.ledgerBalances();
    const expenseAccounts = DataStore.state.accounts.filter(a=> a.type==='Expense');
    const eLabels = expenseAccounts.map(a=> a.name);
    const eData = expenseAccounts.map(a=> Math.max(0, bal.get(a.name)||0));
    const expCtx = $('#expenseChart');
    if (this.charts.expense) this.charts.expense.destroy();
    this.charts.expense = new Chart(expCtx, { type: 'doughnut', data: { labels: eLabels, datasets: [{ data: eData, backgroundColor: ['#7ba3ff','#27c3a3','#ff9db2','#ffd37b','#a37bff','#7bffd3'] }] }, options: { plugins:{ legend: { labels:{ color:'#c9d2e2' } } } } });
  },

  // Journal
  initJournal() {
    const f = $('#journalForm');
    f.date.value = Utils.todayISO();
    $('#aiSuggestBtn').addEventListener('click', ()=>{
      const firm = DataStore.state.firm;
      const suggestion = AIParser.parse({ narration: f.narration.value, amount: Number(f.amount.value||0), qty: Number(f.qty.value||0), price: Number(f.price.value||0), gstPercent: Number(firm.defaultGstPercent||0), firm });
      if (suggestion.split) {
        f.debit.value = suggestion.split[0].debit; f.credit.value = suggestion.split[0].credit; f.amount.value = suggestion.split[0].amount.toFixed(2);
      } else {
        f.debit.value = suggestion.debit; f.credit.value = suggestion.credit; f.amount.value = (suggestion.amount||0).toFixed(2);
      }
    });
    f.addEventListener('submit', (e)=>{
      e.preventDefault();
      const fd = new FormData(f);
      const date = fd.get('date'); const amount = Number(fd.get('amount')); const debit = fd.get('debit'); const credit = fd.get('credit');
      const narration = fd.get('narration');
      const qty = Number(fd.get('qty')||0), price = Number(fd.get('price')||0);

      // If narration suggests split (GST), post two entries
      const firm = DataStore.state.firm;
      const suggestion = AIParser.parse({ narration, amount, qty, price, gstPercent: Number(firm.defaultGstPercent||0), firm });
      if (suggestion.split) {
        suggestion.split.forEach(s => Accounting.post({ date, debit: s.debit, credit: s.credit, amount: s.amount, narration, meta: { source:'ai', qty, price } }));
      } else {
        Accounting.post({ date, debit, credit, amount, narration, meta: { source: 'manual', qty, price } });
      }

      // inventory adjustment heuristics
      if (/sale|sold|????|bikri/i.test(narration) && qty>0) {
        const item = DataStore.state.inventory[0]; // simplistic: first item
        if (item) item.quantity = Number(item.quantity||0) - qty;
      }
      if (/purchase|bought|buy|????|kharid/i.test(narration) && qty>0) {
        const item = DataStore.state.inventory[0];
        if (item) item.quantity = Number(item.quantity||0) + qty;
      }

      DataStore.save();
      f.reset(); f.date.value = Utils.todayISO();
      App.renderJournals(); App.renderDashboard(); App.renderReports(); App.renderInventory();
    });
  },
  renderJournals() {
    const tb = $('#journalTable tbody'); tb.innerHTML='';
    for (const j of Accounting.listJournals(50)) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${j.date}</td><td>${j.debit}</td><td>${j.credit}</td><td>${Utils.formatINR(j.amount)}</td><td>${j.narration||''}</td>`;
      tb.appendChild(tr);
    }
  },

  // Inventory
  initInventory() {
    const f = $('#inventoryForm');
    f.addEventListener('submit', (e)=>{
      e.preventDefault(); const fd = new FormData(f);
      const name = fd.get('name');
      const existing = DataStore.state.inventory.find(x=>x.name===name);
      const item = existing || { id: Utils.uid('it'), name };
      item.supplier = fd.get('supplier')||'';
      item.invoice = fd.get('invoice')||'';
      item.hsn = fd.get('hsn')||'';
      item.gstPercent = Number(fd.get('gstPercent')||0);
      item.purchaseCost = Number(fd.get('purchaseCost')||0);
      item.salesPrice = Number(fd.get('salesPrice')||0);
      item.quantity = Number(fd.get('quantity')||0);
      if (!existing) DataStore.state.inventory.push(item);
      DataStore.save();
      App.renderInventory();
      f.reset();
    });
  },
  renderInventory() {
    const tb = $('#inventoryTable tbody'); tb.innerHTML='';
    for (const it of DataStore.state.inventory) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><span class="badge">${it.name}</span></td><td>${it.quantity||0}</td><td>${Utils.formatINR(it.purchaseCost||0)}</td><td>${Utils.formatINR(it.salesPrice||0)}</td><td>${it.gstPercent||0}%</td><td>${it.hsn||''}</td>`;
      tb.appendChild(tr);
    }
  },

  // Invoicing
  initInvoicing() {
    $('#addInvoiceItem').addEventListener('click', ()=>{
      const tbody = $('#invoiceItems tbody');
      const tr = document.createElement('tr');
      const items = DataStore.state.inventory.map(it=>it.name);
      tr.innerHTML = `
        <td>
          <select class="inv-item">
            ${items.map(n=>`<option value="${n}">${n}</option>`).join('')}
          </select>
        </td>
        <td><input type="number" class="inv-qty" value="1" step="0.01" /></td>
        <td><input type="number" class="inv-price" step="0.01" /></td>
        <td><input type="number" class="inv-gst" step="0.1" /></td>
        <td class="inv-amt">?0</td>
        <td><button type="button" class="remove">?</button></td>
      `;
      tbody.appendChild(tr);
      const sel = $('.inv-item', tr);
      const qty = $('.inv-qty', tr); const price = $('.inv-price', tr); const gst = $('.inv-gst', tr);
      const recalc = ()=>{
        const it = DataStore.state.inventory.find(x=>x.name===sel.value);
        if (price.value==='' && it) price.value = it.salesPrice||0;
        if (gst.value==='' && it) gst.value = (it.gstPercent ?? DataStore.state.firm.defaultGstPercent) || 0;
        const q = Number(qty.value||0), p = Number(price.value||0), g = Number(gst.value||0);
        const amount = q * p * (1 + g/100);
        $('.inv-amt', tr).textContent = Utils.formatINR(amount);
      };
      sel.onchange = recalc; qty.oninput = recalc; price.oninput = recalc; gst.oninput = recalc; recalc();
      $('.remove', tr).onclick = ()=>{ tr.remove(); };
    });

    $('#invoiceForm').addEventListener('submit', (e)=>{
      e.preventDefault();
      const f = e.target; const fd = new FormData(f);
      const items = [];
      $$('#invoiceItems tbody tr').forEach(tr=>{
        const name = $('.inv-item', tr).value;
        const qty = Number($('.inv-qty', tr).value||0);
        const price = Number($('.inv-price', tr).value||0);
        const gst = Number($('.inv-gst', tr).value||0);
        items.push({ name, qty, price, gst });
      });
      const autoNo = 'INV-' + String(DataStore.state.counters.invoice++).padStart(4,'0');
      const inv = {
        id: Utils.uid('inv'),
        invoiceNo: fd.get('invoiceNo') || autoNo,
        customer: fd.get('customer'),
        date: fd.get('date'),
        notes: fd.get('notes')||'',
        items,
      };
      // Totals and accounting postings
      let totalBase = 0, totalGst = 0, total = 0;
      for (const it of items) { const base = it.qty * it.price; const gst = base * (it.gst/100); totalBase += base; totalGst += gst; total += base + gst; }
      inv.totalBase = totalBase; inv.totalGst = totalGst; inv.total = total;
      DataStore.state.invoices.unshift(inv);

      // Post accounting entries: Accounts Receivable/Bank debit, Sales and Output GST credit
      const recv = 'Accounts Receivable' + (inv.customer? ' - '+inv.customer : '');
      Accounting.post({ date: inv.date, debit: recv, credit: 'Sales', amount: totalBase, narration: 'Invoice '+inv.invoiceNo, meta: { source:'invoice' } });
      if (totalGst>0) Accounting.post({ date: inv.date, debit: recv, credit: 'Output GST', amount: totalGst, narration: 'GST on '+inv.invoiceNo, meta: { source:'invoice' } });

      // Reduce inventory quantity (simple)
      for (const it of items) {
        const invItem = DataStore.state.inventory.find(x=>x.name===it.name);
        if (invItem) invItem.quantity = Number(invItem.quantity||0) - it.qty;
      }

      DataStore.save();
      this.renderInvoices(); this.renderDashboard(); this.renderReports(); this.renderInventory();
      alert('Invoice saved.');
      f.reset(); $('#invoiceItems tbody').innerHTML='';
    });

    $('#generatePdfBtn').addEventListener('click', ()=>{
      if (!DataStore.state.invoices[0]) { alert('No invoices yet. Save one first.'); return; }
      this.generateInvoicePdf(DataStore.state.invoices[0]);
    });
  },
  renderInvoices() {
    const tb = $('#invoicesTable tbody'); tb.innerHTML='';
    for (const inv of DataStore.state.invoices) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${inv.invoiceNo}</td><td>${inv.date}</td><td>${inv.customer}</td><td>${Utils.formatINR(inv.total||0)}</td><td>${Utils.formatINR(inv.totalGst||0)}</td><td><button data-id="${inv.id}" class="pdf">PDF</button></td>`;
      tb.appendChild(tr);
    }
    tb.onclick = (e)=>{
      if (e.target.matches('button.pdf')) {
        const inv = DataStore.state.invoices.find(x=>x.id===e.target.dataset.id);
        if (inv) this.generateInvoicePdf(inv);
      }
    };
  },
  generateInvoicePdf(inv) {
    const { jsPDF } = window.jspdf; const doc = new jsPDF();
    const firm = DataStore.state.firm;
    doc.setFontSize(16); doc.text(firm.orgName || 'Firm', 14, 16);
    doc.setFontSize(10); doc.text(`GSTIN: ${firm.gstin||'-'}`, 14, 22);
    doc.text(`Invoice: ${inv.invoiceNo}`, 150, 16); doc.text(`Date: ${inv.date}`, 150, 22);
    doc.text(`Bill To: ${inv.customer}`, 14, 30);
    // table header
    let y = 40; doc.text('Item',14,y); doc.text('Qty',100,y); doc.text('Price',120,y); doc.text('GST%',150,y); doc.text('Amount',175,y); y+=6; doc.line(14,y,195,y);
    for (const it of inv.items) {
      const base = it.qty * it.price; const gst = base*(it.gst/100); const amt = base + gst;
      y+=6; doc.text(String(it.name),14,y); doc.text(String(it.qty),100,y); doc.text(String(it.price),120,y); doc.text(String(it.gst),150,y); doc.text(String(amt.toFixed(2)),175,y);
    }
    y+=10; doc.line(14,y,195,y);
    y+=6; doc.text(`Subtotal: ?${inv.totalBase.toFixed(2)}`,150,y);
    y+=6; doc.text(`GST: ?${inv.totalGst.toFixed(2)}`,150,y);
    y+=6; doc.setFontSize(12); doc.text(`Total: ?${inv.total.toFixed(2)}`,150,y);
    const blob = doc.output('blob'); Utils.downloadBlob(`${inv.invoiceNo}.pdf`, blob);
  },

  // Reports
  renderReports() {
    // Trial Balance
    const tb = $('#trialBalance tbody'); tb.innerHTML='';
    let tDebit=0, tCredit=0;
    for (const row of Accounting.trialBalance()) {
      tDebit += row.debit; tCredit += row.credit;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${row.account}</td><td>${row.debit? Utils.formatINR(row.debit): ''}</td><td>${row.credit? Utils.formatINR(row.credit): ''}</td>`;
      tb.appendChild(tr);
    }
    const trt = document.createElement('tr'); trt.innerHTML = `<td><b>Total</b></td><td><b>${Utils.formatINR(tDebit)}</b></td><td><b>${Utils.formatINR(tCredit)}</b></td>`; tb.appendChild(trt);

    // P&L
    const pl = Accounting.pl();
    const plb = $('#plReport tbody'); plb.innerHTML='';
    const add = (k,v)=>{ const tr=document.createElement('tr'); tr.innerHTML = `<td>${k}</td><td>${Utils.formatINR(v)}</td>`; plb.appendChild(tr); };
    add('Sales', pl.sales); add('Other Income', pl.otherIncome); add('COGS/Purchases', pl.cogs||pl.purchases); add('Expenses', pl.expenses); add('Net Profit', pl.net);

    // Balance Sheet
    const bs = Accounting.balanceSheet();
    const bsb = $('#bsReport tbody'); bsb.innerHTML='';
    const addb = (k,v)=>{ const tr=document.createElement('tr'); tr.innerHTML = `<td>${k}</td><td>${Utils.formatINR(v)}</td>`; bsb.appendChild(tr); };
    addb('Assets (incl. Inventory)', bs.assets); addb('Liabilities', bs.liabilities); addb('Equity', bs.equity); addb('Check (should be 0)', bs.check);

    // GST
    const gst = Accounting.taxSummary();
    const gstb = $('#gstReport tbody'); gstb.innerHTML='';
    const addg = (k,v)=>{ const tr=document.createElement('tr'); tr.innerHTML = `<td>${k}</td><td>${Utils.formatINR(v)}</td>`; gstb.appendChild(tr); };
    addg('Output GST', gst.outputGST); addg('Input GST', gst.inputGST); addg('GST Due', Math.max(0, gst.due));
  },

  // Settings
  initSettings() {
    const f = $('#settingsForm');
    const setVals = ()=>{
      const firm = DataStore.state.firm; if (!firm) return;
      f.orgName.value = firm.orgName||''; f.gstin.value = firm.gstin||''; f.gstEnabled.value = firm.gstEnabled||'no'; f.defaultGstPercent.value = firm.defaultGstPercent||0; f.bankName.value = firm.bankName||''; f.bankAccount.value = firm.bankAccount||''; f.ifsc.value = firm.ifsc||'';
    };
    setVals();
    f.addEventListener('submit', (e)=>{ e.preventDefault(); const fd = new FormData(f); const firm = DataStore.state.firm;
      firm.orgName = fd.get('orgName'); firm.gstin = fd.get('gstin'); firm.gstEnabled = fd.get('gstEnabled'); firm.defaultGstPercent = Number(fd.get('defaultGstPercent')||0); firm.bankName = fd.get('bankName'); firm.bankAccount = fd.get('bankAccount'); firm.ifsc = fd.get('ifsc'); DataStore.save(); alert('Saved');
    });
  },
};

window.addEventListener('DOMContentLoaded', ()=> App.init());
