'use client';

import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError, NetworkError } from '@divzy/api-client';
import type {
  AddFriendInput,
  AnalyticsQuery,
  ChangePasswordInput,
  CreateExpenseInput,
  CreateGroupInput,
  CreateRecurringInput,
  CreateSettlementInput,
  ExpenseDto,
  GroupBalancesDto,
  GroupDto,
  GroupWhiteboardDto,
  ListExpensesQuery,
  ListSettlementsQuery,
  LoginInput,
  ManualRateInput,
  MemberRole,
  NotificationCategory,
  RegisterInput,
  SettlementDto,
  UpdateExpenseInput,
  UpdateGroupInput,
  UpdateGroupWhiteboardInput,
  UpdateMeInput,
  UpdateRecurringInput,
} from '@divzy/shared';
import { api } from './api';
import { useAuthStore } from './auth-store';

// ---------------------------------------------------------------------------
// Error handling — every mutation surfaces the API's message verbatim.
// ---------------------------------------------------------------------------

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof NetworkError) return 'Network error — check your connection and try again.';
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Please try again.';
}

function toastError(error: unknown): void {
  toast.error(errorMessage(error));
}

// ---------------------------------------------------------------------------
// Query keys — EXACTLY per docs/CONTRACTS.md §Query keys.
// ---------------------------------------------------------------------------

export type ExpenseFilters = Partial<
  Pick<ListExpensesQuery, 'groupId' | 'friendId' | 'category' | 'search'>
>;
export type SettlementFilters = Partial<Pick<ListSettlementsQuery, 'groupId' | 'friendId'>>;
export type AnalyticsParams = Partial<AnalyticsQuery>;

/** Drop undefined/empty entries so filter objects hash into stable keys. */
function clean<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

export const queryKeys = {
  me: ['me'] as const,
  groups: ['groups'] as const,
  group: (groupId: string) => ['group', groupId] as const,
  groupBalances: (groupId: string) => ['group-balances', groupId] as const,
  groupWhiteboard: (groupId: string) => ['group-whiteboard', groupId] as const,
  expenses: (filters: ExpenseFilters = {}) => ['expenses', clean(filters)] as const,
  expense: (expenseId: string) => ['expense', expenseId] as const,
  expenseHistory: (expenseId: string) => ['expense', expenseId, 'history'] as const,
  usedCategories: (scope: { groupId?: string; friendId?: string } = {}) =>
    ['usedCategories', clean(scope)] as const,
  comments: (expenseId: string) => ['comments', expenseId] as const,
  settlements: (filters: SettlementFilters = {}) => ['settlements', clean(filters)] as const,
  settlement: (settlementId: string) => ['settlement', settlementId] as const,
  friends: ['friends'] as const,
  /** WI-070: single-friend read key — does NOT prefix-match ['friends'] (the
   * list key), since React Query's partial matching compares key arrays
   * element-wise and 'friend' !== 'friends'. */
  friend: (userId: string) => ['friend', userId] as const,
  friendCode: ['friend-code'] as const,
  balance: ['balance'] as const,
  activity: (groupId?: string | null) => ['activity', groupId ?? null] as const,
  notifications: ['notifications'] as const,
  unreadCount: ['unread-count'] as const,
  recurring: ['recurring'] as const,
  analytics: (params: AnalyticsParams = {}) => ['analytics', clean(params)] as const,
  rates: (base: string) => ['rates', base] as const,
  notificationPreferences: ['notification-preferences'] as const,
};

// ---------------------------------------------------------------------------
// Invalidation map (CONTRACTS.md) — shared by mutations and socket sync.
// ---------------------------------------------------------------------------

/**
 * After any expense or settlement change (mutation or socket event):
 * expenses lists + details, the group, groups, group balances, overall
 * balance, friends, activity and analytics all go stale.
 *
 * WI-063 (D6): `usedCategories` is invalidated unconditionally (broad
 * `['usedCategories']` prefix), not only when `groupId` is present —
 * otherwise a non-group (friend/direct) expense mutation would leave the
 * friend-scoped used-categories pill set stale for up to the app's global
 * 30s `staleTime` (the same defect class as defect-WI-032-D1).
 */
