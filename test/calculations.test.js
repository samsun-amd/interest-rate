import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateLoanPayment,
  calculateLoanSchedule,
  calculateReturnRate,
  derivePeriodMonthlyRate,
  simulateStockLoanRepayment,
  simulateStockHold,
  simulateDollarCostAverage
} from "../src/calculations.js";

test("calculates zero-rate loan with grace period", () => {
  const result = calculateLoanPayment({
    principal: 120000,
    annualRatePercent: 0,
    totalYears: 2,
    graceYears: 1
  });

  assert.equal(result.ok, true);
  assert.equal(result.graceMonthlyPayment, 0);
  assert.equal(result.repaymentMonthlyPayment, 10000);
  assert.equal(result.totalPayment, 120000);
  assert.equal(result.totalInterest, 0);
});

test("rejects grace period that reaches term", () => {
  const result = calculateLoanPayment({
    principal: 120000,
    annualRatePercent: 2,
    totalYears: 2,
    graceYears: 2
  });

  assert.deepEqual(result, { ok: false, error: "grace_exceeds_term" });
});

test("allows zero grace period and builds remaining debt schedule", () => {
  const loan = calculateLoanPayment({
    principal: 120000,
    annualRatePercent: 0,
    totalYears: 1,
    graceYears: 0
  });
  const schedule = calculateLoanSchedule(loan);

  assert.equal(loan.ok, true);
  assert.equal(loan.graceMonths, 0);
  assert.equal(schedule.ok, true);
  assert.equal(schedule.rows.length, 12);
  assert.equal(schedule.rows[0].remainingDebt, 110000);
  assert.equal(schedule.rows[0].remainingPrincipal, 110000);
  assert.equal(schedule.rows[11].remainingDebt, 0);
  assert.equal(schedule.rows[11].remainingPrincipal, 0);
});

test("remaining debt includes scheduled future interest", () => {
  const loan = calculateLoanPayment({
    principal: 120000,
    annualRatePercent: 12,
    totalYears: 1,
    graceYears: 0
  });
  const schedule = calculateLoanSchedule(loan);

  assert.equal(schedule.ok, true);
  assert.ok(schedule.rows[0].remainingDebt > schedule.rows[0].remainingPrincipal);
  assert.ok(Math.abs(schedule.rows[0].remainingDebt - (loan.totalPayment - loan.repaymentMonthlyPayment)) < 1e-6);
  assert.equal(schedule.rows[11].remainingDebt, 0);
});

test("calculates return rate", () => {
  assert.equal(calculateReturnRate(100, 125), 25);
  assert.equal(calculateReturnRate(100, 75), -25);
  assert.equal(calculateReturnRate(0, 75), null);
});

test("derives geometric monthly rate from a period return", () => {
  const exactPercent = (Math.pow(1.01, 12) - 1) * 100;
  const monthlyRate = derivePeriodMonthlyRate(exactPercent, 12);
  assert.ok(Math.abs(monthlyRate - 0.01) < 1e-12);
  assert.equal(derivePeriodMonthlyRate(0, 12), 0);
  assert.equal(derivePeriodMonthlyRate(-100, 12), -1);
  assert.equal(derivePeriodMonthlyRate("bad", 12), null);
});

test("simulates repayment without shortfall when monthly growth covers payment", () => {
  const result = simulateStockLoanRepayment({
    buyAmount: 1_000_000,
    startPrice: 100,
    monthlyRate: 0.02,
    totalMonths: 4,
    graceMonths: 1,
    graceMonthlyPayment: 2000,
    repaymentMonthlyPayment: 10000,
    startDate: new Date(2025, 0, 15)
  });

  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 4);
  assert.equal(result.rows[0].stage, "grace");
  assert.equal(result.rows[1].stage, "repayment");
  assert.equal(result.rows[0].label, "2025-01");
  assert.equal(result.rows[3].label, "2025-04");
  assert.equal(result.insufficient, false);
  assert.equal(result.totalShortfall, 0);
  assert.ok(result.finalValue > 0);
  assert.equal(Number.isInteger(result.initialShares), true);
  result.rows.forEach((row) => {
    assert.equal(Number.isInteger(row.soldShares), true);
    assert.equal(Number.isInteger(row.remainingShares), true);
  });
});

test("flags insufficient simulation when stock cannot cover payment", () => {
  const result = simulateStockLoanRepayment({
    buyAmount: 1000,
    startPrice: 100,
    monthlyRate: -0.5,
    totalMonths: 6,
    graceMonths: 0,
    graceMonthlyPayment: 0,
    repaymentMonthlyPayment: 500,
    startDate: new Date(2025, 0, 1)
  });

  assert.equal(result.ok, true);
  assert.equal(result.insufficient, true);
  assert.ok(result.insufficientMonthIndex !== null);
  assert.ok(result.totalShortfall > 0);
});

test("supports foreign-currency stock with fx conversion and integer shares", () => {
  const result = simulateStockLoanRepayment({
    buyAmount: 1_000_000,
    startPrice: 200,
    monthlyRate: 0,
    totalMonths: 3,
    graceMonths: 0,
    graceMonthlyPayment: 0,
    repaymentMonthlyPayment: 100_000,
    startDate: new Date(2025, 0, 1),
    fxRate: 32
  });

  assert.equal(result.ok, true);
  assert.equal(result.fxRate, 32);
  assert.equal(result.initialShares, Math.floor(1_000_000 / 32 / 200));
  result.rows.forEach((row) => {
    assert.equal(Number.isInteger(row.soldShares), true);
    assert.equal(Number.isInteger(row.remainingShares), true);
  });
});

