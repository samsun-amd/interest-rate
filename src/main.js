import {
  calculateLoanSchedule,
  calculateLoanPayment,
  clampNumber,
  derivePeriodMonthlyRate,
  simulateDollarCostAverage,
  simulateStockLoanRepayment,
  simulateStockHold
} from "./calculations.js";
import { copy } from "./i18n/zh-TW.js";
import { downloadWorkbook } from "./xlsx-export.js";

const defaultPrincipal = 5000000;

const state = {
  loan: {
    principal: defaultPrincipal,
    annualRatePercent: 2.15,
    totalYears: 7,
    graceYears: 1
  },
  stock: {
    query: "",
    periodMonths: 12,
    selected: null,
    results: [],
    searchStatus: "idle",
    returnStatus: "idle",
    returnData: null,
    error: null
  },
  simulation: {
    buyAmount: defaultPrincipal,
    selectedYear: null
  },
  dca: {
    monthlyAmount: 50000,
    selectedYear: null
  },
  exportStatus: "idle"
};

const formatCurrency = new Intl.NumberFormat("zh-TW", {
  style: "currency",
  currency: "TWD",
  maximumFractionDigits: 0
});

const formatInteger = new Intl.NumberFormat("zh-TW", {
  maximumFractionDigits: 0
});

const formatNumber = new Intl.NumberFormat("zh-TW", {
  maximumFractionDigits: 2
});

const formatPercent = new Intl.NumberFormat("zh-TW", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2
});

const formatPrice = new Intl.NumberFormat("zh-TW", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2
});

const formatShares = new Intl.NumberFormat("zh-TW", {
  maximumFractionDigits: 4,
  minimumFractionDigits: 2
});

const formatSharesInt = new Intl.NumberFormat("zh-TW", {
  maximumFractionDigits: 0
});

const formatPrice4 = new Intl.NumberFormat("zh-TW", {
  maximumFractionDigits: 4,
  minimumFractionDigits: 2
});

const formatFx = new Intl.NumberFormat("zh-TW", {
  maximumFractionDigits: 4,
  minimumFractionDigits: 4
});

let searchTimer = null;
let returnTimer = null;
let searchController = null;
let returnController = null;

const app = document.querySelector("#app");

document.title = copy.documentTitle;
render();
bindStaticEvents();
updateLoan();
updateStockSearchView();
updateReturnView();
updateSimulationView();
updateDcaView();

function render() {
  app.innerHTML = `
    <div class="page-shell">
      <div class="risk-banner">${copy.warning}</div>
      <header class="hero">
        <div class="hero-content">
          <div>
            <p class="eyebrow">Loan / Equity Return Tool</p>
            <h1>${copy.appTitle}</h1>
          </div>
          <button id="export-excel-button" type="button" class="export-button">${copy.exportButton}</button>
        </div>
      </header>

      <main class="workspace">
        <section class="tool-panel loan-panel" aria-labelledby="loan-title">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Loan Calculator</p>
              <h2 id="loan-title">${copy.loanTitle}</h2>
            </div>
          </div>

          <div class="tool-grid">
            <form class="control-stack" id="loan-form">
              ${numberOnlyControl("principal", copy.principal, state.loan.principal, 1, "1", copy.twd)}
              ${rangeControl("annualRatePercent", copy.annualRate, state.loan.annualRatePercent, 0, 20, "0.01", copy.percent)}
              ${rangeControl("totalYears", copy.totalYears, state.loan.totalYears, 1, 10, "1", copy.years)}
              ${rangeControl("graceYears", copy.graceYears, state.loan.graceYears, 0, 5, "1", copy.years)}
            </form>

            <div class="result-grid" id="loan-results"></div>
          </div>
        </section>

        <section class="tool-panel stock-panel" aria-labelledby="stock-title">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Stock Return Calculator</p>
              <h2 id="stock-title">${copy.stockTitle}</h2>
            </div>
          </div>

          <div class="tool-grid">
            <div class="control-stack">
              <label class="field">
                <span>${copy.stockQuery}</span>
                <div class="search-row">
                  <input id="stock-query" type="search" autocomplete="off" placeholder="${copy.stockQueryPlaceholder}" />
                  <button id="stock-search-button" type="button">${copy.searchButton}</button>
                  <button id="stock-clear-button" type="button" class="icon-button" aria-label="${copy.clearButton}">×</button>
                </div>
              </label>

              ${rangeControl("periodMonths", copy.period, state.stock.periodMonths, 1, 240, "1", copy.months, "stock")}

              <div class="selected-stock">
                <span>${copy.selectedStock}</span>
                <strong id="selected-stock">${copy.noStockSelected}</strong>
              </div>

              <div id="search-results" class="search-results" aria-live="polite"></div>
            </div>

            <div class="stock-output" id="stock-return" aria-live="polite"></div>
          </div>
        </section>

        <section class="tool-panel simulation-panel" aria-labelledby="simulation-title">
          <div class="section-heading">
            <div>
              <p class="eyebrow">${copy.simulationEyebrow}</p>
              <h2 id="simulation-title">${copy.simulationTitle}</h2>
              <p class="section-description">${copy.simulationDescription}</p>
            </div>
          </div>

          <div class="tool-grid">
            <form class="control-stack" id="simulation-form">
              ${numberOnlyControl("buyAmount", copy.simulationBuyAmount, state.simulation.buyAmount, 1, "1", copy.twd, "simulation")}
            </form>

            <div class="result-grid" id="simulation-summary"></div>
          </div>

          <div class="simulation-detail" id="simulation-detail" aria-live="polite"></div>
        </section>

        <section class="tool-panel dca-panel" aria-labelledby="dca-title">
          <div class="section-heading">
            <div>
              <p class="eyebrow">${copy.dcaEyebrow}</p>
              <h2 id="dca-title">${copy.dcaTitle}</h2>
              <p class="section-description">${copy.dcaDescription}</p>
            </div>
          </div>

          <div class="tool-grid">
            <form class="control-stack" id="dca-form">
              ${numberOnlyControl("monthlyAmount", copy.dcaMonthlyAmount, state.dca.monthlyAmount, 1, "1", copy.twd, "dca")}
            </form>

            <div class="result-grid" id="dca-summary"></div>
          </div>

          <div class="simulation-detail" id="dca-detail" aria-live="polite"></div>
        </section>
      </main>
    </div>
  `;
}

