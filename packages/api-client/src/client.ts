import type {
  ActivityDto,
  ActivityQuery,
  AddFriendByCodeInput,
  AddFriendInput,
  AddMemberByFriendInput,
  AddMemberInput,
  AnalyticsQuery,
  AnalyticsSummaryDto,
  AuthResponseDto,
  ChangePasswordInput,
  CommentDto,
  CreateCommentInput,
  CreateExpenseInput,
  CreateGroupInput,
  CreateRecurringInput,
  CreateSettlementInput,
  ExpenseDto,
  ExpenseRevisionDto,
  FriendCodeDto,
  FriendDto,
  GroupBalancesDto,
  GroupDto,
  GroupSummaryDto,
  JoinGroupInput,
  ListExpensesQuery,
  ListSettlementsQuery,
  LoginInput,
  ManualExchangeRateDto,
  ManualRateInput,
  NotificationDto,
  NotificationPreferencesDto,
  NotificationsQuery,
  OverallBalanceDto,
  Paginated,
  PublicUserDto,
  RecurringExpenseDto,
  RegisterInput,
  RegisterPushTokenInput,
  SettlementDto,
  UpdateExpenseInput,
  UpdateGroupInput,
  UpdateMeInput,
  UpdateMemberInput,
  UpdateNotificationPreferencesInput,
  UpdateRecurringInput,
  UsedCategoriesDto,
  UserDto,
} from '@divzy/shared';
import { HttpClient, type HttpClientOptions, type QueryParams } from './http';

const API = '/api/v1';

/**
 * Typed Divzy API client. Every method here maps 1:1 to a server route —
 * this file is the source of truth for the HTTP contract.
 */
export class DivzyClient {
  readonly http: HttpClient;

  constructor(options: HttpClientOptions) {
    this.http = new HttpClient(options);
  }

  // -- Auth -----------------------------------------------------------------

  readonly auth = {
    register: (input: RegisterInput) =>
      this.http.request<AuthResponseDto>('POST', `${API}/auth/register`, {
        body: input,
        skipAuthRetry: true,
      }),
    login: (input: LoginInput) =>
      this.http.request<AuthResponseDto>('POST', `${API}/auth/login`, {
        body: input,
        skipAuthRetry: true,
      }),
    /** Web: token read from httpOnly cookie. Mobile: pass the stored token. */
    refresh: (refreshToken?: string) =>
      this.http.request<AuthResponseDto>('POST', `${API}/auth/refresh`, {
        body: refreshToken ? { refreshToken } : {},
        skipAuthRetry: true,
      }),
    logout: (refreshToken?: string) =>
      this.http.request<void>('POST', `${API}/auth/logout`, {
        body: refreshToken ? { refreshToken } : {},
        skipAuthRetry: true,
      }),
    me: () => this.http.request<UserDto>('GET', `${API}/auth/me`),
  };

  // -- Users ----------------------------------------------------------------

  readonly users = {
    updateMe: (input: UpdateMeInput) =>
      this.http.request<UserDto>('PATCH', `${API}/users/me`, { body: input }),
    changePassword: (input: ChangePasswordInput) =>
      this.http.request<void>('POST', `${API}/users/me/password`, { body: input }),
    search: (email: string) =>
      this.http.request<PublicUserDto | null>('GET', `${API}/users/search`, { query: { email } }),
    registerPushToken: (input: RegisterPushTokenInput) =>
      this.http.request<void>('POST', `${API}/users/me/push-tokens`, { body: input }),
    /** WI-041: fully-resolved 9-category push/email matrix for the caller. */
    notificationPreferences: () =>
      this.http.request<NotificationPreferencesDto>(
        'GET',
        `${API}/users/me/notification-preferences`,
      ),
    /** WI-041: partial per-cell upsert; unknown category / non-boolean channel -> 400. */
    updateNotificationPreferences: (input: UpdateNotificationPreferencesInput) =>
      this.http.request<void>('PATCH', `${API}/users/me/notification-preferences`, {
        body: input,
      }),
  };

