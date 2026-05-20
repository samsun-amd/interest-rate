import { calculateLoanPayment, clampNumber } from "./calculations.js";
import { copy } from "./i18n/zh-TW.js";

const state = {
  loan: {
    principal: 1000000,
    annualRatePercent: 3.25,
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
  }
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

function render() {
  app.innerHTML = `
    <div class="page-shell">
      <header class="hero">
        <div class="risk-banner">${copy.warning}</div>
        <div class="hero-content">
          <div>
            <p class="eyebrow">Loan / Equity Return Tool</p>
            <h1>${copy.appTitle}</h1>
          </div>
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
              ${rangeControl("graceYears", copy.graceYears, state.loan.graceYears, 1, 5, "1", copy.years)}
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
}

function numberOnlyControl(name, label, value, min, step, suffix) {
  return `
    <label class="field">
      <span>${label}</span>
      <div class="input-row">
        <input data-loan-input="${name}" type="text" inputmode="numeric" autocomplete="off" value="${formatPrincipalInput(value)}" />
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
}

function handleLoanRange(event) {
  const name = event.target.dataset.loanRange;
  const value = Number(event.target.value);
  state.loan[name] = value;
  document.querySelector(`[data-loan-input='${name}']`).value = value;
  updateLoan();
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
