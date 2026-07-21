import { useEffect, useState } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { ApiError, NetworkError } from '@divzy/api-client';
import type {
  AddFriendByCodeInput,
  AddFriendInput,
  AddMemberByFriendInput,
  AnalyticsQuery,
  ChangePasswordInput,
  CreateExpenseInput,
  CreateGroupInput,
  CreateRecurringInput,
  CreateSettlementInput,
  CurrencyAmount,
  ExpenseDto,
  FriendCodeDto,
  FriendDto,
  GroupDto,
  ListExpensesQuery,
  ListSettlementsQuery,
  ManualRateInput,
  MemberRole,
  NotificationPreferencesDto,
  RegisterPushTokenInput,
  SettlementDto,
  UpdateExpenseInput,
  UpdateGroupInput,
  UpdateMeInput,
  UpdateNotificationPreferencesInput,
  UpdateRecurringInput,
} from '@divzy/shared';
import { api } from './api';
import { useAuth } from './auth';
import { nextUnshownPair, type ManualRatePair } from './manualRatePrompt';

// ---------------------------------------------------------------------------
// Error handling — screens render the API's message verbatim (no Alerts here;
// mutation/query errors flow back through react-query state).
// ---------------------------------------------------------------------------

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof NetworkError) return 'Network error — check your connection and try again.';
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Please try again.';
}

// ---------------------------------------------------------------------------
// Query keys — EXACTLY per docs/CONTRACTS.md §Query keys (identical to web).
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
  expenses: (filters: ExpenseFilters = {}) => ['expenses', clean(filters)] as const,
  expense: (expenseId: string) => ['expense', expenseId] as const,
  expenseHistory: (expenseId: string) => ['expense', expenseId, 'history'] as const,
  comments: (expenseId: string) => ['comments', expenseId] as const,
  settlements: (filters: SettlementFilters = {}) => ['settlements', clean(filters)] as const,
  /** WI-039b — single-settlement detail read. */
  settlement: (settlementId: string) => ['settlement', settlementId] as const,
  friends: ['friends'] as const,
  friendCode: ['friend-code'] as const,
  balance: ['balance'] as const,
  activity: (groupId?: string | null) => ['activity', groupId ?? null] as const,
  notifications: ['notifications'] as const,
  unreadCount: ['unread-count'] as const,
  /** WI-041 — the caller's resolved 9-category push/email matrix. */
  notificationPreferences: ['notification-preferences'] as const,
  recurring: ['recurring'] as const,
  analytics: (params: AnalyticsParams = {}) => ['analytics', clean(params)] as const,
  rates: (base: string) => ['rates', base] as const,
  /** WI-032-3 — same slot/shape as web's queryKeys.usedCategories. */
  usedCategories: (groupId: string) => ['usedCategories', groupId] as const,
};

// ---------------------------------------------------------------------------
// Invalidation map (CONTRACTS.md) — shared by mutations and socket sync.
// ---------------------------------------------------------------------------

/**
 * After any expense or settlement change (mutation or socket event):
 * expenses lists + details, the group, groups, group balances, overall
 * balance, friends, activity and analytics all go stale.
 */
export function invalidateForExpenseChange(
  queryClient: QueryClient,
  groupId?: string | null,
): void {
  void queryClient.invalidateQueries({ queryKey: ['expenses'] });
  void queryClient.invalidateQueries({ queryKey: ['expense'] });
  void queryClient.invalidateQueries({ queryKey: ['settlements'] });
  // WI-039b — so an open settlement-detail screen refetches into the new
  // state (deletedAt populated after a delete, cleared after a WI-054b
  // restore) instead of showing stale data (spec-WI-039b §3, mirrors the
  // ['expense'] line above).
  void queryClient.invalidateQueries({ queryKey: ['settlement'] });
  void queryClient.invalidateQueries({ queryKey: ['groups'] });
  if (groupId) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.group(groupId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.groupBalances(groupId) });
    // WI-032-3 (ported defect-WI-032-D1 fix) — without this, a freshly-used
    // category would stay stale in the narrowed picker for up to the app's
    // 30s-class staleTime after a create/update/delete.
    void queryClient.invalidateQueries({ queryKey: queryKeys.usedCategories(groupId) });
  }
  void queryClient.invalidateQueries({ queryKey: ['group-balances'] });
  void queryClient.invalidateQueries({ queryKey: queryKeys.balance });
  void queryClient.invalidateQueries({ queryKey: queryKeys.friends });
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
  const { status } = useAuth();
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api.auth.me(),
    enabled: status === 'authed',
  });
}

export function useUpdateMe() {
  const queryClient = useQueryClient();
  const { setUser } = useAuth();
  return useMutation({
    mutationFn: (input: UpdateMeInput) => api.users.updateMe(input),
    onSuccess: (user) => {
      setUser(user);
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: ChangePasswordInput) => api.users.changePassword(input),
  });
}