function bindStaticEvents() {
  document.querySelectorAll("[data-loan-input]").forEach((input) => {
    input.addEventListener("input", handleLoanInput);
  });

  document.querySelectorAll("[data-loan-range]").forEach((input) => {
    input.addEventListener("input", handleLoanRange);
  });

  const periodInput = document.querySelector("[data-stock-input='periodMonths']");
  const periodRange = document.querySelector("[data-stock-range='periodMonths']");
  periodInput.addEventListener("input", handlePeriodInput);
  periodRange.addEventListener("input", handlePeriodRange);

  document.querySelector("#stock-query").addEventListener("input", handleSearchInput);
  document.querySelector("#stock-search-button").addEventListener("click", () => runStockSearch());
  document.querySelector("#stock-clear-button").addEventListener("click", clearStockSearch);

  document.querySelectorAll("[data-simulation-input]").forEach((input) => {
    input.addEventListener("input", handleSimulationInput);
  });

  document.querySelectorAll("[data-dca-input]").forEach((input) => {
    input.addEventListener("input", handleDcaInput);
  });

  document.querySelector("#export-excel-button").addEventListener("click", handleExportExcel);
}

function numberOnlyControl(name, label, value, min, step, suffix, scope = "loan") {
  const inputAttr = scope === "loan" ? "data-loan-input" : `data-${scope}-input`;
  return `
    <label class="field">
      <span>${label}</span>
      <div class="input-row">
        <input ${inputAttr}="${name}" type="text" inputmode="numeric" autocomplete="off" value="${formatPrincipalInput(value)}" />
        <em>${suffix}</em>
      </div>
    </label>
  `;
}

function rangeControl(name, label, value, min, max, step, suffix, scope = "loan") {
  const inputAttr = scope === "loan" ? "data-loan-input" : "data-stock-input";
  const rangeAttr = scope === "loan" ? "data-loan-range" : "data-stock-range";
  const maxAttr = name === "annualRatePercent" ? "" : `max="${max}"`;
  return `
    <label class="field range-field">
      <span>${label}</span>
      <div class="input-row">
        <input ${inputAttr}="${name}" type="number" min="${min}" ${maxAttr} step="${step}" value="${value}" />
        <em>${suffix}</em>
      </div>
      <input ${rangeAttr}="${name}" type="range" min="${min}" max="${max}" step="${step}" value="${clampNumber(value, min, max)}" />
    </label>
  `;
}

function handleLoanInput(event) {
  const name = event.target.dataset.loanInput;
  const value = name === "principal"
    ? parsePrincipalInput(event.target.value)
    : Number(event.target.value);
  state.loan[name] = value;

  if (name === "principal") {
    formatPrincipalInputElement(event.target);
  }

  const range = document.querySelector(`[data-loan-range='${name}']`);
  if (range) {
    range.value = clampNumber(value, Number(range.min), Number(range.max));
  }
  updateLoan();
  updateSimulationView();
  updateDcaView();
}

function handleLoanRange(event) {
  const name = event.target.dataset.loanRange;
  const value = Number(event.target.value);
  state.loan[name] = value;
  document.querySelector(`[data-loan-input='${name}']`).value = value;
  updateLoan();
  updateSimulationView();
  updateDcaView();
}

function parsePrincipalInput(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? Number(digits) : Number.NaN;
}

function formatPrincipalInput(value) {
  const number = Number(value);
  return Number.isFinite(number) ? formatInteger.format(Math.trunc(number)) : "";
}

function formatPrincipalInputElement(input) {
  const digitOffset = countDigits(input.value.slice(0, input.selectionStart || 0));
  const formatted = formatPrincipalInput(parsePrincipalInput(input.value));
  input.value = formatted;
  input.setSelectionRange(findCaretPosition(formatted, digitOffset), findCaretPosition(formatted, digitOffset));
}

function countDigits(value) {
  return (String(value).match(/\d/g) || []).length;
}

function findCaretPosition(value, digitOffset) {
  if (digitOffset <= 0) {
    return 0;
  }

  let seen = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (/\d/.test(value[index])) {
      seen += 1;
      if (seen === digitOffset) {
        return index + 1;
      }
    }
  }
  return value.length;
}

function updateLoan() {
  const result = calculateLoanPayment(state.loan);
  const container = document.querySelector("#loan-results");

  if (!result.ok) {
    container.innerHTML = `
      <div class="state-card warning-state">
        <strong>${loanErrorMessage(result.error)}</strong>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    ${metricCard(copy.graceMonthlyPayment, formatCurrency.format(result.graceMonthlyPayment))}
    ${metricCard(copy.repaymentMonthlyPayment, formatCurrency.format(result.repaymentMonthlyPayment), "primary")}
    ${metricCard(copy.totalInterest, formatCurrency.format(result.totalInterest))}
    ${metricCard(copy.totalPayment, formatCurrency.format(result.totalPayment))}
  `;
}

function loanErrorMessage(error) {
  const messages = {
    invalid_principal: copy.invalidPrincipal,
    invalid_rate: copy.invalidRate,
    invalid_term: copy.invalidTerm,
    invalid_grace: copy.invalidGrace,
    grace_exceeds_term: copy.graceExceedsTerm
  };
  return messages[error] || copy.apiError;
}

function metricCard(label, value, variant = "") {
  return `
    <article class="metric-card ${variant}">
      <span>${label}</span>
      <strong>${value}</strong>
    </article>
  `;
}

function handlePeriodInput(event) {
  const value = clampNumber(event.target.value, 1, 240);
  state.stock.periodMonths = value;
  document.querySelector("[data-stock-range='periodMonths']").value = value;
  scheduleReturnFetch();
}

function handlePeriodRange(event) {
  const value = Number(event.target.value);
  state.stock.periodMonths = value;
  document.querySelector("[data-stock-input='periodMonths']").value = value;
  scheduleReturnFetch();
}

function handleSearchInput(event) {
  state.stock.query = event.target.value.trim();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runStockSearch(), 300);
  updateStockSearchView();
}