export function invalidateForExpenseChange(
  queryClient: QueryClient,
  groupId?: string | null,
): void {
  void queryClient.invalidateQueries({ queryKey: ['expenses'] });
  void queryClient.invalidateQueries({ queryKey: ['expense'] });
  void queryClient.invalidateQueries({ queryKey: ['settlements'] });
  void queryClient.invalidateQueries({ queryKey: ['settlement'] });
  void queryClient.invalidateQueries({ queryKey: ['groups'] });
  void queryClient.invalidateQueries({ queryKey: ['usedCategories'] });
  if (groupId) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.group(groupId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.groupBalances(groupId) });
  }
  void queryClient.invalidateQueries({ queryKey: ['group-balances'] });
  void queryClient.invalidateQueries({ queryKey: queryKeys.balance });
  void queryClient.invalidateQueries({ queryKey: queryKeys.friends });
  // WI-070: ['friend', id] is a distinct key from ['friends'] (not a prefix
  // match), so the invalidation above alone would leave a friend-detail
  // page's useFriend query stale after an expense/settlement change on that
  // page — this is what keeps its header/balance chip current.
  void queryClient.invalidateQueries({ queryKey: ['friend'] });
  void queryClient.invalidateQueries({ queryKey: ['activity'] });
  void queryClient.invalidateQueries({ queryKey: ['analytics'] });
}

export function invalidateForGroupChange(queryClient: QueryClient, groupId?: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.groups });
  if (groupId) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.group(groupId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.groupBalances(groupId) });
  }
}

/**
 * WI-075 — routes a `group:changed` socket event to the right invalidator.
 * A `member`/`group` event (membership, name/emoji, archive) never touches
 * expenses, settlements, balances, friends, activity or analytics, so it
 * gets the narrow invalidator instead of the broad one — without this,
 * every other online group member's app refetched nearly everything on
 * every teammate's edit, including edits that were never expense/settlement
 * changes at all.
 */
export function invalidateForGroupChangedEvent(
  queryClient: QueryClient,
  payload: { groupId: string; kind: 'expense' | 'settlement' | 'member' | 'group' },
): void {
  if (payload.kind === 'member' || payload.kind === 'group') {
    invalidateForGroupChange(queryClient, payload.groupId);
  } else {
    invalidateForExpenseChange(queryClient, payload.groupId);
  }
}

// ---------------------------------------------------------------------------
// Auth & profile
// ---------------------------------------------------------------------------

export function useMe() {
  const status = useAuthStore((s) => s.status);
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api.auth.me(),
    enabled: status === 'authed',
  });
}

export function useLogin() {
  return useMutation({
    mutationFn: (input: LoginInput) => api.auth.login(input),
    onSuccess: (res) => {
      useAuthStore.getState().setAuth(res.user, res.accessToken);
    },
    onError: toastError,
  });
}

export function useRegister() {
  return useMutation({
    mutationFn: (input: RegisterInput) => api.auth.register(input),
    onSuccess: (res) => {
      useAuthStore.getState().setAuth(res.user, res.accessToken);
    },
    onError: toastError,
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      try {
        await api.auth.logout();
      } catch {
        // Revoking a token that is already gone is fine — always log out locally.
      }
    },
    onSettled: () => {
      useAuthStore.getState().clear();
      queryClient.clear();
    },
  });
}

export function useUpdateMe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateMeInput) => api.users.updateMe(input),
    onSuccess: (user) => {
      useAuthStore.getState().setUser(user);
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
    onError: toastError,
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: ChangePasswordInput) => api.users.changePassword(input),
    onError: toastError,
  });
}

// ---------------------------------------------------------------------------
// Notification preferences (WI-041, auth's slice)
// ---------------------------------------------------------------------------

