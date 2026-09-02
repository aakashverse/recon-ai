/**
 * The Circuit Breaker (Node.js Math Engine)
 * - Zero-Trust Rule: Never trust LLM math or external unverified calculations.
 * - Enforces absolute deterministic equality:
 *   Gross Invoice Amount - (TDS Deductions + Bank Charges + Discounts + GST Rounding) === Bank Received Amount
 */
export function validateCircuitBreaker(invoice, bankAmount, deductions = {}, splitInvoices = []) {
  const startTime = performance.now();

  let invoiceGross = Number(invoice?.totalAmount || 0);
  if (Array.isArray(invoice) && invoice.length >= 2) {
    invoiceGross = invoice.reduce((sum, i) => sum + Number(i.amount || i.totalAmount || 0), 0);
  } else if (splitInvoices && splitInvoices.length >= 2) {
    invoiceGross = splitInvoices.reduce((sum, i) => sum + Number(i.amount || i.totalAmount || 0), 0);
  }

  const tdsAmount = Number(deductions.tdsAmount || 0);
  const bankCharges = Number(deductions.bankCharges || 0);
  const discount = Number(deductions.discount || 0);
  const gstRounding = Number(deductions.gstRounding || 0);
  const receivedAmount = Number(bankAmount || 0);

  const deductionsTotal = Number((tdsAmount + bankCharges + discount + gstRounding).toFixed(2));
  const expectedNet = Number((invoiceGross - deductionsTotal).toFixed(2));
  const difference = Number((receivedAmount - expectedNet).toFixed(2));

  const durationMs = performance.now() - startTime;

  // Exact precision check (tolerance within 0.05 paise)
  if (Math.abs(difference) <= 0.05) {
    const equation = `₹${invoiceGross.toLocaleString('en-IN')} (Gross) - ₹${deductionsTotal.toLocaleString('en-IN')} (Deductions) = ₹${expectedNet.toLocaleString('en-IN')} (Expected) ≡ ₹${receivedAmount.toLocaleString('en-IN')} (Bank) [EXACT MATCH]`;
    return {
      passed: true,
      difference: 0,
      equation,
      invoiceGross,
      deductionsTotal,
      bankReceived: receivedAmount,
      durationMs,
      status: 'CIRCUIT_BREAKER_PASSED',
    };
  }

  const equation = `₹${invoiceGross.toLocaleString('en-IN')} (Gross) - ₹${deductionsTotal.toLocaleString('en-IN')} (Deductions) = ₹${expectedNet.toLocaleString('en-IN')} (Expected) ≠ ₹${receivedAmount.toLocaleString('en-IN')} (Bank) [DISCREPANCY: ${difference > 0 ? '+' : ''}₹${difference.toLocaleString('en-IN')}]`;
  return {
    passed: false,
    difference,
    equation,
    invoiceGross,
    deductionsTotal,
    bankReceived: receivedAmount,
    durationMs,
    status: 'CIRCUIT_BREAKER_DISCREPANCY',
    reason: `Discrepancy of ₹${Math.abs(difference).toLocaleString('en-IN')}: Expected ₹${expectedNet.toLocaleString('en-IN')} ≠ Bank Received ₹${receivedAmount.toLocaleString('en-IN')}`,
  };
}
