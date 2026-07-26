import { z } from 'zod';
import type { SplitType } from './split';

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
  { key: 'FAMILY', label: 'Family', emoji: '👨‍👩‍👧‍👦' },
  { key: 'ROOMMATES', label: 'Roommates', emoji: '🔑' },
  { key: 'WORK', label: 'Work', emoji: '💻' },
  { key: 'CLUB', label: 'Club', emoji: '🎯' },
  { key: 'SPORTS_TEAM', label: 'Sports team', emoji: '⚽' },
  { key: 'EVENT', label: 'Event', emoji: '🎉' },
  { key: 'SCHOOL', label: 'School', emoji: '🎓' },
  { key: 'SUBSCRIPTION', label: 'Subscription', emoji: '💸' },
  { key: 'NIGHT_OUT', label: 'Night out', emoji: '🍻' },
  { key: 'CHARITY', label: 'Charity', emoji: '🤝' },
  { key: 'OTHER', label: 'Other', emoji: '📋' },
] as const;

export type GroupType = (typeof GROUP_TYPES)[number]['key'];
export const GROUP_TYPE_KEYS = GROUP_TYPES.map((g) => g.key) as [GroupType, ...GroupType[]];

// Curated emoji choices for the group picker (web + mobile). Organized into
// named category groups here for maintainability; consumed as one flat list
// (GROUP_EMOJI_CHOICES) so the picker UI stays a single grid — WI-006.
// All 16 GROUP_TYPES default emoji are members of this list.

const TRAVEL_EMOJI = [
  '✈️', '🧳', '🏖️', '⛷️', '🚗', '🚕', '🚆', '🚢',
  '🗺️', '🏕️', '🎿', '🚀', '🛥️', '🏔️',
] as const;

const HOME_EMOJI = [
  '🏠', '🏡', '🔑', '🛋️', '🧹', '🛏️', '🚪', '🪴', '🔧', '🧺',
] as const;

const FOOD_DRINK_EMOJI = [
  '🍕', '🍔', '🌮', '🍜', '🍣', '🍰', '☕', '🍻',
  '🍷', '🥂', '🍳', '🥑', '🍩', '🍦', '🥘', '🍱',
] as const;

const ACTIVITIES_EMOJI = [
  '🎮', '🎬', '🎵', '📚', '🎨', '📷', '🎣', '🧩', '🎯', '🧗', '🚴', '🏊',
] as const;

const CELEBRATIONS_EMOJI = [
  '🎉', '🎂', '🎁', '🎊', '🥳', '💍', '🎄', '🎆', '🪅', '🍾',
] as const;

const PEOPLE_EMOJI = [
  '👥', '❤️', '👨‍👩‍👧‍👦', '👫', '💑', '🤝', '👶', '🧑‍🤝‍🧑', '💌', '🫂',
] as const;

const SPORTS_EMOJI = [
  '⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏓', '🥊', '🏋️', '⛳',
] as const;

const MISC_EMOJI = [
  '💼', '📋', '🧾', '💸', '🛒', '🐾', '🎓', '🛠️',
  '💻', '📅', '🌟', '📦', '🚌', '🏝️', '🌆', '🧭', '🎪', '🚂',
] as const;

export const GROUP_EMOJI_CHOICES = [
  ...TRAVEL_EMOJI,
  ...HOME_EMOJI,
  ...FOOD_DRINK_EMOJI,
  ...ACTIVITIES_EMOJI,
  ...CELEBRATIONS_EMOJI,
  ...PEOPLE_EMOJI,
  ...SPORTS_EMOJI,
  ...MISC_EMOJI,
] as const;

