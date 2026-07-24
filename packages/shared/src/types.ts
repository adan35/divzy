import type {
  ExpenseCategory,
  GroupType,
  NotificationCategory,
  RecurrenceFrequency,
  SettlementMethod,
} from './constants';
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
  /**
   * WI-035. Relative `/uploads/avatars/<hex>.<ext>` path or null (no photo,
   * initials rendering) — always populated by the serializer at runtime.
   * Typed as OPTIONAL (not `string | null`) deliberately (DRB/business
   * condition, WI-016b precedent): making an additive field on this
   * widely-embedded DTO required breaks every other domain's hand-built
   * `PublicUserDto`/`UserDto` test fixtures that predate this field.
   */
  avatarUrl?: string | null;
}

export interface UserDto extends PublicUserDto {
  email: string;
  /**
   * Nullable, unique when set. UserDto-only — never on PublicUserDto (WI-045
   * Q3, stronger PII/enumeration vector than email). Optional-typed per this
   * domain's additive-DTO-field convention (WI-016b/WI-035) even though the
   * serializer always populates it.
   */
  phone?: string | null;
  defaultCurrency: string;
  emailNotifications: boolean;
  staleBalanceRemindersEnabled: boolean;
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
  /**
   * The requesting user's net position in this group, per currency — ONLY
   * currencies that could NOT be converted into `yourBalanceConverted` (no
   * resolvable rate); [] in the common case where every currency converted
   * (WI-001).
   */
  yourBalances: CurrencyAmount[];
  /**
   * The viewer's full signed per-currency net in this group — the complete
   * native breakdown (superset of `yourBalances`, which post-WI-001 holds
   * only the unconvertible subset), zeros dropped, positive = the group owes
   * you. Used for the WI-038 balance-direction filter; not a render change.
   */
  yourBalancesNative: CurrencyAmount[];
  /**
   * Sum of every convertible currency's net, converted to the viewer's
   * defaultCurrency; null when there was nothing convertible to sum (e.g.
   * only unconvertible currencies present, or fully settled up) (WI-001).
   */
  yourBalanceConverted: { currency: string; amount: number } | null;
  /**
   * True if any conversion contributing to yourBalanceConverted used
   * analytics' bundled fallback rate table rather than a live/cached rate
   * (WI-001).
   */
  usedFallbackRates: boolean;
  lastActivityAt: string | null;
  archivedAt: string | null;
  /**
   * True iff EVERY member's net is zero in EVERY currency of this group
   * (group-wide, not just the viewer's own net), computed from the same
   * native `computeNets` result the handler already produces (WI-028). A
   * group with no expenses/settlements is trivially settled (true).
   */
  settled: boolean;
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
  group: { id: string; name: string; emoji: string; currency: string } | null;
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

  /**
   * The expense's own total `amount` converted into `convertedCurrency`,
   * integer minor units, using the rate as-of `date` (WI-014). Absent when:
   * expense currency already equals the target currency (D6), the rate is
   * unresolvable (D7), or the as-of-date capability is unavailable at
   * request time (D7). Never null, never 0-as-placeholder.
   */
  convertedAmount?: number;
  /**
   * Target currency of `convertedAmount`: group.currency (group expense) or
   * the viewer's defaultCurrency (direct expense). Absent iff
   * `convertedAmount` is absent.
   */
  convertedCurrency?: string;
  /**
   * Quality of the rate behind `convertedAmount`, surfaced verbatim from
   * analytics' as-of-date capability (spec-WI-014 §5 / ADR-012 Decision 3).
   * `@divzy/shared` does not yet export a `RateBasis` type from analytics —
   * this inline literal union is byte-identical to that enum and is the
   * fallback until it does (spec-WI-014 §2 note). Absent iff
   * `convertedAmount` is absent.
   */
  rateBasis?: 'exact' | 'approximated' | 'fallback';
  /**
   * Derived convenience flag for the "clearly-labeled approximation" UI.
   * true iff `rateBasis` is `'approximated'` or `'fallback'` (spec-WI-014
   * §6). Absent iff `convertedAmount` is absent.
   */
  isApproximateRate?: boolean;
}

