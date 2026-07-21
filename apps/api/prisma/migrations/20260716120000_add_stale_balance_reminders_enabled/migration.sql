-- WI-016 (reminders half, auth slice): additive opt-in preference read (read-only)
-- by settlements to gate the stale-balance reminder scan. Default false = true
-- opt-in (Checkpoint 1 + DRB C3). NOT NULL with a default backfills existing rows
-- to false with no separate backfill step.
ALTER TABLE "User" ADD COLUMN "staleBalanceRemindersEnabled" BOOLEAN NOT NULL DEFAULT false;
