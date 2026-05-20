import test from "node:test";
import assert from "node:assert/strict";
import { calculateLoanPayment, calculateReturnRate } from "../src/calculations.js";

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

test("calculates return rate", () => {
  assert.equal(calculateReturnRate(100, 125), 25);
  assert.equal(calculateReturnRate(100, 75), -25);
  assert.equal(calculateReturnRate(0, 75), null);
});
