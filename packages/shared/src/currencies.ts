export interface CurrencyInfo {
  code: string;
  symbol: string;
  name: string;
  /** Number of digits after the decimal separator (ISO 4217 minor unit exponent). */
  decimals: number;
}

/**
 * Supported currencies. Amounts are always stored and transmitted as integers in
 * the currency's minor unit (cents, paise, yen, ...).
 */
export const CURRENCIES: readonly CurrencyInfo[] = [
  { code: 'USD', symbol: '$', name: 'US Dollar', decimals: 2 },
  { code: 'EUR', symbol: '€', name: 'Euro', decimals: 2 },
  { code: 'GBP', symbol: '£', name: 'British Pound', decimals: 2 },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', decimals: 2 },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', decimals: 0 },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan', decimals: 2 },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', decimals: 2 },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar', decimals: 2 },
  { code: 'CHF', symbol: 'CHF', name: 'Swiss Franc', decimals: 2 },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', decimals: 2 },
  { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar', decimals: 2 },
  { code: 'NZD', symbol: 'NZ$', name: 'New Zealand Dollar', decimals: 2 },
  { code: 'SEK', symbol: 'kr', name: 'Swedish Krona', decimals: 2 },
  { code: 'NOK', symbol: 'kr', name: 'Norwegian Krone', decimals: 2 },
  { code: 'DKK', symbol: 'kr', name: 'Danish Krone', decimals: 2 },
  { code: 'PLN', symbol: 'zł', name: 'Polish Złoty', decimals: 2 },
  { code: 'CZK', symbol: 'Kč', name: 'Czech Koruna', decimals: 2 },
  { code: 'HUF', symbol: 'Ft', name: 'Hungarian Forint', decimals: 2 },
  { code: 'RON', symbol: 'lei', name: 'Romanian Leu', decimals: 2 },
  { code: 'TRY', symbol: '₺', name: 'Turkish Lira', decimals: 2 },
  { code: 'UAH', symbol: '₴', name: 'Ukrainian Hryvnia', decimals: 2 },
  { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham', decimals: 2 },
  { code: 'SAR', symbol: '﷼', name: 'Saudi Riyal', decimals: 2 },
  { code: 'QAR', symbol: '﷼', name: 'Qatari Riyal', decimals: 2 },
  { code: 'KWD', symbol: 'د.ك', name: 'Kuwaiti Dinar', decimals: 3 },
  { code: 'BHD', symbol: '.د.ب', name: 'Bahraini Dinar', decimals: 3 },
  { code: 'OMR', symbol: '﷼', name: 'Omani Rial', decimals: 3 },
  { code: 'ILS', symbol: '₪', name: 'Israeli New Shekel', decimals: 2 },
  { code: 'EGP', symbol: 'E£', name: 'Egyptian Pound', decimals: 2 },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand', decimals: 2 },
  { code: 'NGN', symbol: '₦', name: 'Nigerian Naira', decimals: 2 },
  { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling', decimals: 2 },
  { code: 'MAD', symbol: 'DH', name: 'Moroccan Dirham', decimals: 2 },
  { code: 'BRL', symbol: 'R$', name: 'Brazilian Real', decimals: 2 },
  { code: 'MXN', symbol: 'Mex$', name: 'Mexican Peso', decimals: 2 },
  { code: 'ARS', symbol: 'AR$', name: 'Argentine Peso', decimals: 2 },
  { code: 'CLP', symbol: 'CLP$', name: 'Chilean Peso', decimals: 0 },
  { code: 'COP', symbol: 'COL$', name: 'Colombian Peso', decimals: 2 },
  { code: 'PEN', symbol: 'S/', name: 'Peruvian Sol', decimals: 2 },
  { code: 'THB', symbol: '฿', name: 'Thai Baht', decimals: 2 },
  { code: 'VND', symbol: '₫', name: 'Vietnamese Đồng', decimals: 0 },
  { code: 'IDR', symbol: 'Rp', name: 'Indonesian Rupiah', decimals: 2 },
  { code: 'MYR', symbol: 'RM', name: 'Malaysian Ringgit', decimals: 2 },
  { code: 'PHP', symbol: '₱', name: 'Philippine Peso', decimals: 2 },
  { code: 'KRW', symbol: '₩', name: 'South Korean Won', decimals: 0 },
  { code: 'TWD', symbol: 'NT$', name: 'New Taiwan Dollar', decimals: 2 },
  { code: 'PKR', symbol: '₨', name: 'Pakistani Rupee', decimals: 2 },
  { code: 'BDT', symbol: '৳', name: 'Bangladeshi Taka', decimals: 2 },
  { code: 'LKR', symbol: 'Rs', name: 'Sri Lankan Rupee', decimals: 2 },
  { code: 'NPR', symbol: 'रू', name: 'Nepalese Rupee', decimals: 2 },
] as const;

const CURRENCY_MAP: ReadonlyMap<string, CurrencyInfo> = new Map(
  CURRENCIES.map((c) => [c.code, c]),
);

export const CURRENCY_CODES: readonly string[] = CURRENCIES.map((c) => c.code);

export function isSupportedCurrency(code: string): boolean {
  return CURRENCY_MAP.has(code.toUpperCase());
}

/**
 * Look up a currency. Unknown codes fall back to a 2-decimal placeholder so
 * formatting never crashes on stale/foreign data.
 */
export function getCurrency(code: string): CurrencyInfo {
  const found = CURRENCY_MAP.get(code.toUpperCase());
  return found ?? { code: code.toUpperCase(), symbol: code.toUpperCase(), name: code.toUpperCase(), decimals: 2 };
}