/** WI-032: response for GET /expenses/used-categories?groupId=<id>. */
export interface UsedCategoriesDto {
  categories: ExpenseCategory[];
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
  proofUrl: string | null;
  date: string;
  createdBy: PublicUserDto;
  deletedAt: string | null;
  createdAt: string;
}

/**
 * A member's per-currency nets (`balances`) collapsed into one figure in the
 * viewer's `defaultCurrency` — display-only, computed at read time (WI-001).
 * Present only when `balances.length > 0`: a settled-up member (empty
 * `balances`) omits this field entirely so the client's existing "settled up"
 * string check needs no special-casing (spec-WI-001).
 */
export interface ConvertedNet {
  amount: number;
  /** This member's native currencies that could not be converted (WI-002 trigger). */
  unresolved: CurrencyAmount[];
}

export interface GroupBalancesDto {
  groupId: string;
  /** The requesting member's `defaultCurrency` (not the group's own `currency`). */
  viewerCurrency: string;
  /** True if any contributing conversion resolved via the bundled fallback table. */
  usedFallbackRates: boolean;
  members: Array<{
    user: PublicUserDto;
    balances: CurrencyAmount[];
    convertedNet?: ConvertedNet;
  }>;
  /** Exact who-owes-whom as incurred. */
  pairwise: Array<
    PairwiseDebt & {
      from: PublicUserDto;
      to: PublicUserDto;
      /** Absent (never null/0) when this row's currency is unresolved for `viewerCurrency`. */
      convertedAmount?: number;
    }
  >;
  /** Minimal transfer set (shown when the group has simplifyDebts on). Never converted (WI-001). */
  suggestions: Array<SettlementSuggestion & { from: PublicUserDto; to: PublicUserDto }>;
}

export interface FriendDto {
  user: PublicUserDto;
  /**
   * Net across all shared groups + non-group expenses, per currency — ONLY
   * currencies that could NOT be converted into `balancesConverted` (no
   * resolvable rate); [] in the common case where every currency converted
   * (WI-001 addendum, 2026-07-14). Positive = they owe you.
   */
  balances: CurrencyAmount[];
  /**
   * The viewer's full signed per-currency net with this friend — the
   * complete native breakdown (superset of `balances`, which post-WI-001
   * holds only the unconvertible subset), zeros dropped, positive = they owe
   * you. Used for the WI-037 balance-direction filter; not a render change.
   */
  balancesNative: CurrencyAmount[];
  /**
   * Sum of every convertible currency in this friend's pairwise net,
   * converted to the viewer's defaultCurrency; null when there was nothing
   * convertible to sum (e.g. only unconvertible currencies present, or
   * settled up) (WI-001 addendum, 2026-07-14).
   */
  balancesConverted: { currency: string; amount: number } | null;
  /**
   * True if any conversion contributing to balancesConverted used
   * analytics' bundled fallback rate table rather than a live/cached rate
   * (WI-001 addendum, 2026-07-14).
   */
  usedFallbackRates: boolean;
  /**
   * Per-group breakdown of this friend's pairwise net (WI-079, ADR-033).
   * Each bucket is a per-group (or direct) NONZERO net; buckets MAY exist
   * even when the friend's overall collapsed net is zero (cross-bucket
   * cancel: e.g. +100 in one group, -100 in another, same currency — the
   * top-level balancesNative omits the currency while both buckets are
   * present and reconcile, absence ≡ 0). [] only when the friend has no
   * nonzero per-group bucket anywhere; a direct-only friend with an
   * outstanding balance has exactly one (group: null).
   * Sorted by bucket magnitude desc (|balancesConverted.amount| + Σ|balances|),
   * ties broken with the direct (group: null) bucket last, then group name
   * asc (localeCompare) — deterministic.
   */
  balancesByGroup: FriendBalanceBucket[];
  lastActivityAt: string | null;
}