  // -- Groups ---------------------------------------------------------------

  readonly groups = {
    list: () => this.http.request<GroupSummaryDto[]>('GET', `${API}/groups`),
    create: (input: CreateGroupInput) =>
      this.http.request<GroupDto>('POST', `${API}/groups`, { body: input }),
    join: (input: JoinGroupInput) =>
      this.http.request<GroupDto>('POST', `${API}/groups/join`, { body: input }),
    get: (groupId: string) => this.http.request<GroupDto>('GET', `${API}/groups/${groupId}`),
    update: (groupId: string, input: UpdateGroupInput) =>
      this.http.request<GroupDto>('PATCH', `${API}/groups/${groupId}`, { body: input }),
    /** Archives the group (soft delete). */
    archive: (groupId: string) => this.http.request<void>('DELETE', `${API}/groups/${groupId}`),
    /** WI-027: clears archivedAt, restoring the group to active (idempotent). */
    unarchive: (groupId: string) =>
      this.http.request<GroupDto>('POST', `${API}/groups/${groupId}/unarchive`),
    rotateInviteCode: (groupId: string) =>
      this.http.request<GroupDto>('POST', `${API}/groups/${groupId}/invite-code/rotate`),
    addMember: (groupId: string, input: AddMemberInput) =>
      this.http.request<GroupDto>('POST', `${API}/groups/${groupId}/members`, { body: input }),
    /** WI-042: add an existing friend directly (server enforces the friendship). */
    addMemberByFriend: (groupId: string, input: AddMemberByFriendInput) =>
      this.http.request<GroupDto>('POST', `${API}/groups/${groupId}/members/by-friend`, {
        body: input,
      }),
    updateMember: (groupId: string, userId: string, input: UpdateMemberInput) =>
      this.http.request<GroupDto>('PATCH', `${API}/groups/${groupId}/members/${userId}`, {
        body: input,
      }),
    removeMember: (groupId: string, userId: string) =>
      this.http.request<GroupDto>('DELETE', `${API}/groups/${groupId}/members/${userId}`),
    leave: (groupId: string) => this.http.request<void>('POST', `${API}/groups/${groupId}/leave`),
    /**
     * WI-046: permanently soft-deletes the group (admin-only, group-wide
     * fully settled). Distinct from `archive` — deleted groups never
     * resurface in `GET /groups` and cannot be unarchived/undeleted.
     */
    delete: (groupId: string) =>
      this.http.request<void>('POST', `${API}/groups/${groupId}/delete`),
    balances: (groupId: string) =>
      this.http.request<GroupBalancesDto>('GET', `${API}/groups/${groupId}/balances`),
    /** URL for CSV export (open in browser / share sheet; token via query not needed — use fetch with auth). */
    exportCsvUrl: (groupId: string) => this.http.buildUrl(`${API}/groups/${groupId}/export.csv`),
    exportCsv: (groupId: string) =>
      this.http.request<string>('GET', `${API}/groups/${groupId}/export.csv`),
    /** URL for PDF export (open in browser / share sheet; token via query not needed — use fetch with auth). */
    exportPdfUrl: (groupId: string) => this.http.buildUrl(`${API}/groups/${groupId}/export.pdf`),
    /**
     * PDF is binary, unlike CSV — must go through the blob-preserving
     * request path (see defect-WI-018). Returns a Blob, not a string.
     */
    exportPdf: (groupId: string) =>
      this.http.requestBlob('GET', `${API}/groups/${groupId}/export.pdf`),
    /** URL for Excel export (open in browser / share sheet; token via query not needed — use fetch with auth). */
    exportXlsxUrl: (groupId: string) =>
      this.http.buildUrl(`${API}/groups/${groupId}/export.xlsx`),
    /**
     * Xlsx is binary, like PDF — must go through the blob-preserving request
     * path (see defect-WI-018). Returns a Blob, not a string.
     */
    exportXlsx: (groupId: string) =>
      this.http.requestBlob('GET', `${API}/groups/${groupId}/export.xlsx`),
  };