export function useRegisterPushToken() {
  return useMutation({
    mutationFn: (input: RegisterPushTokenInput) => api.users.registerPushToken(input),
  });
}

/** React Native file descriptor (from expo-image-picker et al.). */
export interface AvatarFile {
  uri: string;
  name: string;
  type: string;
}

/**
 * WI-035 — uploads the picked image via `POST /uploads/avatars`, returning
 * `{ url }`. This is deliberately its OWN mutation hook, separate from
 * `useUpdateMe` — the caller still has to follow up with
 * `updateMe.mutate({ avatarUrl: url })` using its own `useUpdateMe()`
 * instance. Do not reuse one shared mutation instance across this and any
 * other Account control: that couples unrelated controls' pending/disabled
 * state (known recurring defect flagged in the WI-035 design + DRB review).
 */
export function useUploadAvatar() {
  return useMutation({
    mutationFn: (file: AvatarFile) => {
      const formData = new FormData();
      // React Native's FormData accepts {uri, name, type} file descriptors.
      formData.append('file', { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
      return api.uploads.avatar(formData);
    },
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

export function useCreateGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGroupInput) => api.groups.create(input),
    onSuccess: (group: GroupDto) => invalidateForGroupChange(queryClient, group.id),
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
  });
}

export function useUpdateGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, input }: { groupId: string; input: UpdateGroupInput }) =>
      api.groups.update(groupId, input),
    onSuccess: (group: GroupDto) => invalidateForGroupChange(queryClient, group.id),
  });
}

export function useArchiveGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) => api.groups.archive(groupId),
    onSuccess: (_data, groupId) => invalidateForGroupChange(queryClient, groupId),
  });
}

/** WI-027 — clears archivedAt, restoring the group to active (ADMIN-only server-side, idempotent). */
export function useUnarchiveGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) => api.groups.unarchive(groupId),
    onSuccess: (group: GroupDto) => invalidateForGroupChange(queryClient, group.id),
  });
}

export function useRotateInviteCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) => api.groups.rotateInviteCode(groupId),
    onSuccess: (group: GroupDto) => invalidateForGroupChange(queryClient, group.id),
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
  });
}

/** WI-042 — add an existing friend directly (server enforces the friendship; 403 NOT_FRIENDS otherwise). */
export function useAddMemberByFriend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, input }: { groupId: string; input: AddMemberByFriendInput }) =>
      api.groups.addMemberByFriend(groupId, input),
    onSuccess: (group: GroupDto) => {
      invalidateForGroupChange(queryClient, group.id);
      void queryClient.invalidateQueries({ queryKey: queryKeys.friends });
    },
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
  });
}

/**
 * WI-046 — soft-deletes the group entirely (ADMIN-only + group-wide
 * fully-settled, both server-authoritative; terminal, unlike archive).
 * The group is gone once this resolves, so its detail/balances caches are
 * dropped outright (`removeQueries`) rather than invalidated-and-refetched —
 * a refetch would just 404.
 */
export function useDeleteGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) => api.groups.delete(groupId),
    onSuccess: (_data, groupId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.groups });
      queryClient.removeQueries({ queryKey: queryKeys.group(groupId) });
      queryClient.removeQueries({ queryKey: queryKeys.groupBalances(groupId) });
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
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

export function useCreateExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateExpenseInput) => api.expenses.create(input),
    onSuccess: (expense: ExpenseDto) => invalidateForExpenseChange(queryClient, expense.groupId),
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.expenseHistory(expense.id) });
    },
  });
}

/**
 * WI-032-3: distinct non-deleted categories used in a group, for the
 * editor's narrowed category picker. Disabled for non-group (direct)
 * expenses. Invalidated by `invalidateForExpenseChange` on every expense
 * create/update/delete (ported defect-WI-032-D1 fix — without an explicit
 * invalidation this stays stale for up to the app's 30s-class staleTime
 * after a mutation that introduces a new category).
 */
export function useUsedCategories(groupId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.usedCategories(groupId ?? ''),
    // WI-063 (web-only spec): the shared api-client's `usedCategories` now
    // takes a scope object (`{ groupId } | { friendId }`). Mobile keeps its
    // existing group-only behavior unchanged — this is a mechanical
    // compile-fix for the widened signature, not new mobile capability.
    queryFn: () => api.expenses.usedCategories({ groupId: groupId! }),
    enabled: !!groupId,
  });
}

export function useDeleteExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ expenseId }: { expenseId: string; groupId?: string | null }) =>
      api.expenses.remove(expenseId),
    onSuccess: (_data, variables) => invalidateForExpenseChange(queryClient, variables.groupId),
  });
}