function clearStockSearch() {
  state.stock.query = "";
  state.stock.results = [];
  state.stock.selected = null;
  state.stock.returnData = null;
  state.stock.searchStatus = "idle";
  state.stock.returnStatus = "idle";
  state.stock.error = null;
  document.querySelector("#stock-query").value = "";
  updateStockSearchView();
  updateReturnView();
  updateSimulationView();
  updateDcaView();
}

async function runStockSearch() {
  const query = state.stock.query.trim();
  if (!query) {
    state.stock.searchStatus = "idle";
    state.stock.results = [];
    updateStockSearchView();
    return;
  }

  if (searchController) {
    searchController.abort();
  }
  searchController = new AbortController();
  state.stock.searchStatus = "loading";
  state.stock.error = null;
  updateStockSearchView();

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
      signal: searchController.signal
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "search_failed");
    }
    state.stock.results = payload.results;
    state.stock.searchStatus = payload.results.length > 0 ? "ready" : "empty";
  } catch (error) {
    if (error.name === "AbortError") {
      return;
    }
    state.stock.searchStatus = "error";
    state.stock.error = error.message;
  } finally {
    updateStockSearchView();
  }
}

function updateStockSearchView() {
  const container = document.querySelector("#search-results");
  const selected = document.querySelector("#selected-stock");
  if (!container || !selected) {
    return;
  }

  selected.textContent = state.stock.selected
    ? `${state.stock.selected.name} · ${state.stock.selected.symbol}`
    : copy.noStockSelected;

  if (state.stock.searchStatus === "idle") {
    container.innerHTML = `<div class="state-card">${copy.searchIdle}</div>`;
    return;
  }
  if (state.stock.searchStatus === "loading") {
    container.innerHTML = `<div class="state-card">${copy.searching}</div>`;
    return;
  }
  if (state.stock.searchStatus === "error") {
    container.innerHTML = `<div class="state-card warning-state">${copy.networkError}</div>`;
    return;
  }
  if (state.stock.searchStatus === "empty") {
    container.innerHTML = `<div class="state-card">${copy.searchEmpty}</div>`;
    return;
  }

  container.innerHTML = state.stock.results.map((result, index) => `
    <button class="search-result" type="button" data-result-index="${index}">
      <strong>${escapeHtml(result.name)}</strong>
      <span>${escapeHtml(result.symbol)} · ${escapeHtml(result.code)} · ${escapeHtml(result.exchange)}</span>
    </button>
  `).join("");

  container.querySelectorAll("[data-result-index]").forEach((button) => {
    button.addEventListener("click", () => {
      state.stock.selected = state.stock.results[Number(button.dataset.resultIndex)];
      state.stock.returnData = null;
      state.stock.returnStatus = "loading";
      updateStockSearchView();
      updateReturnView();
      fetchStockReturn();
    });
  });
}

function scheduleReturnFetch() {
  if (!state.stock.selected) {
    updateReturnView();
    updateSimulationView();
    updateDcaView();
    return;
  }
  clearTimeout(returnTimer);
  state.stock.returnStatus = "loading";
  updateReturnView();
  returnTimer = setTimeout(() => fetchStockReturn(), 250);
}

async function fetchStockReturn() {
  if (!state.stock.selected) {
    state.stock.returnStatus = "idle";
    updateReturnView();
    return;
  }

  if (returnController) {
    returnController.abort();
  }
  returnController = new AbortController();
  state.stock.returnStatus = "loading";
  state.stock.error = null;
  updateReturnView();

  try {
    const params = new URLSearchParams({
      symbol: state.stock.selected.symbol,
      months: String(state.stock.periodMonths)
    });
    const response = await fetch(`/api/returns?${params.toString()}`, {
      signal: returnController.signal
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "returns_failed");
    }
    state.stock.returnData = payload;
    state.stock.returnStatus = "ready";
  } catch (error) {
    if (error.name === "AbortError") {
      return;
    }
    state.stock.returnStatus = error.message === "insufficient_data" ? "insufficient" : "error";
    state.stock.error = error.message;
  } finally {
    updateReturnView();
    updateDcaView();
  }
}

function updateReturnView() {
  const container = document.querySelector("#stock-return");
  if (!container) {
    return;
  }

  if (!state.stock.selected) {
    container.innerHTML = `<div class="state-card tall-state">${copy.chooseStock}</div>`;
    return;
  }
  if (state.stock.returnStatus === "loading") {
    container.innerHTML = `<div class="state-card tall-state">${copy.loadingReturn}</div>`;
    return;
  }
  if (state.stock.returnStatus === "insufficient") {
    container.innerHTML = `<div class="state-card warning-state tall-state">${copy.insufficientData}</div>`;
    return;
  }
  if (state.stock.returnStatus === "error") {
    container.innerHTML = `<div class="state-card warning-state tall-state">${copy.networkError}</div>`;
    return;
  }
  if (!state.stock.returnData) {
    container.innerHTML = `<div class="state-card tall-state">${copy.chooseStock}</div>`;
    return;
  }

  const data = state.stock.returnData;
  const direction = data.returnRate > 0 ? copy.positiveReturn : data.returnRate < 0 ? copy.negativeReturn : copy.flatReturn;
  const tone = data.returnRate > 0 ? "positive" : data.returnRate < 0 ? "negative" : "flat";

  container.innerHTML = `
    <div class="return-summary ${tone}">
      <span>${copy.returnRate}</span>
      <strong>${formatPercent.format(data.returnRate)}${copy.percent}</strong>
      <em>${direction}</em>
    </div>
    ${renderSparkline(data.series)}
    <div class="result-grid compact">
      ${metricCard(copy.startPrice, formatPrice.format(data.startPrice))}
      ${metricCard(copy.latestPrice, formatPrice.format(data.latestPrice))}
      ${metricCard(copy.startDate, data.startDate)}
      ${metricCard(copy.latestDate, data.latestDate)}
      ${metricCard(copy.period, `${formatNumber.format(data.months)} ${copy.months}`)}
      ${metricCard(copy.dataPoints, formatNumber.format(data.series.length))}
    </div>
    <p class="source-note">${copy.sourceNote}</p>
  `;
  updateSimulationView();
}

