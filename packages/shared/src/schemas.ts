import { z } from 'zod';
import {
  EXPENSE_CATEGORY_KEYS,
  GROUP_TYPE_KEYS,
  LIMITS,
  NOTIFICATION_CATEGORY_KEYS,
  RECURRENCE_FREQUENCY_KEYS,
  SETTLEMENT_METHOD_KEYS,
  zNotificationCategory,
} from './constants';
import { MAX_AMOUNT_MINOR } from './money';
import { SPLIT_TYPES } from './split';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const zId = z.string().min(8).max(64);
export const zCurrency = z
  .string()
  .length(3)
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/));
/** Positive integer amount in minor units. */
export const zMoney = z.number().int().positive().max(MAX_AMOUNT_MINOR);
/** Non-negative integer amount in minor units. */
export const zMoneyNonNeg = z.number().int().min(0).max(MAX_AMOUNT_MINOR);
/** Signed integer amount in minor units. */
export const zMoneySigned = z.number().int().min(-MAX_AMOUNT_MINOR).max(MAX_AMOUNT_MINOR);
export const zIsoDateTime = z.string().datetime({ offset: true });
export const zEmail = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(LIMITS.EMAIL_MAX);
export const zHexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/**
 * E.164-ish: leading "+", first digit after it non-zero, 7-14 more digits
 * (8-15 digits total after the "+") — the practical range real numbering
 * plans use, matching the E.164 hard cap of 15 total digits. Formatting
 * characters (spaces, hyphens, dots, parens) are stripped before the regex
 * check, so "+1 415-555-2671" and "+14155552671" normalize to the same
 * canonical stored/compared value (mirrors zEmail's trim+lowercase
 * normalization-before-uniqueness-check pattern). WI-045.
 */
export const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;
export const zPhone = z
  .string()
  .trim()
  .transform((s) => s.replace(/[\s().-]/g, ''))
  .pipe(z.string().max(LIMITS.PHONE_MAX).regex(PHONE_PATTERN));

/**
 * WI-035 / DRB security condition (blocking): `avatarUrl` must be constrained
 * to a path this server's own `POST /uploads/avatars` handler can produce —
 * `randomBytes(16).toString('hex')` (32 lowercase hex chars) + the extension
 * for one of the route's own image MIME allow-list entries. This is NOT a
 * bare `.max(500)` string: an unconstrained string lets a client point their
 * public avatar at an arbitrary external URL (tracking/deanonymization) or at
 * another domain's `/uploads/<kind>/...` asset. Reject anything else with a
 * zod validation error (400), never trust the client's URL shape.
 */
export const AVATAR_URL_PATTERN = /^\/uploads\/avatars\/[a-f0-9]{32}\.(jpg|png|webp|heic|heif)$/;
export const zAvatarUrl = z.string().regex(AVATAR_URL_PATTERN);

export const zSplitType = z.enum(SPLIT_TYPES);
export const zExpenseCategory = z.enum(EXPENSE_CATEGORY_KEYS);
export const zGroupType = z.enum(GROUP_TYPE_KEYS);
export const zSettlementMethod = z.enum(SETTLEMENT_METHOD_KEYS);
export const zRecurrenceFrequency = z.enum(RECURRENCE_FREQUENCY_KEYS);
export const zMemberRole = z.enum(['ADMIN', 'MEMBER']);

export const zPaginationQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.PAGE_SIZE_MAX).default(LIMITS.PAGE_SIZE_DEFAULT),
});
export type PaginationQuery = z.infer<typeof zPaginationQuery>;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const zRegisterInput = z.object({
  name: z.string().trim().min(1).max(LIMITS.NAME_MAX),
  email: zEmail,
  password: z.string().min(LIMITS.PASSWORD_MIN).max(LIMITS.PASSWORD_MAX),
  defaultCurrency: zCurrency.optional(),
});
export type RegisterInput = z.infer<typeof zRegisterInput>;