/**
 * WI-054b — undo a soft delete. Mirrors `useDeleteExpense` (mobile has no
 * `onError`, unlike web's `useRestoreExpense`, matching that sibling's
 * existing convention). Reuses `invalidateForExpenseChange` so every surface
 * the restored expense re-enters (list/detail/balances/friends/activity/
 * analytics) refreshes with no notifications-activity-owned file touched —
 * the struck-through activity feed row un-strikes itself purely from the
 * `['activity']` invalidation + the server's `group:changed`/`friends:changed`
 * socket emit (ADR-027 D4).
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

// ---------------------------------------------------------------------------
// Expense edit history (WI-017)
// ---------------------------------------------------------------------------

export function useExpenseHistory(expenseId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.expenseHistory(expenseId),
    queryFn: () => api.expenses.history(expenseId),
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
  });
}

// ---------------------------------------------------------------------------
// Settlements
// ---------------------------------------------------------------------------

export function useSettlementsInfinite(filters: SettlementFilters = {}) {
  return useInfiniteQuery({
    queryKey: queryKeys.settlements(filters),
    queryFn: ({ pageParam }) =>
      api.settlements.list({ ...clean(filters), cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

/** Alias — same infinite list, name mirrors the CONTRACTS hook manifest. */
export const useSettlements = useSettlementsInfinite;

/**
 * WI-039b — single-settlement detail (`GET /settlements/:settlementId`).
 * Deliberately has NO client-side `deletedAt` filtering of its own: the
 * endpoint returns 200 with `deletedAt` populated for a deleted settlement
 * (spec-WI-039b §1, DRB condition 2) and this hook passes that straight
 * through, exactly like `useExpense` passes through `ExpenseDto.deletedAt`.
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
  });
}

export function useDeleteSettlement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ settlementId }: { settlementId: string; groupId?: string | null }) =>
      api.settlements.remove(settlementId),
    onSuccess: (_data, variables) => invalidateForExpenseChange(queryClient, variables.groupId),
  });
}

/**
 * WI-054b — undo a soft delete. Mirrors `useRestoreExpense`: reuses
 * `invalidateForExpenseChange` so every surface the restored settlement
 * re-enters (list/balances/friends/activity/analytics) refreshes, PLUS an
 * explicit `queryKeys.settlement(id)` invalidation — load-bearing (spec §4.1)
 * so an open settlement-detail screen's `useSettlement` refetches into the
 * active state instead of staying on stale/dead deleted data.
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

export function useAddFriend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddFriendInput) => api.friends.add(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.friends });
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}

/** WI-040 — the caller's persistent friend-add code, created lazily server-side. */
export function useFriendCode() {
  return useQuery({
    queryKey: queryKeys.friendCode,
    queryFn: () => api.friends.code(),
  });
}

/** WI-040 — regenerates the caller's code, invalidating the old value. */
export function useRotateFriendCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.friends.rotateCode(),
    onSuccess: (data: FriendCodeDto) => {
      queryClient.setQueryData(queryKeys.friendCode, data);
    },
  });
}

/** WI-040 — resolve a scanned/typed code to a user and run the standard add-friend flow. */
export function useAddFriendByCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddFriendByCodeInput) => api.friends.addByCode(input),
    onSuccess: (_friend: FriendDto) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.friends });
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}

/** WI-066 — hard-removes the caller's friendship with userId (204; 404 FRIENDSHIP_NOT_FOUND; 409 OUTSTANDING_BALANCE). */
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

export function useNotificationsList() {
  return useInfiniteQuery({
    queryKey: queryKeys.notifications,
    queryFn: ({ pageParam }) => api.notifications.list({ cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

/** Alias — same infinite list, name mirrors web. */
export const useNotifications = useNotificationsList;

export function useUnreadCount() {
  const { status } = useAuth();
  return useQuery({
    queryKey: queryKeys.unreadCount,
    queryFn: () => api.notifications.unreadCount(),
    enabled: status === 'authed',
    refetchInterval: 60_000,
  });
}

/**
 * WI-056 — clear, mark-read, and mark-all-read all touch the same two
 * queries: the notifications list (so the row disappears/updates) and the
 * unread-count badge. Extracted so the rule is unit-testable without
 * rendering (see wi056-clear-notification-invalidation.test.ts) — mirrors
 * `invalidateForExpenseChange`'s shape above.
 */
export function invalidateForNotificationChange(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
  void queryClient.invalidateQueries({ queryKey: queryKeys.unreadCount });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) => api.notifications.markRead(notificationId),
    onSuccess: () => invalidateForNotificationChange(queryClient),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.notifications.markAllRead(),
    onSuccess: () => invalidateForNotificationChange(queryClient),
  });
}

/**
 * WI-056 — "clear" removes a notification from the visible list, independent
 * of readAt (server: `POST /notifications/:id/clear`, idempotent). On
 * success the row leaves the list via the same invalidate-refetch as
 * mark-read/mark-all-read.
 */
export function useClearNotification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) => api.notifications.clear(notificationId),
    onSuccess: () => invalidateForNotificationChange(queryClient),
  });
}