// WI-031: search keywords for the group emoji picker. Presentational only —
// does not change the emoji inventory (GROUP_EMOJI_CHOICES) or storage. Each
// emoji maps to a space-separated, lowercase keyword string; the picker
// matches a case-insensitive substring of the query against it. Baseline
// keywords derive from the existing named category groups (Travel/Home/Food &
// drink/Activities/Celebrations/People/Sports/Misc) plus a few specific terms
// per emoji. An emoji absent from the map falls back to matching nothing on a
// nonempty query but always shows on an empty query.
export const GROUP_EMOJI_KEYWORDS: Record<string, string> = {
  '✈️': 'travel plane airplane flight flying travel trip',
  '🧳': 'travel suitcase luggage packing travel trip',
  '🏖️': 'travel beach vacation travel trip sun',
  '⛷️': 'travel ski skiing snow winter sport travel',
  '🚗': 'travel car drive driving road trip travel',
  '🚕': 'travel taxi cab ride travel transport',
  '🚆': 'travel train rail travel transport',
  '🚢': 'travel ship boat cruise travel',
  '🗺️': 'travel map travel trip planning',
  '🏕️': 'travel camping tent outdoors travel',
  '🎿': 'travel ski skiing snow winter sport',
  '🚀': 'travel rocket space launch travel',
  '🛥️': 'travel yacht boat cruise travel',
  '🏔️': 'travel mountain hiking travel outdoors',
  '🏠': 'home house home roommates apartment',
  '🏡': 'home house home cozy',
  '🔑': 'home key keys lock roommates rent',
  '🛋️': 'home couch sofa furniture living room',
  '🧹': 'home broom cleaning chores',
  '🛏️': 'home bed bedroom sleep',
  '🚪': 'home door entrance apartment',
  '🪴': 'home plant decor home',
  '🔧': 'home wrench tools repair maintenance',
  '🧺': 'home laundry basket chores',
  '🍕': 'food & drink pizza food dinner',
  '🍔': 'food & drink burger food fast food',
  '🌮': 'food & drink taco food mexican',
  '🍜': 'food & drink noodles ramen food',
  '🍣': 'food & drink sushi food japanese',
  '🍰': 'food & drink cake dessert sweet food',
  '☕': 'food & drink coffee cafe drink',
  '🍻': 'food & drink beer drinks bar cheers',
  '🍷': 'food & drink wine drink alcohol',
  '🥂': 'food & drink champagne toast celebration drink',
  '🍳': 'food & drink breakfast eggs cooking food',
  '🥑': 'food & drink avocado food healthy',
  '🍩': 'food & drink donut dessert sweet food',
  '🍦': 'food & drink ice cream dessert sweet food',
  '🥘': 'food & drink paella cooking food dinner',
  '🍱': 'food & drink bento lunch food',
  '🎮': 'activities games gaming video games activities',
  '🎬': 'activities movies cinema film activities',
  '🎵': 'activities music activities',
  '📚': 'activities books reading study education',
  '🎨': 'activities art painting creative activities',
  '📷': 'activities camera photography activities',
  '🎣': 'activities fishing outdoors activities',
  '🧩': 'activities puzzle game activities',
  '🎯': 'activities darts target activities games',
  '🧗': 'activities climbing sport activities',
  '🚴': 'activities cycling biking sport activities',
  '🏊': 'activities swimming sport activities',
  '🎉': 'celebrations party celebration confetti',
  '🎂': 'celebrations birthday cake celebration party',
  '🎁': 'celebrations gift present celebration',
  '🎊': 'celebrations confetti party celebration',
  '🥳': 'celebrations party celebration festive',
  '💍': 'celebrations wedding engagement ring celebration',
  '🎄': 'celebrations christmas holiday celebration',
  '🎆': 'celebrations fireworks celebration party',
  '🪅': 'celebrations pinata party celebration',
  '🍾': 'celebrations champagne celebration party toast',
  '👥': 'people people group friends',
  '❤️': 'people love couple heart romance',
  '👨‍👩‍👧‍👦': 'people family people',
  '👫': 'people couple people friends',
  '💑': 'people couple romance love',
  '🤝': 'people handshake partnership friends deal',
  '👶': 'people baby family child',
  '🧑‍🤝‍🧑': 'people friends people partnership',
  '💌': 'people love letter romance',
  '🫂': 'people hug people friends',
  '⚽': 'sports soccer football sport',
  '🏀': 'sports basketball sport',
  '🏈': 'sports football american sport',
  '⚾': 'sports baseball sport',
  '🎾': 'sports tennis sport',
  '🏐': 'sports volleyball sport',
  '🏓': 'sports ping pong table tennis sport',
  '🥊': 'sports boxing sport',
  '🏋️': 'sports gym weights fitness sport',
  '⛳': 'sports golf sport',
  '💼': 'misc work business briefcase project',
  '📋': 'misc clipboard misc other',
  '🧾': 'misc receipt bill expense misc',
  '💸': 'misc money cash subscription payment',
  '🛒': 'misc shopping cart groceries misc',
  '🐾': 'misc pets animal paw misc',
  '🎓': 'misc school graduation education',
  '🛠️': 'misc tools work project misc',
  '💻': 'misc computer work laptop tech',
  '📅': 'misc calendar schedule misc',
  '🌟': 'misc star misc favorite',
  '📦': 'misc box package misc shipping',
  '🚌': 'misc bus transport misc',
  '🏝️': 'misc island beach vacation travel',
  '🌆': 'misc city skyline misc',
  '🧭': 'misc compass travel adventure misc',
  '🎪': 'misc circus tent event misc',
  '🚂': 'misc train transport travel misc',
};

/** Emoji whose keywords contain the (lowercased, trimmed) query; empty query = all. */
export function searchGroupEmoji(query: string): readonly string[] {
  const q = query.trim().toLowerCase();
  if (q === '') return GROUP_EMOJI_CHOICES;
  return GROUP_EMOJI_CHOICES.filter((emoji) => (GROUP_EMOJI_KEYWORDS[emoji] ?? '').includes(q));
}

// Group-creation templates — WI-020. Presentational suggestions surfaced in the
// group-creation form ONLY (web + mobile), keyed by the existing GroupType enum.
// Each entry names a curated subset of the expenses-owned EXPENSE_CATEGORY_KEYS and
// one member of the expenses-owned SPLIT_TYPES — read-only references, not copies.
// Pre-fill only: NOTHING here is written to Group or any Expense* record, and (per
// Checkpoint 1, 2026-07-15) template selections do NOT carry forward to seed the
// first expense — that proposal was declined. Types with no entry render no
// suggestion (graceful degradation).
export interface GroupTemplate {
  /** Suggested default expense categories (subset of EXPENSE_CATEGORY_KEYS). */
  categoryKeys: readonly ExpenseCategory[];
  /** Suggested default split mode (member of SPLIT_TYPES). */
  splitType: SplitType;
}