/**
 * WI-045 (ADR-024, Q1): single "identifier" field, server-side classified as
 * email- or phone-shaped by a `.transform` (the two shapes never overlap —
 * emails always contain "@", E.164 phones never do). Exactly one targeted
 * lookup runs downstream per `kind`, never both — see routes/auth.ts.
 */
export const zLoginInput = z
  .object({
    identifier: z.string().trim().min(1).max(254),
    password: z.string().min(1).max(LIMITS.PASSWORD_MAX),
  })
  .transform((data, ctx) => {
    const email = zEmail.safeParse(data.identifier);
    if (email.success) return { kind: 'email' as const, identifier: email.data, password: data.password };
    const phone = zPhone.safeParse(data.identifier);
    if (phone.success) return { kind: 'phone' as const, identifier: phone.data, password: data.password };
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['identifier'],
      message: 'Enter a valid email or phone number',
    });
    return z.NEVER;
  });
export type LoginInput = z.infer<typeof zLoginInput>;

/** Refresh token comes from an httpOnly cookie (web) or the body (mobile). */
export const zRefreshInput = z.object({
  refreshToken: z.string().min(1).optional(),
});
export type RefreshInput = z.infer<typeof zRefreshInput>;

export const zChangePasswordInput = z.object({
  currentPassword: z.string().min(1).max(LIMITS.PASSWORD_MAX),
  newPassword: z.string().min(LIMITS.PASSWORD_MIN).max(LIMITS.PASSWORD_MAX),
});
export type ChangePasswordInput = z.infer<typeof zChangePasswordInput>;

export const zUpdateMeInput = z.object({
  name: z.string().trim().min(1).max(LIMITS.NAME_MAX).optional(),
  avatarColor: zHexColor.optional(),
  /** string sets (must be a `/uploads/avatars/...` path this server produced), null clears, omitted leaves unchanged. */
  avatarUrl: zAvatarUrl.nullable().optional(),
  defaultCurrency: zCurrency.optional(),
  emailNotifications: z.boolean().optional(),
  staleBalanceRemindersEnabled: z.boolean().optional(),
  /** string sets (validated E.164-ish, must be globally unique), null clears, omitted leaves unchanged. WI-045. */
  phone: zPhone.nullable().optional(),
});
export type UpdateMeInput = z.infer<typeof zUpdateMeInput>;

export const zRegisterPushTokenInput = z.object({
  token: z.string().min(1).max(200),
  platform: z.enum(['ios', 'android']),
});
export type RegisterPushTokenInput = z.infer<typeof zRegisterPushTokenInput>;

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export const zCreateGroupInput = z.object({
  name: z.string().trim().min(1).max(LIMITS.GROUP_NAME_MAX),
  emoji: z.string().trim().min(1).max(8).optional(),
  type: zGroupType.default('OTHER'),
  currency: zCurrency.default('USD'),
  simplifyDebts: z.boolean().default(true),
});
export type CreateGroupInput = z.infer<typeof zCreateGroupInput>;

export const zUpdateGroupInput = z.object({
  name: z.string().trim().min(1).max(LIMITS.GROUP_NAME_MAX).optional(),
  emoji: z.string().trim().min(1).max(8).optional(),
  type: zGroupType.optional(),
  currency: zCurrency.optional(),
  simplifyDebts: z.boolean().optional(),
});
export type UpdateGroupInput = z.infer<typeof zUpdateGroupInput>;

export const zJoinGroupInput = z.object({
  code: z.string().trim().min(4).max(32),
});
export type JoinGroupInput = z.infer<typeof zJoinGroupInput>;

export const zAddMemberInput = z.object({
  email: zEmail,
});
export type AddMemberInput = z.infer<typeof zAddMemberInput>;

export const zUpdateMemberInput = z.object({
  role: zMemberRole,
});
export type UpdateMemberInput = z.infer<typeof zUpdateMemberInput>;