  // -- Expenses -------------------------------------------------------------

  readonly expenses = {
    list: (query: Partial<ListExpensesQuery> = {}) =>
      this.http.request<Paginated<ExpenseDto>>('GET', `${API}/expenses`, {
        query: query as QueryParams,
      }),
    create: (input: CreateExpenseInput) =>
      this.http.request<ExpenseDto>('POST', `${API}/expenses`, { body: input }),
    get: (expenseId: string) => this.http.request<ExpenseDto>('GET', `${API}/expenses/${expenseId}`),
    update: (expenseId: string, input: UpdateExpenseInput) =>
      this.http.request<ExpenseDto>('PATCH', `${API}/expenses/${expenseId}`, { body: input }),
    remove: (expenseId: string) =>
      this.http.request<void>('DELETE', `${API}/expenses/${expenseId}`),
    /** WI-054b: undo a soft delete. Idempotent 200 no-op if already active. */
    restore: (expenseId: string) =>
      this.http.request<ExpenseDto>('POST', `${API}/expenses/${expenseId}/restore`),
    comments: (expenseId: string) =>
      this.http.request<CommentDto[]>('GET', `${API}/expenses/${expenseId}/comments`),
    addComment: (expenseId: string, input: CreateCommentInput) =>
      this.http.request<CommentDto>('POST', `${API}/expenses/${expenseId}/comments`, {
        body: input,
      }),
    history: (expenseId: string) =>
      this.http.request<ExpenseRevisionDto[]>('GET', `${API}/expenses/${expenseId}/history`),
    /** WI-032 / WI-063 / WI-064: distinct, non-deleted categories used in this group, with this friend, or unscoped across all of the caller's expenses (bounded ≤16). */
    usedCategories: (scope: { groupId: string } | { friendId: string } | Record<string, never> = {}) =>
      this.http.request<UsedCategoriesDto>('GET', `${API}/expenses/used-categories`, {
        query: scope as QueryParams,
      }),
  };

  // -- Settlements ----------------------------------------------------------

  readonly settlements = {
    list: (query: Partial<ListSettlementsQuery> = {}) =>
      this.http.request<Paginated<SettlementDto>>('GET', `${API}/settlements`, {
        query: query as QueryParams,
      }),
    create: (input: CreateSettlementInput) =>
      this.http.request<SettlementDto>('POST', `${API}/settlements`, { body: input }),
    get: (settlementId: string) =>
      this.http.request<SettlementDto>('GET', `${API}/settlements/${settlementId}`),
    remove: (settlementId: string) =>
      this.http.request<void>('DELETE', `${API}/settlements/${settlementId}`),
    /** WI-054b: undo a soft delete. Idempotent 200 no-op if already active. */
    restore: (settlementId: string) =>
      this.http.request<SettlementDto>('POST', `${API}/settlements/${settlementId}/restore`),
  };

  // -- Friends & overall balance ---------------------------------------------

  readonly friends = {
    list: () => this.http.request<FriendDto[]>('GET', `${API}/friends`),
    /** WI-070: single-friend read — same FriendDto shape as one GET /friends entry. */
    get: (userId: string) => this.http.request<FriendDto>('GET', `${API}/friends/${userId}`),
    add: (input: AddFriendInput) =>
      this.http.request<FriendDto>('POST', `${API}/friends`, { body: input }),
    /** WI-040: the caller's persistent friend-add code, created lazily. */
    code: () => this.http.request<FriendCodeDto>('GET', `${API}/friends/code`),
    /** WI-040: regenerates the caller's code, invalidating the old value. */
    rotateCode: () => this.http.request<FriendCodeDto>('POST', `${API}/friends/code/rotate`),
    /** WI-040: resolve a code to a user and run the standard add-friend flow. */
    addByCode: (input: AddFriendByCodeInput) =>
      this.http.request<FriendDto>('POST', `${API}/friends/add-by-code`, { body: input }),
    /** WI-066: hard-remove the friendship with :userId. 204; 404 FRIENDSHIP_NOT_FOUND; 409 OUTSTANDING_BALANCE. */
    remove: (userId: string) => this.http.request<void>('DELETE', `${API}/friends/${userId}`),
  };