test("repayment end value tracks stock value separately from cash", () => {
  const result = simulateStockLoanRepayment({
    buyAmount: 1000,
    startPrice: 300,
    monthlyRate: 0,
    totalMonths: 2,
    graceMonths: 0,
    graceMonthlyPayment: 0,
    repaymentMonthlyPayment: 200,
    startDate: new Date(2025, 0, 1),
    fxRate: 1
  });

  assert.equal(result.ok, true);
  assert.equal(result.rows[0].soldShares, 1);
  assert.equal(result.rows[0].cashAtMonthEnd, 200);
  assert.equal(result.rows[0].endValue, result.rows[0].sharesValueTwd);
  assert.equal(result.rows[0].endAssetValue, result.rows[0].sharesValueTwd + result.rows[0].cashAtMonthEnd);
  assert.ok(result.rows[0].endAssetValue > result.rows[0].endValue);
});

test("rejects buy amount that cannot purchase one share", () => {
  const result = simulateStockLoanRepayment({
    buyAmount: 100,
    startPrice: 200,
    monthlyRate: 0,
    totalMonths: 12,
    graceMonths: 0,
    graceMonthlyPayment: 0,
    repaymentMonthlyPayment: 1,
    startDate: new Date(2025, 0, 1),
    fxRate: 32
  });
  assert.deepEqual(result, { ok: false, error: "buy_amount_too_small" });
});

test("simulates pure stock hold with integer shares and cumulative growth", () => {
  const monthlyRate = 0.01;
  const loanSchedule = calculateLoanSchedule({
    principal: 1_000_000,
    annualRatePercent: 0,
    totalYears: 1,
    graceYears: 0
  });
  const result = simulateStockHold({
    buyAmount: 1_000_000,
    startPrice: 100,
    monthlyRate,
    totalMonths: 6,
    startDate: new Date(2025, 0, 1),
    loanScheduleRows: loanSchedule.rows
  });

  assert.equal(result.ok, true);
  assert.equal(Number.isInteger(result.initialShares), true);
  assert.equal(result.rows.length, 6);

  const expectedCumulative = (n) => {
    const sharesValue = result.initialShares * 100 * Math.pow(1 + monthlyRate, n + 1) * 1;
    const total = sharesValue + result.initialCash;
    return ((total - result.buyAmount) / result.buyAmount) * 100;
  };

  result.rows.forEach((row, n) => {
    assert.ok(Math.abs(row.cumulativeReturnPercent - expectedCumulative(n)) < 1e-6);
    assert.equal(row.remainingDebt, loanSchedule.rows[n].remainingDebt);
  });
});

test("simulateStockHold honours fx conversion", () => {
  const result = simulateStockHold({
    buyAmount: 1_000_000,
    startPrice: 200,
    monthlyRate: 0,
    totalMonths: 3,
    startDate: new Date(2025, 0, 1),
    fxRate: 32
  });
  assert.equal(result.ok, true);
  assert.equal(result.initialShares, Math.floor(1_000_000 / 32 / 200));
  assert.equal(result.finalShares, result.initialShares);
});

test("rejects invalid simulation inputs", () => {
  assert.deepEqual(
    simulateStockLoanRepayment({
      buyAmount: 0,
      startPrice: 100,
      monthlyRate: 0.01,
      totalMonths: 12,
      graceMonths: 0,
      graceMonthlyPayment: 0,
      repaymentMonthlyPayment: 100
    }),
    { ok: false, error: "invalid_buy_amount" }
  );
});

test("simulates dollar-cost averaging with integer monthly purchases", () => {
  const result = simulateDollarCostAverage({
    monthlyAmount: 10_000,
    startPrice: 300,
    monthlyRate: 0.01,
    totalMonths: 3,
    startDate: new Date(2025, 0, 1),
    fxRate: 30
  });

  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 3);
  result.rows.forEach((row) => {
    assert.equal(Number.isInteger(row.boughtShares), true);
    assert.equal(Number.isInteger(row.totalShares), true);
    assert.ok(row.cashAtMonthEnd >= 0);
  });
  assert.equal(result.cumulativeInvested, 30_000);
});

test("rejects invalid dollar-cost averaging inputs", () => {
  assert.deepEqual(
    simulateDollarCostAverage({
      monthlyAmount: 0,
      startPrice: 100,
      monthlyRate: 0.01,
      totalMonths: 12
    }),
    { ok: false, error: "invalid_monthly_amount" }
  );
});

test("dollar-cost averaging handles a total loss monthly rate without fractional shares", () => {
  const result = simulateDollarCostAverage({
    monthlyAmount: 10_000,
    startPrice: 100,
    monthlyRate: -1,
    totalMonths: 3
  });

  assert.equal(result.ok, true);
  assert.equal(result.rows[1].boughtShares, 0);
  assert.equal(Number.isFinite(result.finalValue), true);
});