/**
 * One per-group (or direct) bucket of the caller↔friend pairwise net (WI-079).
 * The buckets partition the friend's top-level balancesNative exactly: for
 * every currency, the sum of every bucket's balancesNative entry equals the
 * top-level balancesNative entry for that currency. Zero-net buckets are
 * dropped, mirroring the top-level "zeros dropped" convention.
 */
export interface FriendBalanceBucket {
  /**
   * The group this bucket's activity belongs to, or null for the non-group/
   * direct bucket. Mirrors the SettlementDto.group embed (types.ts:203) —
   * id/name/emoji, no currency — so this introduces no new DTO-shape
   * convention.
   */
  group: { id: string; name: string; emoji: string } | null;
  /**
   * Same contract as FriendDto.balances, scoped to this bucket: ONLY the
   * native entries that could not be converted into balancesConverted (no
   * resolvable rate); [] in the common case. Positive = the friend owes the
   * viewer.
   */
  balances: CurrencyAmount[];
  /**
   * Full signed native per-currency net within this bucket (superset of
   * balances), zeros dropped, positive = the friend owes the viewer. Sorted
   * by currency asc, same as FriendDto.balancesNative.
   */
  balancesNative: CurrencyAmount[];
  /**
   * Sum of this bucket's convertible currencies in the viewer's
   * defaultCurrency; null when nothing in this bucket was convertible (same
   * contract as FriendDto.balancesConverted).
   */
  balancesConverted: { currency: string; amount: number } | null;
  /**
   * True iff at least one of THIS bucket's currencies resolved via the
   * bundled fallback table (per-bucket attribution — never the blanket
   * request-level flag; spec-WI-079 Decision D4).
   */
  usedFallbackRates: boolean;
}

/** GET/POST /friends/code(/rotate) response (WI-040). */
export interface FriendCodeDto {
  code: string;
  shareUrl: string;
}

/**
 * The caller's native `totals`/`youOwe`/`youAreOwed` collapsed into one figure
 * each, in the caller's `defaultCurrency`, computed at read time (WI-001).
 */
export interface ConvertedBalance {
  currency: string;
  total: number;
  youOwe: number;
  youAreOwed: number;
  /** Native currencies that could not be converted to `currency` (WI-002 trigger). */
  unresolved: CurrencyAmount[];
  /** True if any contributing conversion resolved via the bundled fallback table. */
  usedFallbackRates: boolean;
}

export interface OverallBalanceDto {
  /** Positive = the world owes you. */
  totals: CurrencyAmount[];
  youOwe: CurrencyAmount[];
  youAreOwed: CurrencyAmount[];
  converted: ConvertedBalance;
}

