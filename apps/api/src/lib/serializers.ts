import type { Notification, Prisma, User } from '@prisma/client';
import type {
  ActivityDto,
  ActivityType,
  CommentDto,
  ExpenseDto,
  ExpenseFieldChange,
  ExpenseRevisionDto,
  GroupDto,
  GroupMemberDto,
  GroupWhiteboardDto,
  NotificationDto,
  NotificationType,
  PublicUserDto,
  RecurringExpenseDto,
  SettlementDto,
  UserDto,
} from '@divzy/shared';

// ---------------------------------------------------------------------------
// Standard selects / includes — every route loads relations through these so
// the DTO serializers below always have what they need.
// ---------------------------------------------------------------------------

export const publicUserSelect = {
  id: true,
  name: true,
  avatarColor: true,
  avatarUrl: true,
} as const;

const groupSummarySelect = { id: true, name: true, emoji: true } as const;

// Expense rows additionally need the group's home currency (WI-014, spec §3)
// to compute/render a converted figure — scoped to expenses only so the
// settlement/activity/recurring DTO paths don't load a field they never use.
const expenseGroupSelect = { id: true, name: true, emoji: true, currency: true } as const;

export const expenseInclude = {
  payers: { include: { user: { select: publicUserSelect } } },
  splits: { include: { user: { select: publicUserSelect } } },
  items: true,
  group: { select: expenseGroupSelect },
  createdBy: { select: publicUserSelect },
  updatedBy: { select: publicUserSelect },
  _count: { select: { comments: true } },
} as const satisfies Prisma.ExpenseInclude;

export const groupInclude = {
  members: { include: { user: { select: publicUserSelect } } },
  createdBy: { select: publicUserSelect },
} as const satisfies Prisma.GroupInclude;

export const settlementInclude = {
  fromUser: { select: publicUserSelect },
  toUser: { select: publicUserSelect },
  createdBy: { select: publicUserSelect },
  group: { select: groupSummarySelect },
} as const satisfies Prisma.SettlementInclude;

export const commentInclude = {
  author: { select: publicUserSelect },
} as const satisfies Prisma.CommentInclude;

export const activityInclude = {
  actor: { select: publicUserSelect },
  group: { select: groupSummarySelect },
} as const satisfies Prisma.ActivityLogInclude;

export const recurringInclude = {
  group: { select: groupSummarySelect },
} as const satisfies Prisma.RecurringExpenseInclude;

export const expenseRevisionInclude = {
  actor: { select: publicUserSelect },
} as const satisfies Prisma.ExpenseRevisionInclude;

// ---------------------------------------------------------------------------
// Prisma payload types matching the includes above.
// ---------------------------------------------------------------------------

export type PublicUserPayload = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;
export type ExpenseWithRelations = Prisma.ExpenseGetPayload<{ include: typeof expenseInclude }>;
export type GroupWithRelations = Prisma.GroupGetPayload<{ include: typeof groupInclude }>;
export type GroupMemberWithUser = Prisma.GroupMemberGetPayload<{
  include: { user: { select: typeof publicUserSelect } };
}>;
export type SettlementWithRelations = Prisma.SettlementGetPayload<{
  include: typeof settlementInclude;
}>;
export type CommentWithRelations = Prisma.CommentGetPayload<{ include: typeof commentInclude }>;
export type ActivityWithRelations = Prisma.ActivityLogGetPayload<{
  include: typeof activityInclude;
}>;
export type RecurringWithRelations = Prisma.RecurringExpenseGetPayload<{
  include: typeof recurringInclude;
}>;
export type ExpenseRevisionWithRelations = Prisma.ExpenseRevisionGetPayload<{
  include: typeof expenseRevisionInclude;
}>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Narrow an arbitrary Prisma Json value to the DTO `Record<string, unknown>`. */
function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const KNOWN_EXPENSE_FIELD_CHANGE_FIELDS = new Set<ExpenseFieldChange['field']>([
  'description',
  'amount',
  'currency',
  'category',
  'date',
  'splitType',
  'notes',
  'receiptUrl',
]);

/** Narrow the untyped `ExpenseRevision.changes` Json into `ExpenseFieldChange[]`. */
function toExpenseFieldChanges(value: unknown): ExpenseFieldChange[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (el): el is ExpenseFieldChange =>
      typeof el === 'object' &&
      el !== null &&
      'field' in el &&
      KNOWN_EXPENSE_FIELD_CHANGE_FIELDS.has((el as { field: ExpenseFieldChange['field'] }).field),
  );
}

// ---------------------------------------------------------------------------
// Serializers — Prisma payloads in, shared DTOs out. Dates → ISO strings.
// ---------------------------------------------------------------------------

export function toPublicUser(user: PublicUserPayload): PublicUserDto {
  return { id: user.id, name: user.name, avatarColor: user.avatarColor, avatarUrl: user.avatarUrl };
}

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    name: user.name,
    avatarColor: user.avatarColor,
    avatarUrl: user.avatarUrl,
    email: user.email,
    phone: user.phone,
    defaultCurrency: user.defaultCurrency,
    emailNotifications: user.emailNotifications,
    staleBalanceRemindersEnabled: user.staleBalanceRemindersEnabled,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toGroupMemberDto(member: GroupMemberWithUser): GroupMemberDto {
  return {
    user: toPublicUser(member.user),
    role: member.role,
    joinedAt: member.joinedAt.toISOString(),
  };
}

export function toGroupDto(group: GroupWithRelations): GroupDto {
  const activeMembers = group.members
    .filter((m) => m.leftAt === null)
    .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
  return {
    id: group.id,
    name: group.name,
    emoji: group.emoji,
    type: group.type,
    currency: group.currency,
    inviteCode: group.inviteCode,
    simplifyDebts: group.simplifyDebts,
    createdBy: toPublicUser(group.createdBy),
    members: activeMembers.map(toGroupMemberDto),
    archivedAt: group.archivedAt ? group.archivedAt.toISOString() : null,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  };
}