/** POST /groups/:groupId/members/by-friend (WI-042) — add an existing friend by userId. */
export const zAddMemberByFriendInput = z.object({
  userId: zId,
});
export type AddMemberByFriendInput = z.infer<typeof zAddMemberByFriendInput>;

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export const zExpensePayerInput = z.object({
  userId: zId,
  amount: zMoney,
});
export type ExpensePayerInput = z.infer<typeof zExpensePayerInput>;

export const zExpenseParticipantInput = z.object({
  userId: zId,
  amount: zMoneyNonNeg.optional(),
  percentBps: z.number().int().min(0).max(10000).optional(),
  shares: z.number().int().min(0).max(1_000_000).optional(),
  adjustment: zMoneySigned.optional(),
});
export type ExpenseParticipantInput = z.infer<typeof zExpenseParticipantInput>;

export const zExpenseItemInput = z.object({
  name: z.string().trim().min(1).max(LIMITS.DESCRIPTION_MAX),
  amount: zMoney,
  participantIds: z.array(zId).min(1).max(LIMITS.MAX_PARTICIPANTS),
});
export type ExpenseItemInput = z.infer<typeof zExpenseItemInput>;

const expenseCore = {
  description: z.string().trim().min(1).max(LIMITS.DESCRIPTION_MAX),
  amount: zMoney,
  currency: zCurrency,
  category: zExpenseCategory.default('GENERAL'),
  date: zIsoDateTime,
  splitType: zSplitType,
  payers: z.array(zExpensePayerInput).min(1).max(LIMITS.MAX_PAYERS),
  participants: z.array(zExpenseParticipantInput).min(1).max(LIMITS.MAX_PARTICIPANTS),
  items: z.array(zExpenseItemInput).max(LIMITS.MAX_ITEMS).optional(),
  notes: z.string().trim().max(LIMITS.NOTES_MAX).optional(),
  receiptUrl: z.string().trim().max(500).optional(),
};

function refineExpense(data: {
  amount: number;
  payers: ExpensePayerInput[];
  participants: ExpenseParticipantInput[];
  splitType: (typeof SPLIT_TYPES)[number];
  items?: ExpenseItemInput[];
}, ctx: z.RefinementCtx) {
  const payerSum = data.payers.reduce((acc, p) => acc + p.amount, 0);
  if (payerSum !== data.amount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['payers'],
      message: `Payer amounts must sum to the expense amount (${payerSum} != ${data.amount})`,
    });
  }
  const payerIds = new Set(data.payers.map((p) => p.userId));
  if (payerIds.size !== data.payers.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['payers'], message: 'Duplicate payer' });
  }
  const participantIds = new Set(data.participants.map((p) => p.userId));
  if (participantIds.size !== data.participants.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['participants'], message: 'Duplicate participant' });
  }
  if (data.splitType === 'ITEMIZED' && (!data.items || data.items.length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'Itemized expenses need at least one item' });
  }
}

/**
 * groupId omitted/null = non-group expense shared directly between the users
 * involved (they become friends automatically).
 */
export const zCreateExpenseInput = z
  .object({ groupId: zId.nullish(), ...expenseCore })
  .superRefine(refineExpense);
export type CreateExpenseInput = z.infer<typeof zCreateExpenseInput>;

/** Full replacement of the splittable fields — same shape as create, sans groupId. */
export const zUpdateExpenseInput = z.object(expenseCore).superRefine(refineExpense);
export type UpdateExpenseInput = z.infer<typeof zUpdateExpenseInput>;

export const zListExpensesQuery = zPaginationQuery.extend({
  groupId: zId.optional(),
  /** Filter to expenses shared with this friend (any group + non-group). */
  friendId: zId.optional(),
  category: zExpenseCategory.optional(),
  search: z.string().trim().max(100).optional(),
});
export type ListExpensesQuery = z.infer<typeof zListExpensesQuery>;

