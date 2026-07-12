export const EXPENSE_CATEGORIES = [
  { key: 'FOOD_DRINK', label: 'Food & drink', emoji: '🍕' },
  { key: 'GROCERIES', label: 'Groceries', emoji: '🛒' },
  { key: 'TRANSPORT', label: 'Transport', emoji: '🚕' },
  { key: 'HOME', label: 'Home', emoji: '🏠' },
  { key: 'RENT', label: 'Rent', emoji: '🏢' },
  { key: 'UTILITIES', label: 'Utilities', emoji: '💡' },
  { key: 'ENTERTAINMENT', label: 'Entertainment', emoji: '🎬' },
  { key: 'TRAVEL', label: 'Travel', emoji: '✈️' },
  { key: 'SHOPPING', label: 'Shopping', emoji: '🛍️' },
  { key: 'HEALTH', label: 'Health', emoji: '🩺' },
  { key: 'EDUCATION', label: 'Education', emoji: '🎓' },
  { key: 'GIFTS', label: 'Gifts', emoji: '🎁' },
  { key: 'PETS', label: 'Pets', emoji: '🐾' },
  { key: 'SUBSCRIPTIONS', label: 'Subscriptions', emoji: '📺' },
  { key: 'GENERAL', label: 'General', emoji: '🧾' },
  { key: 'OTHER', label: 'Other', emoji: '📦' },
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]['key'];
export const EXPENSE_CATEGORY_KEYS = EXPENSE_CATEGORIES.map((c) => c.key) as [
  ExpenseCategory,
  ...ExpenseCategory[],
];

export function categoryInfo(key: string) {
  return EXPENSE_CATEGORIES.find((c) => c.key === key) ?? EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1]!;
}

export const GROUP_TYPES = [
  { key: 'TRIP', label: 'Trip', emoji: '✈️' },
  { key: 'HOME', label: 'Home', emoji: '🏠' },
  { key: 'COUPLE', label: 'Couple', emoji: '❤️' },
  { key: 'FRIENDS', label: 'Friends', emoji: '👥' },
  { key: 'PROJECT', label: 'Project', emoji: '💼' },
  { key: 'OTHER', label: 'Other', emoji: '📋' },
] as const;

export type GroupType = (typeof GROUP_TYPES)[number]['key'];
export const GROUP_TYPE_KEYS = GROUP_TYPES.map((g) => g.key) as [GroupType, ...GroupType[]];

export const SETTLEMENT_METHODS = [
  { key: 'CASH', label: 'Cash' },
  { key: 'BANK_TRANSFER', label: 'Bank transfer' },
  { key: 'UPI', label: 'UPI' },
  { key: 'PAYPAL', label: 'PayPal' },
  { key: 'VENMO', label: 'Venmo' },
  { key: 'OTHER', label: 'Other' },
] as const;

export type SettlementMethod = (typeof SETTLEMENT_METHODS)[number]['key'];
export const SETTLEMENT_METHOD_KEYS = SETTLEMENT_METHODS.map((m) => m.key) as [
  SettlementMethod,
  ...SettlementMethod[],
];

export const RECURRENCE_FREQUENCIES = [
  { key: 'DAILY', label: 'Daily' },
  { key: 'WEEKLY', label: 'Weekly' },
  { key: 'BIWEEKLY', label: 'Every 2 weeks' },
  { key: 'MONTHLY', label: 'Monthly' },
  { key: 'YEARLY', label: 'Yearly' },
] as const;

export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number]['key'];
export const RECURRENCE_FREQUENCY_KEYS = RECURRENCE_FREQUENCIES.map((f) => f.key) as [
  RecurrenceFrequency,
  ...RecurrenceFrequency[],
];

/** Validated categorical palette (CVD-safe ordering) — used for user avatars. */
export const AVATAR_COLORS = [
  '#2a78d6', // blue
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#008300', // green
  '#4a3aa7', // violet
  '#e34948', // red
  '#e87ba4', // magenta
  '#eb6834', // orange
] as const;

export const LIMITS = {
  NAME_MAX: 60,
  EMAIL_MAX: 254,
  PASSWORD_MIN: 8,
  PASSWORD_MAX: 128,
  DESCRIPTION_MAX: 140,
  NOTES_MAX: 2000,
  COMMENT_MAX: 1000,
  GROUP_NAME_MAX: 60,
  MAX_PAYERS: 20,
  MAX_PARTICIPANTS: 50,
  MAX_ITEMS: 100,
  PAGE_SIZE_DEFAULT: 20,
  PAGE_SIZE_MAX: 100,
} as const;
