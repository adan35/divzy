import { z } from 'zod';
import {
  EXPENSE_CATEGORY_KEYS,
  GROUP_TYPE_KEYS,
  LIMITS,
  RECURRENCE_FREQUENCY_KEYS,
  SETTLEMENT_METHOD_KEYS,
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

export const zLoginInput = z.object({
  email: zEmail,
  password: z.string().min(1).max(LIMITS.PASSWORD_MAX),
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
  defaultCurrency: zCurrency.optional(),
  emailNotifications: z.boolean().optional(),
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

export const zAddFriendInput = z.object({
  email: zEmail,
});
export type AddFriendInput = z.infer<typeof zAddFriendInput>;

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
// Search
// ---------------------------------------------------------------------------

export const zUserSearchQuery = z.object({
  email: zEmail,
});
export type UserSearchQuery = z.infer<typeof zUserSearchQuery>;
