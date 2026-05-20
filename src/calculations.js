export function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return min;
  }
  return Math.min(Math.max(number, min), max);
}

export function calculateLoanPayment(input) {
  const principal = Number(input.principal);
  const annualRatePercent = Number(input.annualRatePercent);
  const totalYears = Number(input.totalYears);
  const graceYears = Number(input.graceYears);

  if (!Number.isFinite(principal) || principal <= 0) {
    return { ok: false, error: "invalid_principal" };
  }
  if (!Number.isFinite(annualRatePercent) || annualRatePercent < 0) {
    return { ok: false, error: "invalid_rate" };
  }
  if (!Number.isFinite(totalYears) || totalYears <= 0) {
    return { ok: false, error: "invalid_term" };
  }
  if (!Number.isFinite(graceYears) || graceYears < 0) {
    return { ok: false, error: "invalid_grace" };
  }
  if (graceYears >= totalYears) {
    return { ok: false, error: "grace_exceeds_term" };
  }

  const totalMonths = Math.round(totalYears * 12);
  const graceMonths = Math.round(graceYears * 12);
  const repaymentMonths = totalMonths - graceMonths;
  const monthlyRate = annualRatePercent / 100 / 12;
  const graceMonthlyPayment = principal * monthlyRate;

  let repaymentMonthlyPayment;
  if (monthlyRate === 0) {
    repaymentMonthlyPayment = principal / repaymentMonths;
  } else {
    const factor = Math.pow(1 + monthlyRate, repaymentMonths);
    repaymentMonthlyPayment = principal * monthlyRate * factor / (factor - 1);
  }

  const totalPayment = graceMonthlyPayment * graceMonths + repaymentMonthlyPayment * repaymentMonths;
  const totalInterest = totalPayment - principal;

  return {
    ok: true,
    principal,
    annualRatePercent,
    totalYears,
    graceYears,
    totalMonths,
    graceMonths,
    repaymentMonths,
    graceMonthlyPayment,
    repaymentMonthlyPayment,
    totalInterest,
    totalPayment
  };
}

export function calculateReturnRate(startPrice, endPrice) {
  const start = Number(startPrice);
  const end = Number(endPrice);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0) {
    return null;
  }
  return ((end - start) / start) * 100;
}
