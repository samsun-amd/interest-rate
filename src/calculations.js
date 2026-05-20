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

export function derivePeriodMonthlyRate(periodReturnPercent, periodMonths) {
  const totalReturn = Number(periodReturnPercent);
  const months = Number(periodMonths);
  if (!Number.isFinite(totalReturn) || !Number.isFinite(months) || months <= 0) {
    return null;
  }
  const growth = 1 + totalReturn / 100;
  if (growth <= 0) {
    return -1;
  }
  return Math.pow(growth, 1 / months) - 1;
}

export function simulateStockHold(input) {
  const buyAmount = Number(input.buyAmount);
  const startPrice = Number(input.startPrice);
  const monthlyRate = Number(input.monthlyRate);
  const totalMonths = Math.round(Number(input.totalMonths));
  const startDate = input.startDate instanceof Date ? input.startDate : new Date();
  const fxRate = Number(input.fxRate ?? 1);

  if (!Number.isFinite(buyAmount) || buyAmount <= 0) {
    return { ok: false, error: "invalid_buy_amount" };
  }
  if (!Number.isFinite(startPrice) || startPrice <= 0) {
    return { ok: false, error: "invalid_start_price" };
  }
  if (!Number.isFinite(monthlyRate)) {
    return { ok: false, error: "invalid_monthly_rate" };
  }
  if (!Number.isFinite(totalMonths) || totalMonths <= 0) {
    return { ok: false, error: "invalid_term" };
  }
  if (!Number.isFinite(fxRate) || fxRate <= 0) {
    return { ok: false, error: "invalid_fx_rate" };
  }

  const buyAmountInCurrency = buyAmount / fxRate;
  const initialShares = Math.floor(buyAmountInCurrency / startPrice);
  if (initialShares <= 0) {
    return { ok: false, error: "buy_amount_too_small" };
  }
  const initialInvested = initialShares * startPrice * fxRate;
  const initialCash = buyAmount - initialInvested;

  const rows = [];
  let priceAtMonthStart = startPrice;
  const baseYear = startDate.getFullYear();
  const baseMonth = startDate.getMonth();

  for (let index = 0; index < totalMonths; index += 1) {
    const calendar = new Date(baseYear, baseMonth + index, 1);
    const year = calendar.getFullYear();
    const month = calendar.getMonth() + 1;
    const label = `${year}-${String(month).padStart(2, "0")}`;

    let priceAtMonthEnd = priceAtMonthStart * (1 + monthlyRate);
    if (!Number.isFinite(priceAtMonthEnd) || priceAtMonthEnd < 0) {
      priceAtMonthEnd = 0;
    }

    const sharesValueTwd = initialShares * priceAtMonthEnd * fxRate;
    const totalValueTwd = sharesValueTwd + initialCash;
    const cumulativeReturnPercent = ((totalValueTwd - buyAmount) / buyAmount) * 100;
    const monthReturnPercent = monthlyRate * 100;

    rows.push({
      index,
      year,
      month,
      label,
      startPrice: priceAtMonthStart,
      startPriceTwd: priceAtMonthStart * fxRate,
      endPrice: priceAtMonthEnd,
      endPriceTwd: priceAtMonthEnd * fxRate,
      sharesValueTwd,
      cash: initialCash,
      totalValueTwd,
      monthReturnPercent,
      cumulativeReturnPercent
    });

    priceAtMonthStart = priceAtMonthEnd;
  }

  const finalRow = rows[rows.length - 1];
  const finalValue = finalRow ? finalRow.totalValueTwd : buyAmount;
  const totalReturnPercent = ((finalValue - buyAmount) / buyAmount) * 100;

  return {
    ok: true,
    buyAmount,
    fxRate,
    startPrice,
    monthlyRate,
    monthlyRatePercent: monthlyRate * 100,
    totalMonths,
    initialShares,
    initialCash,
    initialInvested,
    finalShares: initialShares,
    finalValue,
    totalReturnPercent,
    rows
  };
}