/** WI-032 / WI-063 / WI-064: GET /expenses/used-categories — scope by group XOR friend, or neither (unscoped = all of the caller's expenses). */
export const zUsedCategoriesQuery = z
  .object({ groupId: zId.optional(), friendId: zId.optional() })
  .refine((q) => (q.groupId ? 1 : 0) + (q.friendId ? 1 : 0) <= 1, {
    message: 'Provide at most one of groupId or friendId',
  });
export type UsedCategoriesQuery = z.infer<typeof zUsedCategoriesQuery>;

// ---------------------------------------------------------------------------
// Settlements
// ---------------------------------------------------------------------------

export const zCreateSettlementInput = z
  .object({
    groupId: zId.nullish(),
    fromUserId: zId,
    toUserId: zId,
    amount: zMoney,
    currency: zCurrency,
    method: zSettlementMethod.default('OTHER'),
    note: z.string().trim().max(LIMITS.NOTES_MAX).optional(),
    proofUrl: z.string().trim().max(500).optional(),
    date: zIsoDateTime,
  })
  .superRefine((data, ctx) => {
    if (data.fromUserId === data.toUserId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['toUserId'],
        message: 'Payer and recipient must differ',
      });
    }
  });
export type CreateSettlementInput = z.infer<typeof zCreateSettlementInput>;

export const zListSettlementsQuery = zPaginationQuery.extend({
  groupId: zId.optional(),
  friendId: zId.optional(),
});
export type ListSettlementsQuery = z.infer<typeof zListSettlementsQuery>;

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------

/**
 * WI-045 (mirrors zLoginInput / ADR-024 decision 2): a single "identifier"
 * field, classified as email- or phone-shaped by a `.transform` (the two
 * shapes never overlap — emails always contain "@", E.164 phones never do).
 * Exactly one targeted findUnique runs downstream per `kind`, never both —
 * see routes/friends.ts. Reuses the shared zEmail/zPhone; no second phone
 * regex. A string matching neither shape is a pre-lookup 400 (reveals nothing
 * about account existence — same safety property as zLoginInput).
 */
export const zAddFriendInput = z
  .object({
    identifier: z.string().trim().min(1).max(254),
  })
  .transform((data, ctx) => {
    const email = zEmail.safeParse(data.identifier);
    if (email.success) return { kind: 'email' as const, identifier: email.data };
    const phone = zPhone.safeParse(data.identifier);
    if (phone.success) return { kind: 'phone' as const, identifier: phone.data };
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['identifier'],
      message: 'Enter a valid email or phone number',
    });
    return z.NEVER;
  });
export type AddFriendInput = z.infer<typeof zAddFriendInput>;

/** POST /friends/add-by-code (WI-040) — mirrors zJoinGroupInput's shape/limits. */
export const zAddFriendByCodeInput = z.object({
  code: z.string().trim().min(4).max(32),
});
export type AddFriendByCodeInput = z.infer<typeof zAddFriendByCodeInput>;

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export const zCreateCommentInput = z.object({
  body: z.string().trim().min(1).max(LIMITS.COMMENT_MAX),
});
export type CreateCommentInput = z.infer<typeof zCreateCommentInput>;

// ---------------------------------------------------------------------------
// Recurring expenses
// ---------------------------------------------------------------------------

export const zCreateRecurringInput = z
  .object({
    groupId: zId.nullish(),
    description: z.string().trim().min(1).max(LIMITS.DESCRIPTION_MAX),
    amount: zMoney,
    currency: zCurrency,
    category: zExpenseCategory.default('GENERAL'),
    splitType: zSplitType,
    payers: z.array(zExpensePayerInput).min(1).max(LIMITS.MAX_PAYERS),
    participants: z.array(zExpenseParticipantInput).min(1).max(LIMITS.MAX_PARTICIPANTS),
    notes: z.string().trim().max(LIMITS.NOTES_MAX).optional(),
    frequency: zRecurrenceFrequency,
    /** First occurrence date (ISO). */
    startDate: zIsoDateTime,
    endDate: zIsoDateTime.optional(),
  })
  .superRefine((data, ctx) => {
    const payerSum = data.payers.reduce((acc, p) => acc + p.amount, 0);
    if (payerSum !== data.amount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payers'],
        message: `Payer amounts must sum to the expense amount (${payerSum} != ${data.amount})`,
      });
    }
    if (data.splitType === 'ITEMIZED') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['splitType'],
        message: 'Recurring expenses do not support itemized splits',
      });
    }
  });