export function useNotificationPreferences() {
  return useQuery({
    queryKey: queryKeys.notificationPreferences,
    queryFn: () => api.users.notificationPreferences(),
  });
}

/**
 * Single-cell toggle: wraps one `{ category, pushEnabled?, emailEnabled? }`
 * entry into the PATCH's `preferences` array. Call this hook once per
 * independent toggle (not once per row) — each push/email switch gets its
 * own mutation instance so one toggle's pending state never disables a
 * sibling toggle (same "one mutation instance per control" principle as the
 * avatar upload/remove controls, WI-035 §4).
 */
export function useUpdateNotificationPreference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pref: {
      category: NotificationCategory;
      pushEnabled?: boolean;
      emailEnabled?: boolean;
    }) => api.users.updateNotificationPreferences({ preferences: [pref] }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notificationPreferences });
    },
    onError: toastError,
  });
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export function useGroups() {
  return useQuery({
    queryKey: queryKeys.groups,
    queryFn: () => api.groups.list(),
  });
}

export function useGroup(groupId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.group(groupId),
    queryFn: () => api.groups.get(groupId),
    enabled: enabled && groupId.length > 0,
  });
}

export function useGroupBalances(groupId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.groupBalances(groupId),
    queryFn: () => api.groups.balances(groupId),
    enabled: enabled && groupId.length > 0,
  });
}

export function useGroupWhiteboard(groupId: string, enabled = true) {
  return useQuery<GroupWhiteboardDto>({
    queryKey: queryKeys.groupWhiteboard(groupId),
    queryFn: () => api.groups.whiteboard(groupId),
    enabled: enabled && groupId.length > 0,
  });
}

export function useUpdateGroupWhiteboard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, body }: { groupId: string; body: string }) =>
      api.groups.updateWhiteboard(groupId, { body }),
    onSuccess: (data, { groupId }) => {
      queryClient.setQueryData(queryKeys.groupWhiteboard(groupId), data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.groupWhiteboard(groupId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.group(groupId) });
    },
    onError: toastError,
  });
}

/**
 * WI-088: fetch balances for many groups in parallel. Pure composition of the
 * existing `GET /groups/:groupId/balances` endpoint; no new backend surface.
 */
export function useGroupBalancesMany(groupIds: string[]) {
  return useQueries({
    queries: groupIds.map((groupId) => ({
      queryKey: queryKeys.groupBalances(groupId),
      queryFn: () => api.groups.balances(groupId),
      enabled: groupId.length > 0,
    })),
  });
}

export function useCreateGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGroupInput) => api.groups.create(input),
    onSuccess: (group: GroupDto) => invalidateForGroupChange(queryClient, group.id),
    onError: toastError,
  });
}

export function useJoinGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api.groups.join({ code }),
    onSuccess: (group: GroupDto) => {
      invalidateForGroupChange(queryClient, group.id);
      void queryClient.invalidateQueries({ queryKey: queryKeys.friends });
    },
    onError: toastError,
  });
}

export function useUpdateGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, input }: { groupId: string; input: UpdateGroupInput }) =>
      api.groups.update(groupId, input),
    onSuccess: (group: GroupDto) => invalidateForGroupChange(queryClient, group.id),
    onError: toastError,
  });
}

export function useArchiveGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) => api.groups.archive(groupId),
    onSuccess: (_data, groupId) => invalidateForGroupChange(queryClient, groupId),
    onError: toastError,
  });
}

/** WI-027: clears archivedAt, restoring the group to active (ADMIN-only, idempotent). */
export function useUnarchiveGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) => api.groups.unarchive(groupId),
    onSuccess: (group: GroupDto) => invalidateForGroupChange(queryClient, group.id),
    onError: toastError,
  });
}

export function useRotateInviteCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) => api.groups.rotateInviteCode(groupId),
    onSuccess: (group: GroupDto) => invalidateForGroupChange(queryClient, group.id),
    onError: toastError,
  });
}