export const GROUP_TEMPLATES: Partial<Record<GroupType, GroupTemplate>> = {
  ROOMMATES: { categoryKeys: ['RENT', 'UTILITIES', 'GROCERIES', 'HOME'], splitType: 'EQUAL' },
  HOME: { categoryKeys: ['RENT', 'UTILITIES', 'HOME', 'GROCERIES'], splitType: 'EQUAL' },
  TRIP: { categoryKeys: ['TRAVEL', 'FOOD_DRINK', 'TRANSPORT', 'ENTERTAINMENT'], splitType: 'EQUAL' },
  COUPLE: { categoryKeys: ['GROCERIES', 'FOOD_DRINK', 'RENT', 'ENTERTAINMENT'], splitType: 'EQUAL' },
  FAMILY: { categoryKeys: ['GROCERIES', 'HOME', 'UTILITIES', 'HEALTH', 'EDUCATION'], splitType: 'EQUAL' },
  NIGHT_OUT: { categoryKeys: ['FOOD_DRINK', 'ENTERTAINMENT', 'TRANSPORT'], splitType: 'EQUAL' },
  EVENT: { categoryKeys: ['FOOD_DRINK', 'ENTERTAINMENT', 'SHOPPING'], splitType: 'EQUAL' },
};

/** undefined = this type has no curated template (render no suggestion block). */
export function groupTemplate(type: GroupType): GroupTemplate | undefined {
  return GROUP_TEMPLATES[type];
}

// Presentational labels for the suggested split mode. Keys are forced exhaustive
// over the expenses-owned SPLIT_TYPES by Record<SplitType, string>, so this cannot
// drift from that enum. Display-only; does not redefine SplitType. (If expenses
// later exposes a shared split-label source, prefer it — none exists today.)
export const SPLIT_TYPE_LABELS: Record<SplitType, string> = {
  EQUAL: 'Equal',
  EXACT: 'Exact amounts',
  PERCENT: 'Percentages',
  SHARES: 'Shares',
  ADJUSTMENT: 'Adjustment',
  ITEMIZED: 'Itemized',
};

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

// ---------------------------------------------------------------------------
// Notification preferences (WI-041, auth's slice / ADR-021)
// ---------------------------------------------------------------------------
// Canonical category enum, consumed by BOTH auth (storage/UI) and
// notifications-activity (send-time gating) — single source of truth, do not
// redeclare in either domain. Must stay byte-identical to the Prisma
// `NotificationCategory` enum in apps/api/prisma/schema.prisma (DRB condition
// C2 — manual-sync contract, same as SettlementMethod <-> SETTLEMENT_METHOD_KEYS).
//
// `available: true` (6) map to an existing trigger and are behaviorally live
// once notifications-activity wires the send-time gate. `available: false`
// (3) are reserved enum slots only — [PROPOSAL — requires client signoff],
// no trigger/content source exists yet; UI renders them disabled/"coming soon"
// and must never send them in a PATCH.
export const NOTIFICATION_CATEGORIES = [
  { key: 'EXPENSE_ADDED', available: true },
  { key: 'EXPENSE_EDITED', available: true },
  { key: 'EXPENSE_DELETED', available: true },
  { key: 'COMMENT', available: true },
  { key: 'PAYMENT_RECEIVED', available: true },
  { key: 'GROUP_INVITE', available: true },
  { key: 'EXPENSE_DUE', available: false },
  { key: 'MONTHLY_SUMMARY', available: false },
  { key: 'PRODUCT_NEWS', available: false },
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]['key'];
export const NOTIFICATION_CATEGORY_KEYS = NOTIFICATION_CATEGORIES.map((c) => c.key) as [
  NotificationCategory,
  ...NotificationCategory[],
];
export const zNotificationCategory = z.enum(NOTIFICATION_CATEGORY_KEYS);

/** true iff the category has a live trigger wired (send-time gating is notifications-activity's slice). */
export function isAvailableNotificationCategory(key: string): boolean {
  return NOTIFICATION_CATEGORIES.some((c) => c.key === key && c.available);
}

export const LIMITS = {
  NAME_MAX: 60,
  EMAIL_MAX: 254,
  /** "+" + up to 15 digits (E.164 hard cap) — WI-045. */
  PHONE_MAX: 16,
  PASSWORD_MIN: 8,
  PASSWORD_MAX: 128,
  DESCRIPTION_MAX: 140,
  NOTES_MAX: 2000,
  COMMENT_MAX: 1000,
  GROUP_NAME_MAX: 60,
  GROUP_WHITEBOARD_BODY_MAX: 2000,
  MAX_PAYERS: 20,
  MAX_PARTICIPANTS: 50,
  MAX_ITEMS: 100,
  PAGE_SIZE_DEFAULT: 20,
  PAGE_SIZE_MAX: 100,
} as const;
