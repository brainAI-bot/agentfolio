'use strict';

const CURRENCY_DECIMALS = Object.freeze({ SOL: 9, USDC: 6 });

class MarketplaceAmountError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MarketplaceAmountError';
    this.code = code;
  }
}

function normalizeCurrency(value) {
  return String(value || '').trim().toUpperCase();
}

function parseDecimalToMinorUnits(value, currencyValue) {
  const currency = normalizeCurrency(currencyValue);
  const decimals = CURRENCY_DECIMALS[currency];
  if (!Number.isInteger(decimals)) {
    throw new MarketplaceAmountError('UNSUPPORTED_CURRENCY', `Unsupported currency: ${currency || '(empty)'}`);
  }
  const raw = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) {
    throw new MarketplaceAmountError('INVALID_DECIMAL_AMOUNT', 'Amount must be a positive plain decimal');
  }
  const [whole, fraction = ''] = raw.split('.');
  if (fraction.length > decimals) {
    throw new MarketplaceAmountError('AMOUNT_PRECISION_EXCEEDED', `${currency} supports at most ${decimals} decimal places`);
  }
  const minor = BigInt(whole) * (10n ** BigInt(decimals))
    + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0');
  if (minor <= 0n) {
    throw new MarketplaceAmountError('INVALID_DECIMAL_AMOUNT', 'Amount must be positive');
  }
  return minor.toString();
}

function formatMinorUnits(minorValue, currencyValue) {
  const currency = normalizeCurrency(currencyValue);
  const decimals = CURRENCY_DECIMALS[currency];
  if (!Number.isInteger(decimals) || !/^[1-9]\d*$/.test(String(minorValue || ''))) {
    throw new MarketplaceAmountError('INVALID_MINOR_UNITS', 'Minor units must be a positive integer string');
  }
  const raw = String(minorValue).padStart(decimals + 1, '0');
  if (decimals === 0) return raw;
  const whole = raw.slice(0, -decimals);
  const fraction = raw.slice(-decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

function exactMinorUnits(row, decimalField, minorField, currencyField = 'budget_currency') {
  if (row && /^[1-9]\d*$/.test(String(row[minorField] || ''))) return String(row[minorField]);
  return parseDecimalToMinorUnits(row?.[decimalField], row?.[currencyField]);
}

module.exports = {
  CURRENCY_DECIMALS,
  MarketplaceAmountError,
  normalizeCurrency,
  parseDecimalToMinorUnits,
  formatMinorUnits,
  exactMinorUnits,
};