export function useAddMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, email }: { groupId: string; email: string }) =>
      api.groups.addMember(groupId, { email }),
    onSuccess: (group: GroupDto) => {
      invalidateForGroupChange(queryClient, group.id);
      void queryClient.invalidateQueries({ queryKey: queryKeys.friends });
    },
    onError: toastError,
  });
}

/** WI-042: add an existing friend directly to a group; server enforces the friendship. */
export function useAddMemberByFriend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, userId }: { groupId: string; userId: string }) =>
      api.groups.addMemberByFriend(groupId, { userId }),
    onSuccess: (group: GroupDto) => {
      invalidateForGroupChange(queryClient, group.id);
      void queryClient.invalidateQueries({ queryKey: queryKeys.friends });
    },
    onError: toastError,
  });
}

export function useUpdateMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      groupId,
      userId,
      role,
    }: {
      groupId: string;
      userId: string;
      role: MemberRole;
    }) => api.groups.updateMember(groupId, userId, { role }),
    onSuccess: (group: GroupDto) => invalidateForGroupChange(queryClient, group.id),
    onError: toastError,
  });
}

export function useRemoveMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, userId }: { groupId: string; userId: string }) =>
      api.groups.removeMember(groupId, userId),
    onSuccess: (group: GroupDto) => {
      invalidateForGroupChange(queryClient, group.id);
      void queryClient.invalidateQueries({ queryKey: queryKeys.balance });
    },
    onError: toastError,
  });
}

export function useLeaveGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) => api.groups.leave(groupId),
    onSuccess: (_data, groupId) => {
      invalidateForGroupChange(queryClient, groupId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.balance });
      void queryClient.invalidateQueries({ queryKey: queryKeys.friends });
    },
    onError: toastError,
  });
}

/**
 * WI-046: admin-only, group-wide-settled permanent (soft) delete. Distinct
 * from archive — invalidates the group and the groups list so the deleted
 * group cannot linger in any cached view. Errors (403 FORBIDDEN, 409
 * OUTSTANDING_BALANCE, 404) surface via the default `toastError` with the
 * API's message verbatim, same as `useLeaveGroup`/`useArchiveGroup`.
 */
export function useDeleteGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) => api.groups.delete(groupId),
    onSuccess: (_data, groupId) => {
      invalidateForGroupChange(queryClient, groupId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.balance });
    },
    onError: toastError,
  });
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export function useExpensesInfinite(filters: ExpenseFilters = {}) {
  return useInfiniteQuery({
    queryKey: queryKeys.expenses(filters),
    queryFn: ({ pageParam }) =>
      api.expenses.list({ ...clean(filters), cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

export function useExpense(expenseId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.expense(expenseId),
    queryFn: () => api.expenses.get(expenseId),
    enabled: enabled && expenseId.length > 0,
  });
}

/**
 * WI-017: per-expense edit history. Invalidated for free by
 * `invalidateForExpenseChange`'s `['expense']` invalidation (React Query's
 * default partial-key matching treats `['expense']` as a prefix of
 * `['expense', expenseId, 'history']`), so create/update already refresh it.
 */
export function useExpenseHistory(expenseId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.expenseHistory(expenseId),
    queryFn: () => api.expenses.history(expenseId),
    enabled: enabled && expenseId.length > 0,
  });
}

export function useCreateExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateExpenseInput) => api.expenses.create(input),
    onSuccess: (expense: ExpenseDto) => invalidateForExpenseChange(queryClient, expense.groupId),
    onError: toastError,
  });
}

export function useUpdateExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ expenseId, input }: { expenseId: string; input: UpdateExpenseInput }) =>
      api.expenses.update(expenseId, input),
    onSuccess: (expense: ExpenseDto) => {
      invalidateForExpenseChange(queryClient, expense.groupId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.expense(expense.id) });
    },
    onError: toastError,
  });
}