export function toGroupWhiteboardDto(
  whiteboard: { body: string; updatedById: string | null; updatedAt: Date },
  editor: PublicUserPayload | null,
): GroupWhiteboardDto {
  return {
    body: whiteboard.body,
    updatedBy: editor ? toPublicUser(editor) : null,
    updatedAt: whiteboard.updatedAt.toISOString(),
  };
}

export function toExpenseDto(expense: ExpenseWithRelations): ExpenseDto {
  return {
    id: expense.id,
    groupId: expense.groupId,
    group: expense.group
      ? {
          id: expense.group.id,
          name: expense.group.name,
          emoji: expense.group.emoji,
          currency: expense.group.currency,
        }
      : null,
    description: expense.description,
    amount: expense.amount,
    currency: expense.currency,
    category: expense.category,
    date: expense.date.toISOString(),
    splitType: expense.splitType,
    notes: expense.notes,
    receiptUrl: expense.receiptUrl,
    payers: expense.payers.map((p) => ({ user: toPublicUser(p.user), amount: p.amount })),
    splits: expense.splits.map((s) => ({
      user: toPublicUser(s.user),
      amount: s.amount,
      shares: s.shares,
      percentBps: s.percentBps,
      adjustment: s.adjustment,
    })),
    items: expense.items.map((i) => ({
      id: i.id,
      name: i.name,
      amount: i.amount,
      participantIds: i.participantIds,
    })),
    createdBy: toPublicUser(expense.createdBy),
    updatedBy: expense.updatedBy ? toPublicUser(expense.updatedBy) : null,
    commentCount: expense._count.comments,
    deletedAt: expense.deletedAt ? expense.deletedAt.toISOString() : null,
    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString(),
  };
}

export function toSettlementDto(settlement: SettlementWithRelations): SettlementDto {
  return {
    id: settlement.id,
    groupId: settlement.groupId,
    group: settlement.group
      ? { id: settlement.group.id, name: settlement.group.name, emoji: settlement.group.emoji }
      : null,
    from: toPublicUser(settlement.fromUser),
    to: toPublicUser(settlement.toUser),
    amount: settlement.amount,
    currency: settlement.currency,
    method: settlement.method,
    note: settlement.note,
    proofUrl: settlement.proofUrl,
    date: settlement.date.toISOString(),
    createdBy: toPublicUser(settlement.createdBy),
    deletedAt: settlement.deletedAt ? settlement.deletedAt.toISOString() : null,
    createdAt: settlement.createdAt.toISOString(),
  };
}

export function toCommentDto(comment: CommentWithRelations): CommentDto {
  return {
    id: comment.id,
    expenseId: comment.expenseId,
    author: toPublicUser(comment.author),
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
  };
}

export function toActivityDto(activity: ActivityWithRelations): ActivityDto {
  return {
    id: activity.id,
    type: activity.type as ActivityType,
    actor: toPublicUser(activity.actor),
    group: activity.group
      ? { id: activity.group.id, name: activity.group.name, emoji: activity.group.emoji }
      : null,
    expenseId: activity.expenseId,
    settlementId: activity.settlementId,
    data: toRecord(activity.data),
    // Viewer-agnostic by design (spec-WI-054 §2) — the route enriches this
    // per-caller; a freshly created row (the activity:new socket emit) is
    // correctly deletedAt: null.
    deletedAt: null,
    // Viewer-agnostic by design (spec-WI-055 §3) — the route computes this
    // per-caller alongside deletedAt.
    colorHint: null,
    createdAt: activity.createdAt.toISOString(),
  };
}

export function toNotificationDto(notification: Notification): NotificationDto {
  return {
    id: notification.id,
    type: notification.type as NotificationType,
    title: notification.title,
    body: notification.body,
    data: toRecord(notification.data),
    readAt: notification.readAt ? notification.readAt.toISOString() : null,
    clearedAt: notification.clearedAt ? notification.clearedAt.toISOString() : null,
    createdAt: notification.createdAt.toISOString(),
  };
}

export function toExpenseRevisionDto(r: ExpenseRevisionWithRelations): ExpenseRevisionDto {
  return {
    id: r.id,
    expenseId: r.expenseId,
    actor: toPublicUser(r.actor),
    kind: r.kind,
    changes: toExpenseFieldChanges(r.changes),
    createdAt: r.createdAt.toISOString(),
  };
}

export function toRecurringDto(recurring: RecurringWithRelations): RecurringExpenseDto {
  return {
    id: recurring.id,
    groupId: recurring.groupId,
    group: recurring.group
      ? { id: recurring.group.id, name: recurring.group.name, emoji: recurring.group.emoji }
      : null,
    description: recurring.description,
    amount: recurring.amount,
    currency: recurring.currency,
    category: recurring.category,
    splitType: recurring.splitType,
    payers: (Array.isArray(recurring.payers) ? recurring.payers : []) as unknown as Array<{
      userId: string;
      amount: number;
    }>,
    participants: (Array.isArray(recurring.participants)
      ? recurring.participants
      : []) as unknown as Array<{
      userId: string;
      amount?: number;
      percentBps?: number;
      shares?: number;
      adjustment?: number;
    }>,
    notes: recurring.notes,
    frequency: recurring.frequency,
    nextRunAt: recurring.nextRunAt.toISOString(),
    endDate: recurring.endDate ? recurring.endDate.toISOString() : null,
    lastRunAt: recurring.lastRunAt ? recurring.lastRunAt.toISOString() : null,
    active: recurring.active,
    createdAt: recurring.createdAt.toISOString(),
  };
}