function renderSparkline(series) {
  if (!series || series.length < 2) {
    return "";
  }

  const width = 640;
  const height = 170;
  const padding = 10;
  const values = series.map((point) => point.price);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = series.map((point, index) => {
    const x = padding + (index / (series.length - 1)) * (width - padding * 2);
    const y = height - padding - ((point.price - min) / span) * (height - padding * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");

  return `
    <svg class="sparkline" viewBox="0 0 ${width} ${height}" role="img" aria-label="${copy.returnRate}">
      <polyline points="${points}" />
    </svg>
  `;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function handleSimulationInput(event) {
  const name = event.target.dataset.simulationInput;
  if (name === "buyAmount") {
    const value = parsePrincipalInput(event.target.value);
    state.simulation.buyAmount = value;
    formatPrincipalInputElement(event.target);
  } else {
    state.simulation[name] = Number(event.target.value);
  }
  updateSimulationView();
}

function handleSimulationYearChange(event) {
  state.simulation.selectedYear = Number(event.target.value);
  renderSimulationTable();
}

function updateSimulationView() {
  const summary = document.querySelector("#simulation-summary");
  const detail = document.querySelector("#simulation-detail");
  if (!summary || !detail) {
    return;
  }

  const loan = calculateLoanPayment(state.loan);
  if (!loan.ok) {
    summary.innerHTML = `<div class="state-card warning-state">${loanErrorMessage(loan.error)}</div>`;
    detail.innerHTML = "";
    return;
  }
  const loanSchedule = calculateLoanSchedule(loan);

  if (!state.stock.selected) {
    summary.innerHTML = `<div class="state-card">${copy.simulationNoStock}</div>`;
    detail.innerHTML = "";
    return;
  }

  if (state.stock.returnStatus === "loading") {
    summary.innerHTML = `<div class="state-card">${copy.loadingReturn}</div>`;
    detail.innerHTML = "";
    return;
  }

  if (state.stock.returnStatus === "insufficient") {
    summary.innerHTML = `<div class="state-card warning-state">${copy.insufficientData}</div>`;
    detail.innerHTML = "";
    return;
  }

  if (state.stock.returnStatus !== "ready" || !state.stock.returnData) {
    summary.innerHTML = `<div class="state-card">${copy.simulationNoReturn}</div>`;
    detail.innerHTML = "";
    return;
  }

  const data = state.stock.returnData;
  const monthlyRate = derivePeriodMonthlyRate(data.returnRate, data.months);
  if (monthlyRate === null) {
    summary.innerHTML = `<div class="state-card warning-state">${copy.simulationInvalidMonthlyRate}</div>`;
    detail.innerHTML = "";
    return;
  }

  const currency = (data.currency || "TWD").toUpperCase();
  const fxRate = currency === "TWD" ? 1 : Number(data.fxRate);
  if (!Number.isFinite(fxRate) || fxRate <= 0) {
    summary.innerHTML = `<div class="state-card warning-state">${copy.simulationInvalidFxRate}</div>`;
    detail.innerHTML = "";
    return;
  }

  const result = simulateStockLoanRepayment({
    buyAmount: state.simulation.buyAmount,
    startPrice: data.latestPrice,
    monthlyRate,
    totalMonths: loan.totalMonths,
    graceMonths: loan.graceMonths,
    graceMonthlyPayment: loan.graceMonthlyPayment,
    repaymentMonthlyPayment: loan.repaymentMonthlyPayment,
    startDate: new Date(),
    fxRate,
    loanScheduleRows: loanSchedule.rows
  });

  if (!result.ok) {
    summary.innerHTML = `<div class="state-card warning-state">${simulationErrorMessage(result.error)}</div>`;
    detail.innerHTML = "";
    return;
  }

  const holdResult = simulateStockHold({
    buyAmount: state.simulation.buyAmount,
    startPrice: data.latestPrice,
    monthlyRate,
    totalMonths: loan.totalMonths,
    startDate: new Date(),
    fxRate,
    loanScheduleRows: loanSchedule.rows
  });

  if (!holdResult.ok) {
    summary.innerHTML = `<div class="state-card warning-state">${simulationErrorMessage(holdResult.error)}</div>`;
    detail.innerHTML = "";
    return;
  }

  state.simulation.result = result;
  state.simulation.holdResult = holdResult;
  state.simulation.loanSchedule = loanSchedule;
  state.simulation.currency = currency;
  state.simulation.fxRate = fxRate;

  const years = uniqueYears(result.rows);
  if (!years.includes(state.simulation.selectedYear)) {
    state.simulation.selectedYear = years[0];
  }

  const repayTone = result.insufficient
    ? "negative"
    : result.totalReturnPercent > 0
      ? "positive"
      : result.totalReturnPercent < 0
        ? "negative"
        : "flat";
  const holdTone = holdResult.totalReturnPercent > 0
    ? "positive"
    : holdResult.totalReturnPercent < 0
      ? "negative"
      : "flat";

  const fxCard = metricCard(
    copy.simulationFxLabel,
    `1 ${currency} = ${formatFx.format(fxRate)} TWD${data.fxAsOf ? ` (${data.fxAsOf})` : ""}`
  );

  summary.innerHTML = `
    ${metricCard(copy.simulationCurrencyLabel, currency)}
    ${fxCard}
    ${metricCard(copy.simulationMonthlyRate, `${formatPercent.format(result.monthlyRatePercent)}${copy.percent}`)}
    ${metricCard(copy.simulationHoldFinalValue, formatCurrency.format(holdResult.finalValue), holdTone === "positive" ? "primary" : "")}
    ${metricCard(copy.simulationHoldReturn, `${formatPercent.format(holdResult.totalReturnPercent)}${copy.percent}`, holdTone === "positive" ? "primary" : "")}
    ${metricCard(copy.simulationRepayFinalValue, formatCurrency.format(result.finalValue), repayTone === "positive" ? "primary" : "")}
    ${metricCard(copy.simulationRepayReturn, `${formatPercent.format(result.totalReturnPercent)}${copy.percent}`, repayTone === "positive" ? "primary" : "")}
    ${metricCard(copy.simulationNetReturn, `${formatPercent.format(result.netReturnPercent)}${copy.percent}`)}
    ${metricCard(copy.simulationTotalPaid, formatCurrency.format(result.totalPaid))}
    ${metricCard(copy.simulationShortfall, formatCurrency.format(result.totalShortfall))}
    ${metricCard(copy.simulationInitialShares, formatSharesInt.format(result.initialShares))}
    ${metricCard(copy.simulationFinalShares, formatSharesInt.format(result.finalShares))}
    ${metricCard(copy.simulationInitialCash, formatCurrency.format(result.initialCash))}
  `;

  const warning = result.insufficient
    ? `<div class="state-card warning-state">${copy.simulationInsufficient}</div>`
    : "";

  detail.innerHTML = `
    ${warning}
    <div class="simulation-toolbar">
      <label class="field year-select">
        <span>${copy.simulationYearLabel}</span>
        <select id="simulation-year">
          ${years.map((year) => `<option value="${year}" ${year === state.simulation.selectedYear ? "selected" : ""}>${year}</option>`).join("")}
        </select>
      </label>
    </div>
    <div class="simulation-table-wrap" id="simulation-table-wrap"></div>
    <p class="source-note">${copy.simulationNote}</p>
  `;

  document.querySelector("#simulation-year").addEventListener("change", handleSimulationYearChange);
  renderSimulationTable();
}

function renderSimulationTable() {
  const wrap = document.querySelector("#simulation-table-wrap");
  const result = state.simulation.result;
  const holdResult = state.simulation.holdResult;
  if (!wrap || !result || !holdResult) {
    return;
  }

  const holdByLabel = new Map(holdResult.rows.map((row) => [row.label, row]));
  const rows = result.rows
    .filter((row) => row.year === state.simulation.selectedYear)
    .map((row) => ({ repay: row, hold: holdByLabel.get(row.label) }));
  if (rows.length === 0) {
    wrap.innerHTML = `<div class="state-card">${copy.simulationNoReturn}</div>`;
    return;
  }

  const currency = state.simulation.currency || "TWD";
  const startPriceHeader = currency === "TWD"
    ? copy.simulationTableStartPrice
    : `${copy.simulationTableStartPrice} (${currency})`;

  wrap.innerHTML = `
    <table class="simulation-table">
      <thead>
        <tr class="group-row">
          <th class="group-common" colspan="5">${copy.simulationGroupCommon}</th>
          <th class="group-hold" colspan="3">${copy.simulationGroupHold}</th>
          <th class="group-repay" colspan="6">${copy.simulationGroupRepay}</th>
        </tr>
        <tr>
          <th class="group-common">${copy.simulationTableMonth}</th>
          <th class="group-common">${copy.simulationTableStage}</th>
          <th class="group-common num">${copy.simulationTablePayment}</th>
          <th class="group-common num">${copy.simulationTableRemainingDebt}</th>
          <th class="group-common num">${startPriceHeader}</th>
          <th class="group-hold num">${copy.simulationTableHoldValue}</th>
          <th class="group-hold num">${copy.simulationTableHoldTotal}</th>
          <th class="group-hold num">${copy.simulationTableHoldReturn}</th>
          <th class="group-repay num">${copy.simulationTableSold}</th>
          <th class="group-repay num">${copy.simulationTableProceeds}</th>
          <th class="group-repay num">${copy.simulationTableRemaining}</th>
          <th class="group-repay num">${copy.simulationTableCash}</th>
          <th class="group-repay num">${copy.simulationTableEndValue}</th>
          <th class="group-repay num">${copy.simulationTableShortfall}</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(({ repay, hold }) => {
          const holdValue = hold ? formatCurrency.format(hold.sharesValueTwd) : "-";
          const holdTotal = hold ? formatCurrency.format(hold.totalValueTwd) : "-";
          const holdReturn = hold ? `${formatPercent.format(hold.cumulativeReturnPercent)}${copy.percent}` : "-";
          return `
            <tr class="${repay.shortfall > 0 ? "row-warning" : ""}">
              <td class="group-common">${repay.label}</td>
              <td class="group-common">${repay.stage === "grace" ? copy.simulationStageGrace : copy.simulationStageRepayment}</td>
              <td class="group-common num">${formatCurrency.format(repay.payment)}</td>
              <td class="group-common num">${formatCurrency.format(repay.remainingDebt)}</td>
              <td class="group-common num">${formatPrice4.format(repay.startPrice)}${currency === "TWD" ? "" : ` ${currency}`}</td>
              <td class="group-hold num">${holdValue}</td>
              <td class="group-hold num">${holdTotal}</td>
              <td class="group-hold num">${holdReturn}</td>
              <td class="group-repay num">${formatSharesInt.format(repay.soldShares)}</td>
              <td class="group-repay num">${formatCurrency.format(repay.proceedsTwd)}</td>
              <td class="group-repay num">${formatSharesInt.format(repay.remainingShares)}</td>
              <td class="group-repay num">${formatCurrency.format(repay.cashAtMonthEnd)}</td>
              <td class="group-repay num">${formatCurrency.format(repay.endValue)}</td>
              <td class="group-repay num">${repay.shortfall > 0 ? formatCurrency.format(repay.shortfall) : "-"}</td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

function uniqueYears(rows) {
  const seen = new Set();
  const years = [];
  rows.forEach((row) => {
    if (!seen.has(row.year)) {
      seen.add(row.year);
      years.push(row.year);
    }
  });
  return years;
}

function simulationErrorMessage(error) {
  const messages = {
    invalid_buy_amount: copy.simulationInvalidBuy,
    invalid_start_price: copy.simulationInvalidStartPrice,
    invalid_monthly_rate: copy.simulationInvalidMonthlyRate,
    invalid_fx_rate: copy.simulationInvalidFxRate,
    buy_amount_too_small: copy.simulationBuyAmountTooSmall,
    invalid_term: copy.invalidTerm,
    invalid_grace: copy.invalidGrace
  };
  return messages[error] || copy.apiError;
}

function handleDcaInput(event) {
  const name = event.target.dataset.dcaInput;
  if (name === "monthlyAmount") {
    const value = parsePrincipalInput(event.target.value);
    state.dca.monthlyAmount = value;
    formatPrincipalInputElement(event.target);
  } else {
    state.dca[name] = Number(event.target.value);
  }
  updateDcaView();
}

function handleDcaYearChange(event) {
  state.dca.selectedYear = Number(event.target.value);
  renderDcaTable();
}

function updateDcaView() {
  const summary = document.querySelector("#dca-summary");
  const detail = document.querySelector("#dca-detail");
  if (!summary || !detail) {
    return;
  }

  const loan = calculateLoanPayment(state.loan);
  if (!loan.ok) {
    summary.innerHTML = `<div class="state-card warning-state">${loanErrorMessage(loan.error)}</div>`;
    detail.innerHTML = "";
    return;
  }

  if (!state.stock.selected) {
    summary.innerHTML = `<div class="state-card">${copy.dcaNoStock}</div>`;
    detail.innerHTML = "";
    return;
  }

  if (state.stock.returnStatus === "loading") {
    summary.innerHTML = `<div class="state-card">${copy.loadingReturn}</div>`;
    detail.innerHTML = "";
    return;
  }

  if (state.stock.returnStatus === "insufficient") {
    summary.innerHTML = `<div class="state-card warning-state">${copy.insufficientData}</div>`;
    detail.innerHTML = "";
    return;
  }

  if (state.stock.returnStatus !== "ready" || !state.stock.returnData) {
    summary.innerHTML = `<div class="state-card">${copy.simulationNoReturn}</div>`;
    detail.innerHTML = "";
    return;
  }

  const data = state.stock.returnData;
  const monthlyRate = derivePeriodMonthlyRate(data.returnRate, data.months);
  if (monthlyRate === null) {
    summary.innerHTML = `<div class="state-card warning-state">${copy.simulationInvalidMonthlyRate}</div>`;
    detail.innerHTML = "";
    return;
  }

  const currency = (data.currency || "TWD").toUpperCase();
  const fxRate = currency === "TWD" ? 1 : Number(data.fxRate);
  if (!Number.isFinite(fxRate) || fxRate <= 0) {
    summary.innerHTML = `<div class="state-card warning-state">${copy.simulationInvalidFxRate}</div>`;
    detail.innerHTML = "";
    return;
  }

  const result = simulateDollarCostAverage({
    monthlyAmount: state.dca.monthlyAmount,
    startPrice: data.latestPrice,
    monthlyRate,
    totalMonths: loan.totalMonths,
    startDate: new Date(),
    fxRate
  });

  if (!result.ok) {
    summary.innerHTML = `<div class="state-card warning-state">${dcaErrorMessage(result.error)}</div>`;
    detail.innerHTML = "";
    return;
  }

  state.dca.result = result;
  state.dca.currency = currency;
  state.dca.fxRate = fxRate;

  const years = uniqueYears(result.rows);
  if (!years.includes(state.dca.selectedYear)) {
    state.dca.selectedYear = years[0];
  }

  const tone = result.totalReturnPercent > 0
    ? "positive"
    : result.totalReturnPercent < 0
      ? "negative"
      : "flat";

  summary.innerHTML = `
    ${metricCard(copy.dcaFinalValue, formatCurrency.format(result.finalValue), tone === "positive" ? "primary" : "")}
    ${metricCard(copy.dcaTotalReturn, `${formatPercent.format(result.totalReturnPercent)}${copy.percent}`, tone === "positive" ? "primary" : "")}
    ${metricCard(copy.dcaTotalInvested, formatCurrency.format(result.cumulativeInvested))}
    ${metricCard(copy.dcaFinalShares, formatSharesInt.format(result.finalShares))}
    ${metricCard(copy.dcaFinalCash, formatCurrency.format(result.finalCash))}
  `;

  detail.innerHTML = `
    <div class="simulation-toolbar">
      <label class="field year-select">
        <span>${copy.simulationYearLabel}</span>
        <select id="dca-year">
          ${years.map((year) => `<option value="${year}" ${year === state.dca.selectedYear ? "selected" : ""}>${year}</option>`).join("")}
        </select>
      </label>
    </div>
    <div class="simulation-table-wrap" id="dca-table-wrap"></div>
    <p class="source-note">${copy.dcaNote}</p>
  `;

  document.querySelector("#dca-year").addEventListener("change", handleDcaYearChange);
  renderDcaTable();
}

function renderDcaTable() {
  const wrap = document.querySelector("#dca-table-wrap");
  const result = state.dca.result;
  if (!wrap || !result) {
    return;
  }

  const rows = result.rows.filter((row) => row.year === state.dca.selectedYear);
  if (rows.length === 0) {
    wrap.innerHTML = `<div class="state-card">${copy.simulationNoReturn}</div>`;
    return;
  }

  const currency = state.dca.currency || "TWD";
  const priceHeader = currency === "TWD" ? copy.dcaTablePrice : `${copy.dcaTablePrice} (${currency})`;

  wrap.innerHTML = `
    <table class="simulation-table">
      <thead>
        <tr>
          <th>${copy.dcaTableMonth}</th>
          <th class="num">${copy.dcaTableAmount}</th>
          <th class="num">${copy.dcaTableCumulative}</th>
          <th class="num">${priceHeader}</th>
          <th class="num">${copy.dcaTableBought}</th>
          <th class="num">${copy.dcaTableShares}</th>
          <th class="num">${copy.dcaTableCash}</th>
          <th class="num">${copy.dcaTableValue}</th>
          <th class="num">${copy.dcaTableReturn}</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${row.label}</td>
            <td class="num">${formatCurrency.format(row.monthlyAmount)}</td>
            <td class="num">${formatCurrency.format(row.cumulativeInvested)}</td>
            <td class="num">${formatPrice4.format(row.startPrice)}${currency === "TWD" ? "" : ` ${currency}`}</td>
            <td class="num">${formatSharesInt.format(row.boughtShares)}</td>
            <td class="num">${formatSharesInt.format(row.totalShares)}</td>
            <td class="num">${formatCurrency.format(row.cashAtMonthEnd)}</td>
            <td class="num">${formatCurrency.format(row.totalValueTwd)}</td>
            <td class="num">${formatPercent.format(row.cumulativeReturnPercent)}${copy.percent}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function dcaErrorMessage(error) {
  const messages = {
    invalid_monthly_amount: copy.dcaInvalidMonthlyAmount,
    invalid_start_price: copy.simulationInvalidStartPrice,
    invalid_monthly_rate: copy.simulationInvalidMonthlyRate,
    invalid_fx_rate: copy.simulationInvalidFxRate,
    invalid_term: copy.invalidTerm
  };
  return messages[error] || copy.apiError;
}

function handleExportExcel() {
  if (!state.stock.returnData || !state.simulation.result || !state.simulation.holdResult || !state.dca.result) {
    alert(copy.exportUnavailable);
    return;
  }

  setExportStatus("loading");
  try {
    downloadWorkbook({
      fileName: `${copy.exportFileName}-${new Date().toISOString().slice(0, 10)}`,
      sheets: buildExportSheets()
    });
  } catch (error) {
    console.error(error);
    alert(copy.exportFailed);
  } finally {
    setExportStatus("idle");
  }
}

function setExportStatus(status) {
  state.exportStatus = status;
  const button = document.querySelector("#export-excel-button");
  if (!button) {
    return;
  }
  button.disabled = status === "loading";
  button.textContent = status === "loading" ? copy.exportPreparing : copy.exportButton;
}

function buildExportSheets() {
  const loan = calculateLoanPayment(state.loan);
  const loanSheet = buildLoanExportSheet(loan);
  const stockSheet = buildStockExportSheet();
  const strategySheet = buildStrategyExportSheet();
  const dcaSheet = buildDcaExportSheet();
  const chartsSheet = buildChartsExportSheet(stockSheet, strategySheet, dcaSheet);
  return [loanSheet, stockSheet, strategySheet, dcaSheet, chartsSheet];
}

function buildLoanExportSheet(loan) {
  const schedule = calculateLoanSchedule(loan);
  const rows = [
    [copy.exportLoanSheet, ""],
    [copy.principal, loan.principal],
    [copy.annualRate, loan.annualRatePercent],
    [copy.totalYears, loan.totalYears],
    [copy.graceYears, loan.graceYears],
    [copy.graceMonthlyPayment, loan.graceMonthlyPayment],
    [copy.repaymentMonthlyPayment, loan.repaymentMonthlyPayment],
    [copy.totalInterest, loan.totalInterest],
    [copy.totalPayment, loan.totalPayment],
    [],
    [
      copy.simulationTableMonth,
      copy.simulationTableStage,
      copy.simulationTablePayment,
      copy.exportInterest,
      copy.exportPrincipalPayment,
      copy.simulationTableRemainingDebt
    ]
  ];
  const start = new Date();
  schedule.rows.forEach((row) => {
    rows.push([
      monthLabel(start, row.index),
      row.stage === "grace" ? copy.simulationStageGrace : copy.simulationStageRepayment,
      row.payment,
      row.interest,
      row.principalPayment,
      row.remainingDebt
    ]);
  });

  return {
    name: copy.exportLoanSheet,
    rows
  };
}

function buildStockExportSheet() {
  const data = state.stock.returnData;
  const selected = state.stock.selected || {};
  const rows = [
    [copy.exportStockSheet, ""],
    [copy.exportStockName, selected.name || ""],
    [copy.exportStockSymbol, data.symbol || selected.symbol || ""],
    [copy.returnRate, data.returnRate],
    [copy.startDate, data.startDate],
    [copy.latestDate, data.latestDate],
    [copy.startPrice, data.startPrice],
    [copy.latestPrice, data.latestPrice],
    [copy.simulationCurrencyLabel, data.currency || "TWD"],
    [copy.simulationFxLabel, data.fxRate || 1],
    [],
    [copy.simulationTableMonth, copy.latestPrice]
  ];
  const firstDataRow = rows.length + 1;
  data.series.forEach((point) => {
    rows.push([point.date, point.price]);
  });

  return {
    name: copy.exportStockSheet,
    rows,
    chartData: {
      firstDataRow,
      priceColumn: 2
    }
  };
}

function buildStrategyExportSheet() {
  const repay = state.simulation.result;
  const hold = state.simulation.holdResult;
  const dca = state.dca.result;
  const holdByLabel = new Map(hold.rows.map((row) => [row.label, row]));
  const dcaByLabel = new Map(dca.rows.map((row) => [row.label, row]));
  const rows = [
    [copy.exportStrategySheet, ""],
    [copy.simulationCurrencyLabel, state.simulation.currency || "TWD"],
    [copy.simulationFxLabel, state.simulation.fxRate || 1],
    [copy.simulationMonthlyRate, repay.monthlyRatePercent],
    [copy.dcaFinalValue, dca.finalValue],
    [copy.simulationHoldFinalValue, hold.finalValue],
    [copy.simulationRepayFinalValue, repay.finalValue],
    [],
    [
      copy.simulationTableMonth,
      copy.simulationTableStage,
      copy.simulationTablePayment,
      copy.simulationTableRemainingDebt,
      copy.simulationTableStartPrice,
      copy.exportStrategyDcaStockValue,
      copy.exportStrategyHoldStockValue,
      copy.simulationTableHoldTotal,
      copy.simulationTableHoldReturn,
      copy.simulationTableSold,
      copy.simulationTableProceeds,
      copy.simulationTableRemaining,
      copy.simulationTableCash,
      copy.exportStrategyLoanStockValue,
      copy.simulationTableShortfall
    ]
  ];
  const firstDataRow = rows.length + 1;
  repay.rows.forEach((repayRow) => {
    const holdRow = holdByLabel.get(repayRow.label);
    const dcaRow = dcaByLabel.get(repayRow.label);
    rows.push([
      repayRow.label,
      repayRow.stage === "grace" ? copy.simulationStageGrace : copy.simulationStageRepayment,
      repayRow.payment,
      repayRow.remainingDebt,
      repayRow.startPrice,
      dcaRow?.sharesValueTwd ?? null,
      holdRow?.sharesValueTwd ?? null,
      holdRow?.totalValueTwd ?? null,
      holdRow?.cumulativeReturnPercent ?? null,
      repayRow.soldShares,
      repayRow.proceedsTwd,
      repayRow.remainingShares,
      repayRow.cashAtMonthEnd,
      repayRow.sharesValueTwd,
      repayRow.shortfall
    ]);
  });

  return {
    name: copy.exportStrategySheet,
    rows,
    chartData: {
      firstDataRow,
      dcaStockValueColumn: 6,
      holdStockValueColumn: 7,
      loanStockValueColumn: 14
    }
  };
}

function buildDcaExportSheet() {
  const result = state.dca.result;
  const rows = [
    [copy.exportDcaSheet, ""],
    [copy.simulationCurrencyLabel, state.dca.currency || "TWD"],
    [copy.simulationFxLabel, state.dca.fxRate || 1],
    [copy.dcaMonthlyAmount, result.monthlyAmount],
    [copy.dcaFinalValue, result.finalValue],
    [copy.dcaTotalInvested, result.cumulativeInvested],
    [],
    [
      copy.dcaTableMonth,
      copy.dcaTableAmount,
      copy.dcaTableCumulative,
      copy.dcaTablePrice,
      copy.dcaTableBought,
      copy.dcaTableShares,
      copy.dcaTableCash,
      copy.dcaTableValue,
      copy.dcaTableReturn
    ]
  ];
  const firstDataRow = rows.length + 1;
  result.rows.forEach((row) => {
    rows.push([
      row.label,
      row.monthlyAmount,
      row.cumulativeInvested,
      row.startPrice,
      row.boughtShares,
      row.totalShares,
      row.cashAtMonthEnd,
      row.totalValueTwd,
      row.cumulativeReturnPercent
    ]);
  });

  return {
    name: copy.exportDcaSheet,
    rows,
    chartData: {
      firstDataRow,
      cumulativeColumn: 3,
      valueColumn: 8
    }
  };
}

function buildChartsExportSheet(stockSheet, strategySheet, dcaSheet) {
  const currency = (state.stock.returnData?.currency || "TWD").toUpperCase();
  return {
    name: copy.exportChartsSheet,
    rows: [[copy.exportChartsSheet]],
    charts: [
      {
        title: copy.exportStockPriceChart,
        sourceSheetName: stockSheet.name,
        categoriesColumn: 1,
        firstDataRow: stockSheet.chartData.firstDataRow,
        series: [
          { name: copy.latestPrice, valuesColumn: stockSheet.chartData.priceColumn, color: "2563EB" }
        ],
        xAxisTitle: copy.exportAxisMonth,
        yAxisTitle: `${copy.exportAxisPrice} (${currency})`,
        yAxisFormat: "#,##0.00",
        anchor: { fromCol: 0, fromRow: 1, toCol: 14, toRow: 20 }
      },
      {
        title: copy.exportStrategyChart,
        sourceSheetName: strategySheet.name,
        categoriesColumn: 1,
        firstDataRow: strategySheet.chartData.firstDataRow,
        series: [
          { name: copy.exportStrategyDcaStockValue, valuesColumn: strategySheet.chartData.dcaStockValueColumn, color: "10B981" },
          { name: copy.exportStrategyHoldStockValue, valuesColumn: strategySheet.chartData.holdStockValueColumn, color: "2563EB" },
          { name: copy.exportStrategyLoanStockValue, valuesColumn: strategySheet.chartData.loanStockValueColumn, color: "F59E0B" }
        ],
        xAxisTitle: copy.exportAxisMonth,
        yAxisTitle: copy.exportAxisTwd,
        anchor: { fromCol: 0, fromRow: 23, toCol: 14, toRow: 42 }
      },
      {
        title: copy.exportDcaChart,
        sourceSheetName: dcaSheet.name,
        categoriesColumn: 1,
        firstDataRow: dcaSheet.chartData.firstDataRow,
        series: [
          { name: copy.dcaTableCumulative, valuesColumn: dcaSheet.chartData.cumulativeColumn, color: "64748B" },
          { name: copy.dcaTableValue, valuesColumn: dcaSheet.chartData.valueColumn, color: "10B981" }
        ],
        xAxisTitle: copy.exportAxisMonth,
        yAxisTitle: copy.exportAxisTwd,
        anchor: { fromCol: 0, fromRow: 45, toCol: 14, toRow: 64 }
      }
    ]
  };
}

function monthLabel(startDate, index) {
  const date = new Date(startDate.getFullYear(), startDate.getMonth() + index, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