/**
 * WI-032 / WI-063 / WI-064: distinct non-deleted categories used in a group,
 * with a friend, or (WI-064, opt-in via `options.unscoped`) across all of the
 * caller's expenses — for the editor's narrowed category picker (group scope
 * only) and the expense list's narrowed category pill row (all three scopes).
 * Disabled unless at least one scope is present or `options.unscoped` is
 * `true` — the opt-in exists because an empty scope object is otherwise
 * ambiguous between the unscoped "All expenses" list (enable) and the
 * editor's non-group new-expense picker (must stay disabled / show-all).
 * Invalidated by `invalidateForExpenseChange` on every expense
 * create/update/delete (defect-WI-032-D1: the app's global `staleTime` is
 * 30s, so relying on "next time it's opened" without an explicit invalidation
 * left this stale for up to 30s after a mutation — WI-063 extended this to
 * the friend scope; the broad `['usedCategories']` prefix already covers the
 * WI-064 unscoped key `['usedCategories', {}]`, no invalidation change needed).
 */
export function useUsedCategories(
  scope: { groupId?: string; friendId?: string },
  options: { unscoped?: boolean } = {},
) {
  return useQuery({
    queryKey: queryKeys.usedCategories(scope),
    queryFn: () =>
      api.expenses.usedCategories(
        scope.groupId
          ? { groupId: scope.groupId }
          : scope.friendId
            ? { friendId: scope.friendId }
            : {},
      ),
    enabled: Boolean(scope.groupId || scope.friendId) || options.unscoped === true,
  });
}

export function useDeleteExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ expenseId }: { expenseId: string; groupId?: string | null }) =>
      api.expenses.remove(expenseId),
    onSuccess: (_data, variables) =>
      invalidateForExpenseChange(queryClient, variables.groupId),
    onError: toastError,
  });
}

/**
 * WI-054b: undo a soft delete. Mirrors `useDeleteExpense`'s shape — the
 * mutation returns the updated (now-active) `ExpenseDto`, so both the
 * expense-scoped and the group-scoped invalidation fire, the same as
 * `useUpdateExpense`. `invalidateForExpenseChange` already covers every
 * surface the restored expense re-enters (lists, balances, friends,
 * activity, analytics) — no dedicated restore-only invalidation needed.
 */
export function useRestoreExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ expenseId }: { expenseId: string; groupId?: string | null }) =>
      api.expenses.restore(expenseId),
    onSuccess: (expense: ExpenseDto, variables) => {
      invalidateForExpenseChange(queryClient, variables.groupId ?? expense.groupId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.expense(expense.id) });
    },
    onError: toastError,
  });
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export function useComments(expenseId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.comments(expenseId),
    queryFn: () => api.expenses.comments(expenseId),
    enabled: enabled && expenseId.length > 0,
  });
}

export function useAddComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ expenseId, body }: { expenseId: string; body: string }) =>
      api.expenses.addComment(expenseId, { body }),
    onSuccess: (comment) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.comments(comment.expenseId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.expense(comment.expenseId) });
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
    onError: toastError,
  });
}

// ---------------------------------------------------------------------------
// Settlements
// ---------------------------------------------------------------------------

export function useSettlementsInfinite(
  filters: SettlementFilters = {},
  options: { enabled?: boolean } = {},
) {
  return useInfiniteQuery({
    queryKey: queryKeys.settlements(filters),
    queryFn: ({ pageParam }) =>
      api.settlements.list({ ...clean(filters), cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: options.enabled ?? true,
  });
}

/**
 * WI-039b: single-settlement detail fetch for `SettlementDetailDialog`.
 * Mirrors `useExpense` exactly, including the soft-delete contract — the
 * server's `GET /settlements/:id` never 404s a deleted settlement (it
 * returns 200 with `deletedAt` populated), so this hook's `isError` branch
 * is reserved for genuine network/500 failures, not the "deleted" state.
 */
export function useSettlement(settlementId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.settlement(settlementId),
    queryFn: () => api.settlements.get(settlementId),
    enabled: enabled && settlementId.length > 0,
  });
}

