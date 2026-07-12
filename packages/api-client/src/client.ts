import type {
  ActivityDto,
  ActivityQuery,
  AddFriendInput,
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
  FriendDto,
  GroupBalancesDto,
  GroupDto,
  GroupSummaryDto,
  JoinGroupInput,
  ListExpensesQuery,
  ListSettlementsQuery,
  LoginInput,
  NotificationDto,
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
  UpdateRecurringInput,
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
    rotateInviteCode: (groupId: string) =>
      this.http.request<GroupDto>('POST', `${API}/groups/${groupId}/invite-code/rotate`),
    addMember: (groupId: string, input: AddMemberInput) =>
      this.http.request<GroupDto>('POST', `${API}/groups/${groupId}/members`, { body: input }),
    updateMember: (groupId: string, userId: string, input: UpdateMemberInput) =>
      this.http.request<GroupDto>('PATCH', `${API}/groups/${groupId}/members/${userId}`, {
        body: input,
      }),
    removeMember: (groupId: string, userId: string) =>
      this.http.request<GroupDto>('DELETE', `${API}/groups/${groupId}/members/${userId}`),
    leave: (groupId: string) => this.http.request<void>('POST', `${API}/groups/${groupId}/leave`),
    balances: (groupId: string) =>
      this.http.request<GroupBalancesDto>('GET', `${API}/groups/${groupId}/balances`),
    /** URL for CSV export (open in browser / share sheet; token via query not needed — use fetch with auth). */
    exportCsvUrl: (groupId: string) => this.http.buildUrl(`${API}/groups/${groupId}/export.csv`),
    exportCsv: (groupId: string) =>
      this.http.request<string>('GET', `${API}/groups/${groupId}/export.csv`),
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
    comments: (expenseId: string) =>
      this.http.request<CommentDto[]>('GET', `${API}/expenses/${expenseId}/comments`),
    addComment: (expenseId: string, input: CreateCommentInput) =>
      this.http.request<CommentDto>('POST', `${API}/expenses/${expenseId}/comments`, {
        body: input,
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
    remove: (settlementId: string) =>
      this.http.request<void>('DELETE', `${API}/settlements/${settlementId}`),
  };

  // -- Friends & overall balance ---------------------------------------------

  readonly friends = {
    list: () => this.http.request<FriendDto[]>('GET', `${API}/friends`),
    add: (input: AddFriendInput) =>
      this.http.request<FriendDto>('POST', `${API}/friends`, { body: input }),
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
  };

  // -- Uploads ------------------------------------------------------------------

  readonly uploads = {
    /** FormData must contain a `file` field. Returns a URL path servable by the API. */
    receipt: (formData: FormData) =>
      this.http.request<{ url: string }>('POST', `${API}/uploads/receipts`, { formData }),
  };

  // -- Health ---------------------------------------------------------------------

  health = () => this.http.request<{ status: 'ok'; version: string }>('GET', '/health');
}

export function createDivzyClient(options: HttpClientOptions): DivzyClient {
  return new DivzyClient(options);
}