export function simulateStockLoanRepayment(input) {
  const buyAmount = Number(input.buyAmount);
  const startPrice = Number(input.startPrice);
  const monthlyRate = Number(input.monthlyRate);
  const totalMonths = Math.round(Number(input.totalMonths));
  const graceMonths = Math.round(Number(input.graceMonths));
  const graceMonthlyPayment = Number(input.graceMonthlyPayment);
  const repaymentMonthlyPayment = Number(input.repaymentMonthlyPayment);
  const startDate = input.startDate instanceof Date ? input.startDate : new Date();
  const fxRate = Number(input.fxRate ?? 1);

  if (!Number.isFinite(buyAmount) || buyAmount <= 0) {
    return { ok: false, error: "invalid_buy_amount" };
  }
  if (!Number.isFinite(startPrice) || startPrice <= 0) {
    return { ok: false, error: "invalid_start_price" };
  }
  if (!Number.isFinite(monthlyRate)) {
    return { ok: false, error: "invalid_monthly_rate" };
  }
  if (!Number.isFinite(totalMonths) || totalMonths <= 0) {
    return { ok: false, error: "invalid_term" };
  }
  if (!Number.isFinite(graceMonths) || graceMonths < 0 || graceMonths >= totalMonths) {
    return { ok: false, error: "invalid_grace" };
  }
  if (!Number.isFinite(fxRate) || fxRate <= 0) {
    return { ok: false, error: "invalid_fx_rate" };
  }

  const buyAmountInCurrency = buyAmount / fxRate;
  const initialShares = Math.floor(buyAmountInCurrency / startPrice);
  if (initialShares <= 0) {
    return { ok: false, error: "buy_amount_too_small" };
  }
  const initialInvested = initialShares * startPrice * fxRate;
  const initialCash = buyAmount - initialInvested;
  const rows = [];

  let shares = initialShares;
  let cash = initialCash;
  let priceAtMonthStart = startPrice;
  let insufficient = false;
  let insufficientMonthIndex = null;
  let totalPaid = 0;
  let totalShortfall = 0;
  let totalSoldShares = 0;

  const baseYear = startDate.getFullYear();
  const baseMonth = startDate.getMonth();

  for (let index = 0; index < totalMonths; index += 1) {
    const stage = index < graceMonths ? "grace" : "repayment";
    const payment = stage === "grace" ? graceMonthlyPayment : repaymentMonthlyPayment;
    const calendar = new Date(baseYear, baseMonth + index, 1);
    const year = calendar.getFullYear();
    const month = calendar.getMonth() + 1;
    const label = `${year}-${String(month).padStart(2, "0")}`;

    const cashAtMonthStart = cash;
    let soldShares = 0;
    let proceedsTwd = 0;
    let paymentCovered = 0;
    let shortfall = 0;
    let priceAtMonthEnd = priceAtMonthStart;

    if (payment > 0) {
      const needFromStockTwd = Math.max(0, payment - cash);
      let sharesNeeded = 0;
      if (needFromStockTwd > 0 && shares > 0) {
        const needFromStockCurrency = needFromStockTwd / fxRate;
        sharesNeeded = Math.ceil(needFromStockCurrency / priceAtMonthStart);
      }
      const actualSold = Math.min(sharesNeeded, shares);
      soldShares = actualSold;
      proceedsTwd = actualSold * priceAtMonthStart * fxRate;
      const cashAfterSale = cash + proceedsTwd;
      if (cashAfterSale + 1e-9 >= payment) {
        paymentCovered = payment;
        cash = cashAfterSale - payment;
      } else {
        paymentCovered = cashAfterSale;
        shortfall = payment - cashAfterSale;
        cash = 0;
        if (!insufficient) {
          insufficient = true;
          insufficientMonthIndex = index;
        }
      }
      shares -= actualSold;
    }

    priceAtMonthEnd = priceAtMonthStart * (1 + monthlyRate);
    if (!Number.isFinite(priceAtMonthEnd) || priceAtMonthEnd < 0) {
      priceAtMonthEnd = 0;
    }

    totalPaid += paymentCovered;
    totalShortfall += shortfall;
    totalSoldShares += soldShares;

    const sharesValueTwd = shares * priceAtMonthEnd * fxRate;
    const endValue = sharesValueTwd + cash;
    rows.push({
      index,
      year,
      month,
      label,
      stage,
      payment,
      paymentCovered,
      shortfall,
      startPrice: priceAtMonthStart,
      startPriceTwd: priceAtMonthStart * fxRate,
      endPrice: priceAtMonthEnd,
      endPriceTwd: priceAtMonthEnd * fxRate,
      soldShares,
      proceedsTwd,
      cashAtMonthStart,
      cashAtMonthEnd: cash,
      remainingShares: shares,
      sharesValueTwd,
      endValue
    });

    priceAtMonthStart = priceAtMonthEnd;
  }

  const finalRow = rows[rows.length - 1];
  const finalShares = finalRow ? finalRow.remainingShares : 0;
  const finalValue = finalRow ? finalRow.endValue : 0;
  const finalCash = finalRow ? finalRow.cashAtMonthEnd : 0;
  const finalSharesValue = finalRow ? finalRow.sharesValueTwd : 0;
  const totalReturnPercent = ((finalValue - buyAmount) / buyAmount) * 100;
  const netReturnPercent = ((finalValue - buyAmount - totalShortfall) / buyAmount) * 100;

  return {
    ok: true,
    buyAmount,
    fxRate,
    startPrice,
    monthlyRate,
    monthlyRatePercent: monthlyRate * 100,
    totalMonths,
    graceMonths,
    initialShares,
    initialCash,
    initialInvested,
    totalSoldShares,
    finalShares,
    finalCash,
    finalSharesValue,
    finalValue,
    totalPaid,
    totalShortfall,
    insufficient,
    insufficientMonthIndex,
    totalReturnPercent,
    netReturnPercent,
    rows
  };
}