export function useCreateSettlement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSettlementInput) => api.settlements.create(input),
    onSuccess: (settlement: SettlementDto) =>
      invalidateForExpenseChange(queryClient, settlement.groupId),
    onError: toastError,
  });
}

export function useDeleteSettlement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ settlementId }: { settlementId: string; groupId?: string | null }) =>
      api.settlements.remove(settlementId),
    onSuccess: (_data, variables) =>
      invalidateForExpenseChange(queryClient, variables.groupId),
    onError: toastError,
  });
}

/**
 * WI-054b: undo a settlement soft delete. Mirrors `useRestoreExpense`'s
 * shape — the mutation returns the restored (now-active) `SettlementDto`,
 * so both the group-scoped invalidation and an explicit settlement-detail
 * invalidation fire. The `queryKeys.settlement(id)` invalidation is
 * load-bearing: it's what forces an open `SettlementDetailDialog`'s
 * `useSettlement` to refetch out of the deleted state and into the active
 * one after Restore, instead of leaving a dead/stale-closed state.
 */
export function useRestoreSettlement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ settlementId }: { settlementId: string; groupId?: string | null }) =>
      api.settlements.restore(settlementId),
    onSuccess: (settlement: SettlementDto, variables) => {
      invalidateForExpenseChange(queryClient, variables.groupId ?? settlement.groupId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.settlement(settlement.id) });
    },
    onError: toastError,
  });
}

// ---------------------------------------------------------------------------
// Friends & overall balance
// ---------------------------------------------------------------------------

export function useFriends() {
  return useQuery({
    queryKey: queryKeys.friends,
    queryFn: () => api.friends.list(),
  });
}

/**
 * WI-070: single-friend read, modeled directly on `useGroup` — narrow pair
 * query instead of fetching the whole friends list just to find one row.
 * No explicit `staleTime` override; inherits the app default, same as
 * `useGroup`.
 */
export function useFriend(friendId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.friend(friendId),
    queryFn: () => api.friends.get(friendId),
    enabled: enabled && friendId.length > 0,
  });
}

export function useAddFriend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddFriendInput) => api.friends.add(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.friends });
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
    onError: toastError,
  });
}

/** WI-040: the caller's persistent friend-add code, created lazily server-side. */
export function useFriendCode() {
  return useQuery({
    queryKey: queryKeys.friendCode,
    queryFn: () => api.friends.code(),
  });
}

/** WI-040: regenerate the caller's code — the old value stops resolving. */
export function useRotateFriendCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.friends.rotateCode(),
    onSuccess: (code) => {
      queryClient.setQueryData(queryKeys.friendCode, code);
    },
    onError: toastError,
  });
}

/** WI-040: resolve a shared code to a user and run the standard add-friend flow. */
export function useAddFriendByCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api.friends.addByCode({ code }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.friends });
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
    onError: toastError,
  });
}

/**
 * WI-066: hard-removes the caller's friendship with `userId`. Deliberately
 * has NO hook-level `onError` — the friend detail page must special-case a
 * 404 `FRIENDSHIP_NOT_FOUND` (treat as "already removed", no alarming toast)
 * without double-toasting, and TanStack Query fires both hook-level and
 * mutate-call-level `onError` callbacks. All error handling (including the
 * 409 `OUTSTANDING_BALANCE` verbatim toast) lives at the call site instead.
 */
export function useRemoveFriend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.friends.remove(userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.friends });
      void queryClient.invalidateQueries({ queryKey: queryKeys.balance });
    },
  });
}

export function useOverallBalance() {
  return useQuery({
    queryKey: queryKeys.balance,
    queryFn: () => api.balance.overall(),
  });
}

/** Alias — CONTRACTS names the key ['balance']. */
export const useBalance = useOverallBalance;

