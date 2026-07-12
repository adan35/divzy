import type { ExpenseCategory, GroupType, RecurrenceFrequency, SettlementMethod } from './constants';
import type { SplitType } from './split';
import type { CurrencyAmount, PairwiseDebt, SettlementSuggestion } from './balances';

// ---------------------------------------------------------------------------
// Response DTOs — the JSON shapes the API returns. All money is integer minor
// units; all dates are ISO 8601 strings.
// ---------------------------------------------------------------------------

export interface PublicUserDto {
  id: string;
  name: string;
  avatarColor: string;
}

export interface UserDto extends PublicUserDto {
  email: string;
  defaultCurrency: string;
  emailNotifications: boolean;
  createdAt: string;
}

export interface AuthResponseDto {
  user: UserDto;
  accessToken: string;
  /** Also set as an httpOnly cookie for web clients. */
  refreshToken: string;
  /** Seconds until the access token expires. */
  accessTokenExpiresIn: number;
}

export type MemberRole = 'ADMIN' | 'MEMBER';

export interface GroupMemberDto {
  user: PublicUserDto;
  role: MemberRole;
  joinedAt: string;
}

export interface GroupDto {
  id: string;
  name: string;
  emoji: string;
  type: GroupType;
  currency: string;
  inviteCode: string;
  simplifyDebts: boolean;
  createdBy: PublicUserDto;
  members: GroupMemberDto[];
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GroupSummaryDto {
  id: string;
  name: string;
  emoji: string;
  type: GroupType;
  currency: string;
  memberCount: number;
  /** The requesting user's net position in this group, per currency. */
  yourBalances: CurrencyAmount[];
  lastActivityAt: string | null;
  archivedAt: string | null;
}

export interface ExpensePayerDto {
  user: PublicUserDto;
  amount: number;
}

export interface ExpenseSplitDto {
  user: PublicUserDto;
  amount: number;
  shares: number | null;
  percentBps: number | null;
  adjustment: number | null;
}

export interface ExpenseItemDto {
  id: string;
  name: string;
  amount: number;
  participantIds: string[];
}

export interface ExpenseDto {
  id: string;
  groupId: string | null;
  group: { id: string; name: string; emoji: string } | null;
  description: string;
  amount: number;
  currency: string;
  category: ExpenseCategory;
  date: string;
  splitType: SplitType;
  notes: string | null;
  receiptUrl: string | null;
  payers: ExpensePayerDto[];
  splits: ExpenseSplitDto[];
  items: ExpenseItemDto[];
  createdBy: PublicUserDto;
  updatedBy: PublicUserDto | null;
  commentCount: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SettlementDto {
  id: string;
  groupId: string | null;
  group: { id: string; name: string; emoji: string } | null;
  from: PublicUserDto;
  to: PublicUserDto;
  amount: number;
  currency: string;
  method: SettlementMethod;
  note: string | null;
  date: string;
  createdBy: PublicUserDto;
  deletedAt: string | null;
  createdAt: string;
}

export interface GroupBalancesDto {
  groupId: string;
  members: Array<{
    user: PublicUserDto;
    balances: CurrencyAmount[];
  }>;
  /** Exact who-owes-whom as incurred. */
  pairwise: Array<PairwiseDebt & { from: PublicUserDto; to: PublicUserDto }>;
  /** Minimal transfer set (shown when the group has simplifyDebts on). */
  suggestions: Array<SettlementSuggestion & { from: PublicUserDto; to: PublicUserDto }>;
}

export interface FriendDto {
  user: PublicUserDto;
  /** Net across all shared groups + non-group expenses. Positive = they owe you. */
  balances: CurrencyAmount[];
  lastActivityAt: string | null;
}

export interface OverallBalanceDto {
  /** Positive = the world owes you. */
  totals: CurrencyAmount[];
  youOwe: CurrencyAmount[];
  youAreOwed: CurrencyAmount[];
}

export interface CommentDto {
  id: string;
  expenseId: string;
  author: PublicUserDto;
  body: string;
  createdAt: string;
}

export type ActivityType =
  | 'EXPENSE_ADDED'
  | 'EXPENSE_UPDATED'
  | 'EXPENSE_DELETED'
  | 'SETTLEMENT_ADDED'
  | 'SETTLEMENT_DELETED'
  | 'GROUP_CREATED'
  | 'GROUP_UPDATED'
  | 'MEMBER_JOINED'
  | 'MEMBER_LEFT'
  | 'MEMBER_REMOVED'
  | 'COMMENT_ADDED'
  | 'FRIEND_ADDED'
  | 'RECURRING_POSTED';

export interface ActivityDto {
  id: string;
  type: ActivityType;
  actor: PublicUserDto;
  group: { id: string; name: string; emoji: string } | null;
  expenseId: string | null;
  settlementId: string | null;
  /** Type-specific display payload (description, amount, currency, ...). */
  data: Record<string, unknown>;
  createdAt: string;
}

export type NotificationType =
  | 'EXPENSE_ADDED'
  | 'EXPENSE_UPDATED'
  | 'EXPENSE_DELETED'
  | 'SETTLEMENT_RECORDED'
  | 'COMMENT_ADDED'
  | 'MEMBER_JOINED'
  | 'ADDED_TO_GROUP'
  | 'FRIEND_ADDED'
  | 'RECURRING_POSTED';

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface RecurringExpenseDto {
  id: string;
  groupId: string | null;
  group: { id: string; name: string; emoji: string } | null;
  description: string;
  amount: number;
  currency: string;
  category: ExpenseCategory;
  splitType: SplitType;
  payers: Array<{ userId: string; amount: number }>;
  participants: Array<{ userId: string; amount?: number; percentBps?: number; shares?: number; adjustment?: number }>;
  notes: string | null;
  frequency: RecurrenceFrequency;
  nextRunAt: string;
  endDate: string | null;
  lastRunAt: string | null;
  active: boolean;
  createdAt: string;
}

export interface AnalyticsSummaryDto {
  /** Currency everything below is converted into. */
  currency: string;
  /** ISO range actually used. */
  from: string;
  to: string;
  /** Sum of your share of expenses in range (minor units, converted). */
  yourSpend: number;
  /** Total of all expenses you participated in (full amounts). */
  totalActivity: number;
  /** Your spend in the preceding window of equal length (for delta display). */
  previousYourSpend: number;
  byCategory: Array<{ category: ExpenseCategory; amount: number }>;
  byMonth: Array<{ month: string; amount: number }>;
  byGroup: Array<{ groupId: string; name: string; emoji: string; amount: number }>;
  /** True when one or more amounts used a bundled fallback exchange rate. */
  usedFallbackRates: boolean;
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string;
  code?: string;
}

// ---------------------------------------------------------------------------
// Socket.io event map (server -> client)
// ---------------------------------------------------------------------------

export interface ServerToClientEvents {
  'notification:new': (notification: NotificationDto) => void;
  'activity:new': (activity: ActivityDto) => void;
  /** Emitted to group rooms; payload carries groupId so clients can invalidate. */
  'group:changed': (payload: { groupId: string; kind: 'expense' | 'settlement' | 'member' | 'group' }) => void;
  /** Emitted to both parties of a non-group expense/settlement change. */
  'friends:changed': (payload: { userIds: string[] }) => void;
}

export interface ClientToServerEvents {
  'group:subscribe': (groupId: string) => void;
  'group:unsubscribe': (groupId: string) => void;
}