  readonly balance = {
    overall: () => this.http.request<OverallBalanceDto>('GET', `${API}/balance`),
  };

  // -- Activity & notifications ----------------------------------------------

  readonly activity = {
    list: (query: Partial<ActivityQuery> = {}) =>
      this.http.request<Paginated<ActivityDto>>('GET', `${API}/activity`, {
        query: query as QueryParams,
      }),
  };

  readonly notifications = {
    list: (query: Partial<NotificationsQuery> = {}) =>
      this.http.request<Paginated<NotificationDto>>('GET', `${API}/notifications`, {
        query: query as QueryParams,
      }),
    unreadCount: () =>
      this.http.request<{ count: number }>('GET', `${API}/notifications/unread-count`),
    markRead: (notificationId: string) =>
      this.http.request<void>('POST', `${API}/notifications/${notificationId}/read`),
    markAllRead: () => this.http.request<void>('POST', `${API}/notifications/read-all`),
    /** WI-056: removes from the visible list, independent of readAt (idempotent, own-only). */
    clear: (notificationId: string) =>
      this.http.request<void>('POST', `${API}/notifications/${notificationId}/clear`),
    /** WI-065: bulk-clears every uncleared notification the caller owns (idempotent, own-only). */
    clearAll: () => this.http.request<void>('POST', `${API}/notifications/clear-all`),
  };

  // -- Recurring expenses -----------------------------------------------------

  readonly recurring = {
    list: () => this.http.request<RecurringExpenseDto[]>('GET', `${API}/recurring`),
    create: (input: CreateRecurringInput) =>
      this.http.request<RecurringExpenseDto>('POST', `${API}/recurring`, { body: input }),
    update: (recurringId: string, input: UpdateRecurringInput) =>
      this.http.request<RecurringExpenseDto>('PATCH', `${API}/recurring/${recurringId}`, {
        body: input,
      }),
    remove: (recurringId: string) =>
      this.http.request<void>('DELETE', `${API}/recurring/${recurringId}`),
  };

  // -- Analytics & rates -------------------------------------------------------

  readonly analytics = {
    summary: (query: Partial<AnalyticsQuery> = {}) =>
      this.http.request<AnalyticsSummaryDto>('GET', `${API}/analytics/summary`, {
        query: query as QueryParams,
      }),
  };

  readonly rates = {
    get: (base: string) =>
      this.http.request<{
        base: string;
        rates: Record<string, number>;
        fetchedAt: string;
        source: 'live' | 'fallback';
      }>('GET', `${API}/rates`, { query: { base } }),
    /** Upserts on (userId, from, to) — resubmitting overwrites the stored rate. */
    manual: (input: ManualRateInput) =>
      this.http.request<ManualExchangeRateDto>('POST', `${API}/rates/manual`, { body: input }),
  };

  // -- Uploads ------------------------------------------------------------------

  readonly uploads = {
    /** FormData must contain a `file` field. Returns a URL path servable by the API. */
    receipt: (formData: FormData) =>
      this.http.request<{ url: string }>('POST', `${API}/uploads/receipts`, { formData }),
    /** WI-035: image-only sibling of `receipt`. FormData must contain a `file` field. */
    avatar: (formData: FormData) =>
      this.http.request<{ url: string }>('POST', `${API}/uploads/avatars`, { formData }),
  };

  // -- Health ---------------------------------------------------------------------

  health = () => this.http.request<{ status: 'ok'; version: string }>('GET', '/health');
}

export function createDivzyClient(options: HttpClientOptions): DivzyClient {
  return new DivzyClient(options);
}