// ---------------------------------------------------------------------------
// Activity & notifications
// ---------------------------------------------------------------------------

export function useActivityInfinite(groupId?: string | null) {
  return useInfiniteQuery({
    queryKey: queryKeys.activity(groupId),
    queryFn: ({ pageParam }) =>
      api.activity.list({
        groupId: groupId ?? undefined,
        cursor: pageParam ?? undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

export function useNotificationsList(enabled: boolean = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.notifications,
    queryFn: ({ pageParam }) =>
      api.notifications.list({ cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled,
  });
}

export function useUnreadCount() {
  const status = useAuthStore((s) => s.status);
  return useQuery({
    queryKey: queryKeys.unreadCount,
    queryFn: () => api.notifications.unreadCount(),
    enabled: status === 'authed',
    refetchInterval: 60_000,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) => api.notifications.markRead(notificationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
      void queryClient.invalidateQueries({ queryKey: queryKeys.unreadCount });
    },
    onError: toastError,
  });
}

/** WI-056: removes a notification from the visible list, independent of readAt. */
export function useClearNotification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) => api.notifications.clear(notificationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
      void queryClient.invalidateQueries({ queryKey: queryKeys.unreadCount });
    },
    onError: toastError,
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.notifications.markAllRead(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
      void queryClient.invalidateQueries({ queryKey: queryKeys.unreadCount });
    },
    onError: toastError,
  });
}

/** WI-065: bulk-clears every uncleared notification the caller owns (never optimistic). */
export function useClearAllNotifications() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.notifications.clearAll(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
      void queryClient.invalidateQueries({ queryKey: queryKeys.unreadCount });
    },
    onError: toastError,
  });
}

// ---------------------------------------------------------------------------
// Recurring expenses
// ---------------------------------------------------------------------------

export function useRecurring() {
  return useQuery({
    queryKey: queryKeys.recurring,
    queryFn: () => api.recurring.list(),
  });
}

export function useCreateRecurring() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRecurringInput) => api.recurring.create(input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.recurring }),
    onError: toastError,
  });
}

export function useUpdateRecurring() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ recurringId, input }: { recurringId: string; input: UpdateRecurringInput }) =>
      api.recurring.update(recurringId, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.recurring }),
    onError: toastError,
  });
}

export function useDeleteRecurring() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (recurringId: string) => api.recurring.remove(recurringId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.recurring }),
    onError: toastError,
  });
}

// ---------------------------------------------------------------------------
// Analytics & rates
// ---------------------------------------------------------------------------

export function useAnalytics(params: AnalyticsParams = {}) {
  return useQuery({
    queryKey: queryKeys.analytics(params),
    queryFn: () => api.analytics.summary(clean(params)),
    staleTime: 5 * 60_000,
  });
}

export function useRates(base: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.rates(base),
    queryFn: () => api.rates.get(base),
    enabled: enabled && base.length === 3,
    staleTime: 60 * 60_000,
  });
}

/**
 * WI-002: submits a user-supplied "1 from = ? to" rate. No `onError` toast —
 * the manual-rate prompt shows the server's message inline and stays open,
 * per spec-WI-002 (a 4xx here is an expected validation outcome, not a
 * surprise failure worth a global toast).
 */
export function useCreateManualRate() {
  return useMutation({
    mutationFn: (input: ManualRateInput) => api.rates.manual(input),
  });
}

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

export function useUploadReceipt() {
  return useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.uploads.receipt(formData);
    },
    onError: toastError,
  });
}

/**
 * WI-035: uploads a profile picture, returning `{ url }` only — it does NOT
 * also PATCH /users/me. Call sites must chain
 * `updateMe.mutate({ avatarUrl: url })` themselves on success, keeping the
 * upload and the profile PATCH as two distinct, independently-pending calls
 * (WI-035 §4).
 */
export function useUploadAvatar() {
  return useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.uploads.avatar(formData);
    },
    onError: toastError,
  });
}