export interface CommentDto {
  id: string;
  expenseId: string;
  author: PublicUserDto;
  body: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Expense edit history (WI-017, top-level scalar fields only)
// ---------------------------------------------------------------------------

export type ExpenseRevisionKind = 'CREATED' | 'UPDATED';

/** Discriminated on `field`. Scalar fields carry before/after; notes/receiptUrl carry a marker. */
export type ExpenseFieldChange =
  | { field: 'description'; from: string; to: string }
  | { field: 'amount'; from: number; fromCurrency: string; to: number; toCurrency: string }
  | { field: 'currency'; from: string; to: string }
  | { field: 'category'; from: ExpenseCategory; to: ExpenseCategory }
  | { field: 'date'; from: string; to: string }
  | { field: 'splitType'; from: SplitType; to: SplitType }
  | { field: 'notes'; change: 'added' | 'removed' | 'changed' }
  | { field: 'receiptUrl'; change: 'added' | 'removed' | 'changed' };

export interface ExpenseRevisionDto {
  id: string;
  expenseId: string;
  actor: PublicUserDto;
  kind: ExpenseRevisionKind;
  changes: ExpenseFieldChange[];
  createdAt: string;
}

export type ActivityType =
  | 'EXPENSE_ADDED'
  | 'EXPENSE_UPDATED'
  | 'EXPENSE_DELETED'
  | 'EXPENSE_RESTORED'
  | 'SETTLEMENT_ADDED'
  | 'SETTLEMENT_DELETED'
  | 'SETTLEMENT_RESTORED'
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
  /**
   * WI-054 (ADR-027). ISO string of the newest terminal lifecycle row's
   * `createdAt` when the entity this row anchors (`EXPENSE_ADDED`/
   * `SETTLEMENT_ADDED`) is currently deleted *for this caller*; null
   * otherwise. Only anchor rows carry a non-null value — `EXPENSE_UPDATED`/
   * `COMMENT_ADDED` rows for the same entity are never decorated. Computed
   * per-viewer in the `GET /activity` route; `toActivityDto` itself stays
   * viewer-agnostic and always serializes `null` (also used by the
   * `activity:new` socket emit, which has no per-viewer context).
   */
  deletedAt: string | null;
  /**
   * WI-055. Actor-relative financial signal, computed server-side at read
   * time: 'green' = EXPENSE_ADDED the viewer added; 'red' = EXPENSE_ADDED
   * someone else added; null = every other type, and any row where
   * deletedAt != null (a struck-through row is neutral — WI-054/ADR-027). A
   * proxy for "money I put in vs. money implicating me", NOT an exact
   * per-split calculation.
   */
  colorHint?: 'green' | 'red' | null;
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
  | 'RECURRING_POSTED'
  | 'BALANCE_REMINDER';

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: string | null;
  /**
   * WI-056. "Clearing" removes a notification from the visible list,
   * independent of readAt. In practice always null on returned rows (the
   * default `GET /notifications` query excludes cleared rows) and on fresh
   * `notification:new` socket payloads; included for parity with `readAt`
   * and to keep the DTO an honest reflection of the row.
   */
  clearedAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Notification preferences (WI-041, auth's slice)
// ---------------------------------------------------------------------------

export interface NotificationPreferenceDto {
  category: NotificationCategory;
  pushEnabled: boolean;
  emailEnabled: boolean;
  /** false for the 3 deferred categories -> UI renders disabled "coming soon". */
  available: boolean;
}

/** GET /users/me/notification-preferences — one entry per canonical category (auth's own read contract). */
export interface NotificationPreferencesDto {
  categories: NotificationPreferenceDto[];
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
  participants: Array<{
    userId: string;
    amount?: number;
    percentBps?: number;
    shares?: number;
    adjustment?: number;
  }>;
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
  /**
   * amount = your converted split share for that month (unchanged meaning).
   * totalActivity = the full converted expense amount for that month, the
   * per-month bucketing of the whole-range totalActivity scalar above. Both
   * series are zero-filled over the identical calendar-month grid (ADR-011).
   */
  byMonth: Array<{ month: string; amount: number; totalActivity: number }>;
  byGroup: Array<{ groupId: string; name: string; emoji: string; amount: number }>;
  /** True when one or more amounts used a bundled fallback exchange rate. */
  usedFallbackRates: boolean;
}

/** Response of POST /rates/manual — the persisted "1 from = ? to" rate. */
export interface ManualExchangeRateDto {
  from: string;
  to: string;
  rate: number;
  createdAt: string;
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
  'group:changed': (payload: {
    groupId: string;
    kind: 'expense' | 'settlement' | 'member' | 'group';
  }) => void;
  /** Emitted to both parties of a non-group expense/settlement change. */
  'friends:changed': (payload: { userIds: string[] }) => void;
}

export interface ClientToServerEvents {
  'group:subscribe': (groupId: string) => void;
  'group:unsubscribe': (groupId: string) => void;
}
