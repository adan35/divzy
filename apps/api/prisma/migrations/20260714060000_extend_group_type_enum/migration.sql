-- WI-007: extend GroupType with 10 new values. Additive only — no existing
-- value is renamed or removed, and no row's `type` column is altered. Existing
-- rows keep their current value (one of the original 6) and remain valid and
-- readable with no backfill; Postgres enum ADD VALUE is purely additive to the
-- type's legal value set.
--
-- Note: a newly-added enum value cannot be used in the same transaction that
-- adds it (PG12+ restriction). This migration only adds values — it does not
-- INSERT/UPDATE any row referencing them — so it is safe to apply as a single
-- migration.
ALTER TYPE "GroupType" ADD VALUE 'FAMILY';
ALTER TYPE "GroupType" ADD VALUE 'ROOMMATES';
ALTER TYPE "GroupType" ADD VALUE 'WORK';
ALTER TYPE "GroupType" ADD VALUE 'CLUB';
ALTER TYPE "GroupType" ADD VALUE 'SPORTS_TEAM';
ALTER TYPE "GroupType" ADD VALUE 'EVENT';
ALTER TYPE "GroupType" ADD VALUE 'SCHOOL';
ALTER TYPE "GroupType" ADD VALUE 'SUBSCRIPTION';
ALTER TYPE "GroupType" ADD VALUE 'NIGHT_OUT';
ALTER TYPE "GroupType" ADD VALUE 'CHARITY';
