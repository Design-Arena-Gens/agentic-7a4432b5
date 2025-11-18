// Simple AI parser for English/Hinglish/Hindi narrations
// Heuristic mapping to debit/credit and GST split
const AIParser = {
  parse({ narration, amount, qty, price, gstPercent, firm }) {
    const text = (narration||'').toLowerCase();
    const totalAmount = Number(amount || (qty && price ? qty*price : 0)) || 0;
    const gstP = (firm.gstEnabled === 'yes') ? Number(gstPercent || firm.defaultGstPercent || 0) : 0;

    // party detection: 'to A', 'from B', 'A ko', 'B se'
    const partyMatch = narration?.match(/(?:to|from)\s+([A-Za-z0-9 &.-]+)/i) || narration?.match(/([A-Za-z0-9 &.-]+)\s+(?:ko|se)/i);
    const party = partyMatch ? partyMatch[1].trim() : '';

    // classify
    const isSale = /(sold|sale|????|bikri)/i.test(narration);
    const isPurchase = /(purchase|purchased|bought|buy|????|kharid)/i.test(narration);
    const isExpense = /(rent|salary|electric|electricity|fuel|transport|travel|expense|kharcha|kiraya|????|??????)/i.test(narration);
    const isCash = /(cash| ??? )/i.test(narration);
    const isBank = /(bank|upi|neft|rtgs|imps)/i.test(narration);
    const isCredit = /(credit|udhar|????)/i.test(narration);

    const debitCredit = { debit: '', credit: '', amount: totalAmount, narration };

    if (isSale) {
      const base = gstP ? (totalAmount / (1 + gstP/100)) : totalAmount;
      const tax = totalAmount - base;
      const recv = isCash ? 'Cash' : (isBank ? 'Bank' : ('Accounts Receivable' + (party? ' - '+party: '')));
      debitCredit.debit = recv;
      debitCredit.credit = 'Sales';
      debitCredit.split = gstP ? [{ debit: recv, credit: 'Sales', amount: base }, { debit: recv, credit: 'Output GST', amount: tax }] : null;
      return debitCredit;
    }

    if (isPurchase) {
      const base = gstP ? (totalAmount / (1 + gstP/100)) : totalAmount;
      const tax = totalAmount - base;
      const pay = isCash ? 'Cash' : (isBank ? 'Bank' : ('Accounts Payable' + (party? ' - '+party: '')));
      debitCredit.debit = 'Purchases';
      debitCredit.credit = pay;
      debitCredit.split = gstP ? [{ debit: 'Purchases', credit: pay, amount: base }, { debit: 'Input GST', credit: pay, amount: tax }] : null;
      return debitCredit;
    }

    if (isExpense) {
      // map some categories
      let expense = 'Misc Expense';
      if (/rent|kiraya|??????/i.test(narration)) expense = 'Rent Expense';
      else if (/salary|????/i.test(narration)) expense = 'Salary Expense';
      else if (/electric|bijli|?????/i.test(narration)) expense = 'Electricity Expense';
      const pay = isCash ? 'Cash' : (isBank ? 'Bank' : 'Accounts Payable');
      debitCredit.debit = expense; debitCredit.credit = pay; return debitCredit;
    }

    // fallback: if 'goods sold to A' without keywords
    if (/goods.*to/i.test(text)) {
      const recv = 'Accounts Receivable' + (party? ' - '+party: '');
      debitCredit.debit = recv; debitCredit.credit = 'Sales'; return debitCredit;
    }
    if (/goods.*from|received.*from/i.test(text)) {
      const pay = 'Accounts Payable' + (party? ' - '+party: '');
      debitCredit.debit = 'Purchases'; debitCredit.credit = pay; return debitCredit;
    }

    // default guess: cash sale
    debitCredit.debit = isCash? 'Cash' : 'Bank';
    debitCredit.credit = 'Sales';
    return debitCredit;
  }
};