export type CreateRecurringInput = z.infer<typeof zCreateRecurringInput>;

export const zUpdateRecurringInput = z.object({
  active: z.boolean().optional(),
  description: z.string().trim().min(1).max(LIMITS.DESCRIPTION_MAX).optional(),
  amount: zMoney.optional(),
  frequency: zRecurrenceFrequency.optional(),
  endDate: zIsoDateTime.nullable().optional(),
});
export type UpdateRecurringInput = z.infer<typeof zUpdateRecurringInput>;

// ---------------------------------------------------------------------------
// Activity / notifications
// ---------------------------------------------------------------------------

export const zActivityQuery = zPaginationQuery.extend({
  groupId: zId.optional(),
});
export type ActivityQuery = z.infer<typeof zActivityQuery>;

export const zNotificationsQuery = zPaginationQuery.extend({
  unreadOnly: z.coerce.boolean().default(false),
});
export type NotificationsQuery = z.infer<typeof zNotificationsQuery>;

// ---------------------------------------------------------------------------
// Notification preferences (WI-041, auth's slice)
// ---------------------------------------------------------------------------

/**
 * PATCH /users/me/notification-preferences body. Deliberately carries only
 * `{ category, pushEnabled?, emailEnabled? }[]` — NO userId anywhere in the
 * shape (DRB security condition — the IDOR guard; userId always comes from
 * `request.userId` server-side, never from client input). Unknown category or
 * non-boolean channel value fails this schema with a 400, never silently
 * dropped or partially applied.
 */
export const zUpdateNotificationPreferencesInput = z.object({
  preferences: z
    .array(
      z.object({
        category: zNotificationCategory,
        pushEnabled: z.boolean().optional(),
        emailEnabled: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(NOTIFICATION_CATEGORY_KEYS.length),
});
export type UpdateNotificationPreferencesInput = z.infer<
  typeof zUpdateNotificationPreferencesInput
>;

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export const zAnalyticsQuery = z.object({
  /** ISO datetime range; defaults to last 6 months on the server. */
  from: zIsoDateTime.optional(),
  to: zIsoDateTime.optional(),
  groupId: zId.optional(),
  /** Currency to convert all amounts into. Defaults to the user's default currency. */
  currency: zCurrency.optional(),
});
export type AnalyticsQuery = z.infer<typeof zAnalyticsQuery>;

// ---------------------------------------------------------------------------
// Manual FX rates (WI-002 — per-user fallback when the automatic chain misses)
// ---------------------------------------------------------------------------

/** "1 from = ? to" — rate is units of `to` per 1 unit of `from`. */
export const zManualRateInput = z
  .object({
    from: zCurrency,
    to: zCurrency,
    rate: z.number().positive().finite(),
  })
  .refine((data) => data.from !== data.to, {
    message: 'from and to must be different currencies',
    path: ['to'],
  });
export type ManualRateInput = z.infer<typeof zManualRateInput>;

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** WI-045: phone-aware search — exactly one of email/phone (XOR), preserving the existing single-identifier-in/single-result-or-null-out contract (rule 11). */
export const zUserSearchQuery = z
  .object({
    email: zEmail.optional(),
    phone: zPhone.optional(),
  })
  .refine((data) => Boolean(data.email) !== Boolean(data.phone), {
    message: 'Provide exactly one of email or phone',
  });
export type UserSearchQuery = z.infer<typeof zUserSearchQuery>;
