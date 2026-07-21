'use client';

import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/auth-store';
import { useActivityInfinite, useFriends, useGroups } from '@/lib/hooks';
import { PageHeader } from '@/components/ui/page-header';
import { ActivityPreview } from '@/components/dashboard/activity-preview';
import { PulseHero } from '@/components/dashboard/pulse-hero';
import { DashboardChartSlot } from '@/components/dashboard/chart-slot';
import { FriendsPreview } from '@/components/dashboard/friends-preview';
import { GroupsPreview } from '@/components/dashboard/groups-preview';
import { OnboardingCard } from '@/components/dashboard/onboarding';
import { QuickActions } from '@/components/dashboard/quick-actions';
import { SpendSnapshotChartFallback } from '@/components/dashboard/spend-snapshot-chart-fallback';

// WI-072 (analytics perf batch): lazy-load chart chunk, see spec-WI-072.md §3
const SpendSnapshotChart = dynamic(
  () => import('@/components/dashboard/spend-snapshot-chart').then((m) => m.SpendSnapshotChart),
  { ssr: false, loading: () => <SpendSnapshotChartFallback /> },
);

function greetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardPage() {
  const { user } = useAuth();

  // These hooks share their cache with the preview sections below (same keys);
  // the page only reads them to decide whether to show first-run onboarding.
  const groups = useGroups();
  const friends = useFriends();
  const activity = useActivityInfinite(null);

  const firstName = user?.name.trim().split(/\s+/)[0] ?? '';
  const greeting = greetingForHour(new Date().getHours());

  const activeGroupCount = (groups.data ?? []).filter((g) => g.archivedAt === null).length;
  const activityCount = activity.data?.pages[0]?.items.length ?? 0;
  const isBrandNew =
    groups.isSuccess &&
    friends.isSuccess &&
    activity.isSuccess &&
    activeGroupCount === 0 &&
    (friends.data?.length ?? 0) === 0 &&
    activityCount === 0;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={firstName ? `${greeting}, ${firstName} 👋` : `${greeting} 👋`}
      />

      {isBrandNew ? (
        <OnboardingCard firstName={firstName} />
      ) : (
        <div className="space-y-8">
          <PulseHero />
          <QuickActions />
          <div className="grid items-start gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <GroupsPreview />
            </div>
            <FriendsPreview />
          </div>
          {/* WI-036: analytics' compact spend-chart slot — a sibling section,
              never a child of ActivityPreview. Self-contained (own fetch, own
              loading/error/empty states); no props/query key shared with the
              feed below. */}
          <DashboardChartSlot>
            <SpendSnapshotChart />
          </DashboardChartSlot>
          <ActivityPreview />
        </div>
      )}
    </>
  );
}
