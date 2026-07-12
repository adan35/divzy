'use client';

import {
  useInfiniteQuery,
  useMutation,
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
  GroupDto,
  ListExpensesQuery,
  ListSettlementsQuery,
  LoginInput,
  MemberRole,
  RegisterInput,
  SettlementDto,
  UpdateExpenseInput,
  UpdateGroupInput,
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
  expenses: (filters: ExpenseFilters = {}) => ['expenses', clean(filters)] as const,
  expense: (expenseId: string) => ['expense', expenseId] as const,
  comments: (expenseId: string) => ['comments', expenseId] as const,
  settlements: (filters: SettlementFilters = {}) => ['settlements', clean(filters)] as const,
  friends: ['friends'] as const,
  balance: ['balance'] as const,
  activity: (groupId?: string | null) => ['activity', groupId ?? null] as const,
  notifications: ['notifications'] as const,
  unreadCount: ['unread-count'] as const,
  recurring: ['recurring'] as const,
  analytics: (params: AnalyticsParams = {}) => ['analytics', clean(params)] as const,
  rates: (base: string) => ['rates', base] as const,
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
  void queryClient.invalidateQueries({ queryKey: ['groups'] });
  if (groupId) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.group(groupId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.groupBalances(groupId) });
  }
  void queryClient.invalidateQueries({ queryKey: ['group-balances'] });
  void queryClient.invalidateQueries({ queryKey: queryKeys.balance });
  void queryClient.invalidateQueries({ queryKey: queryKeys.friends });
  void queryClient.invalidateQueries({ queryKey: ['activity'] });
  void queryClient.invalidateQueries({ queryKey: ['analytics'] });
}

function invalidateForGroupChange(queryClient: QueryClient, groupId?: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.groups });
  if (groupId) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.group(groupId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.groupBalances(groupId) });
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

export function useSettlementsInfinite(filters: SettlementFilters = {}) {
  return useInfiniteQuery({
    queryKey: queryKeys.settlements(filters),
    queryFn: ({ pageParam }) =>
      api.settlements.list({ ...clean(filters), cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
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
    onError: toastError,
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
    queryFn: ({ pageParam }) =>
      api.notifications.list({ cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
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