/**
 * WI-065 — bulk-clears every uncleared notification the caller owns (server:
 * `POST /notifications/clear-all`, idempotent, own-only). Mirrors
 * `useMarkAllNotificationsRead` exactly: single mutation call, invalidate-on-
 * success only (no optimistic update), no `onError`.
 */
export function useClearAllNotifications() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.notifications.clearAll(),
    onSuccess: () => invalidateForNotificationChange(queryClient),
  });
}

// ---------------------------------------------------------------------------
// Notification preferences (WI-041, auth's slice)
// ---------------------------------------------------------------------------

/** GET /users/me/notification-preferences — fully-resolved 9-category matrix. */
export function useNotificationPreferences() {
  const { status } = useAuth();
  return useQuery({
    queryKey: queryKeys.notificationPreferences,
    queryFn: () => api.users.notificationPreferences(),
    enabled: status === 'authed',
  });
}

/**
 * PATCH /users/me/notification-preferences — partial per-cell upsert.
 * On success, patches the cached matrix directly from the just-sent values
 * (the endpoint returns 204, no body) rather than invalidating + refetching,
 * so a toggle reflects immediately — same "instant" UX convention as the
 * other Account toggles (`useUpdateMe`'s onSuccess sets the user locally).
 */
export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateNotificationPreferencesInput) =>
      api.users.updateNotificationPreferences(input),
    onSuccess: (_data, variables) => {
      queryClient.setQueryData<NotificationPreferencesDto>(
        queryKeys.notificationPreferences,
        (old) => {
          if (!old) return old;
          const patchByCategory = new Map(variables.preferences.map((p) => [p.category, p]));
          return {
            categories: old.categories.map((c) => {
              const patch = patchByCategory.get(c.category);
              if (!patch) return c;
              return {
                ...c,
                ...(patch.pushEnabled !== undefined ? { pushEnabled: patch.pushEnabled } : {}),
                ...(patch.emailEnabled !== undefined ? { emailEnabled: patch.emailEnabled } : {}),
              };
            }),
          };
        },
      );
    },
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
  });
}

export function useUpdateRecurring() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ recurringId, input }: { recurringId: string; input: UpdateRecurringInput }) =>
      api.recurring.update(recurringId, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.recurring }),
  });
}

export function useDeleteRecurring() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (recurringId: string) => api.recurring.remove(recurringId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.recurring }),
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

// ---------------------------------------------------------------------------
// Manual FX rate fallback prompt (WI-002) — one balance view's `unresolved`
// list surfaces at most one prompt at a time, deduped per pair for the app
// session (dedupe logic lives in lib/manualRatePrompt.ts, shared by the
// dashboard and the group Balances tab).
// ---------------------------------------------------------------------------

/**
 * Given a balance view's `unresolved` currencies and its viewer currency,
 * surfaces at most one not-yet-shown-this-session pair at a time. When the
 * caller dismisses/closes the current prompt (via `dismiss`), the next
 * distinct unresolved pair (if any) is queued automatically on the
 * following render — no separate queueing logic needed by callers.
 */
export function useManualRatePrompt(
  unresolved: CurrencyAmount[],
  viewerCurrency: string | null,
): { prompt: ManualRatePair | null; dismiss: () => void } {
  const [prompt, setPrompt] = useState<ManualRatePair | null>(null);

  useEffect(() => {
    if (prompt || !viewerCurrency) return;
    const next = nextUnshownPair(unresolved, viewerCurrency);
    if (next) setPrompt(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-derive only when inputs or the current prompt change
  }, [unresolved, viewerCurrency, prompt]);

  return { prompt, dismiss: () => setPrompt(null) };
}

/**
 * POST /api/v1/rates/manual — upserts on (userId, from, to); resubmitting
 * for the same pair overwrites the stored rate. Invalidates every balance
 * view so the newly-resolvable pair's converted figure updates immediately
 * (spec-WI-002, "Manual rate prompt — submit").
 */
export function useSubmitManualRate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ManualRateInput) => api.rates.manual(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.balance });
      void queryClient.invalidateQueries({ queryKey: ['group-balances'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

/** React Native file descriptor (from expo-image-picker et al.). */
export interface ReceiptFile {
  uri: string;
  name: string;
  type: string;
}

export function useUploadReceipt() {
  return useMutation({
    mutationFn: (file: ReceiptFile) => {
      const formData = new FormData();
      // React Native's FormData accepts {uri, name, type} file descriptors.
      formData.append('file', { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
      return api.uploads.receipt(formData);
    },
  });
}
