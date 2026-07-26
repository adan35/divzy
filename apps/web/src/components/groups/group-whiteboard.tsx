'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useGroupWhiteboard, useUpdateGroupWhiteboard } from '@/lib/hooks';
import { errorMessage } from '@/lib/hooks';
import { formatDateFull } from '@/lib/format';
import { LIMITS } from '@divzy/shared';

const NOTICE =
  "Visible to all members of this group — please don't store passwords or other sensitive information here.";

/**
 * RENDERING CONTRACT (DRB-security condition C1 / WI-087):
 * The whiteboard `body` is plain text only. It is rendered either as a
 * `<textarea>` value or via React JSX text-node interpolation. There is no
 * `dangerouslySetInnerHTML`, no markdown parser, and no HTML construction.
 * Future mobile parity surfaces must inherit this exact contract.
 */
export function GroupWhiteboard({ groupId, enabled = true }: { groupId: string; enabled?: boolean }) {
  const query = useGroupWhiteboard(groupId, enabled);
  const mutation = useUpdateGroupWhiteboard();
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (query.isSuccess && query.data.body !== undefined && !mutation.isPending) {
      setDraft(query.data.body);
    }
  }, [query.isSuccess, query.data?.body, mutation.isPending]);

  const currentBody = query.data?.body ?? '';
  const atLimit = draft.length > LIMITS.GROUP_WHITEBOARD_BODY_MAX;
  const unchanged = draft === currentBody;
  const canSave = !unchanged && !atLimit && !mutation.isPending && !query.isLoading;

  const handleSave = () => {
    if (!canSave) return;
    mutation.mutate({ groupId, body: draft });
  };

  return (
    <Card className="space-y-4 p-4">
      <div className="space-y-1">
        <p className="text-sm text-ink-2">{NOTICE}</p>
        <p className="text-xs text-ink-3">No revision history is kept — only the latest version is stored.</p>
      </div>

      {query.isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading whiteboard">
          <Skeleton className="h-24 w-full" />
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
      ) : query.isError ? (
        <p className="text-sm text-danger">{errorMessage(query.error)}</p>
      ) : (
        <>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a shared note for this group..."
            rows={8}
            aria-label="Group whiteboard"
            invalid={atLimit}
            disabled={mutation.isPending}
          />

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p
              className={`text-xs ${atLimit ? 'text-danger' : 'text-ink-3'}`}
              aria-live="polite"
            >
              {draft.length}/{LIMITS.GROUP_WHITEBOARD_BODY_MAX} characters
            </p>
            <Button onClick={handleSave} loading={mutation.isPending} disabled={!canSave}>
              Save
            </Button>
          </div>

          <Attribution data={query.data} />
        </>
      )}
    </Card>
  );
}

function Attribution({ data }: { data: { updatedBy: { name: string } | null; updatedAt: string | null } | undefined }) {
  if (!data || !data.updatedBy || !data.updatedAt) {
    return <p className="text-xs text-ink-3">No edits yet</p>;
  }

  const updatedAt = new Date(data.updatedAt);
  return (
    <p className="text-xs text-ink-3">
      Last edited by {data.updatedBy.name} on {formatDateFull(updatedAt)} at{' '}
      {format(updatedAt, 'h:mm a')}
    </p>
  );
}
