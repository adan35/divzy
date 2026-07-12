import cron from 'node-cron';
import { pino } from 'pino';
import type { $Enums, RecurringExpense } from '@prisma/client';
import { zCreateExpenseInput } from '@divzy/shared';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { createExpense } from '../services/expense-service';

const log = pino({ name: 'recurring-job', level: env.NODE_ENV === 'test' ? 'silent' : 'info' });

/** Cap per run — the next tick (15 min later) drains any backlog. */
const BATCH_SIZE = 50;

/** One frequency step forward, preserving time-of-day. MONTHLY/YEARLY clamp
 *  the day-of-month to the target month's length (Jan 31 → Feb 28/29). */
function advanceOnce(from: Date, frequency: $Enums.RecurrenceFrequency): Date {
  const DAY_MS = 24 * 60 * 60 * 1000;
  switch (frequency) {
    case 'DAILY':
      return new Date(from.getTime() + DAY_MS);
    case 'WEEKLY':
      return new Date(from.getTime() + 7 * DAY_MS);
    case 'BIWEEKLY':
      return new Date(from.getTime() + 14 * DAY_MS);
    case 'MONTHLY': {
      const next = new Date(from.getTime());
      const day = from.getDate();
      next.setDate(1);
      next.setMonth(next.getMonth() + 1);
      const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
      next.setDate(Math.min(day, lastDay));
      return next;
    }
    case 'YEARLY': {
      const next = new Date(from.getTime());
      const day = from.getDate();
      next.setDate(1);
      next.setFullYear(next.getFullYear() + 1);
      const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
      next.setDate(Math.min(day, lastDay));
      return next;
    }
  }
}

/**
 * Advance FROM the scheduled occurrence, looping until the result is in the
 * future — missed occurrences (server downtime) collapse into the single
 * expense that was just posted rather than spamming a backlog.
 */
export function nextRunAfter(
  scheduled: Date,
  frequency: $Enums.RecurrenceFrequency,
  now: Date = new Date(),
): Date {
  let next = advanceOnce(scheduled, frequency);
  while (next.getTime() <= now.getTime()) {
    next = advanceOnce(next, frequency);
  }
  return next;
}

async function processRow(row: RecurringExpense, now: Date): Promise<void> {
  // Schedule exhausted — the next due occurrence falls after the end date.
  if (row.endDate && row.nextRunAt.getTime() > row.endDate.getTime()) {
    await prisma.recurringExpense.update({
      where: { id: row.id },
      data: { active: false },
    });
    log.info({ recurringExpenseId: row.id }, 'Recurring expense deactivated (past end date)');
    return;
  }

  // Rebuild a CreateExpenseInput from the stored row. Parsing through the
  // shared schema guards against malformed stored JSON before it reaches the
  // expense service.
  const input = zCreateExpenseInput.parse({
    groupId: row.groupId,
    description: row.description,
    amount: row.amount,
    currency: row.currency,
    category: row.category,
    date: row.nextRunAt.toISOString(),
    splitType: row.splitType,
    payers: row.payers,
    participants: row.participants,
    ...(row.notes ? { notes: row.notes } : {}),
  });

  // Same service the expenses route uses — activity (RECURRING_POSTED),
  // notifications, sockets and friendships all happen inside.
  const expense = await createExpense(row.createdById, input, { recurringExpenseId: row.id });

  const next = nextRunAfter(row.nextRunAt, row.frequency, now);
  const exhausted = row.endDate !== null && next.getTime() > row.endDate.getTime();
  await prisma.recurringExpense.update({
    where: { id: row.id },
    data: { lastRunAt: now, nextRunAt: next, ...(exhausted ? { active: false } : {}) },
  });
  log.info(
    { recurringExpenseId: row.id, expenseId: expense.id, nextRunAt: next.toISOString() },
    'Recurring expense posted',
  );
}

/** Post every due recurring expense. Per-row failures are logged, never fatal. */
export async function processDueRecurring(): Promise<void> {
  const now = new Date();
  const due = await prisma.recurringExpense.findMany({
    where: { active: true, nextRunAt: { lte: now } },
    orderBy: { nextRunAt: 'asc' },
    take: BATCH_SIZE,
  });

  for (const row of due) {
    try {
      await processRow(row, now);
    } catch (err) {
      log.error({ err, recurringExpenseId: row.id }, 'Failed to post recurring expense');
    }
  }
}

let running = false;

async function runOnce(): Promise<void> {
  if (running) return; // never overlap runs
  running = true;
  try {
    await processDueRecurring();
  } catch (err) {
    log.error({ err }, 'Recurring job run failed');
  } finally {
    running = false;
  }
}

let started = false;

/** Every 15 minutes + once ~10s after boot (catch up after restarts). */
export function startRecurringJob(): void {
  if (started) return;
  started = true;
  cron.schedule('*/15 * * * *', () => {
    void runOnce();
  });
  setTimeout(() => {
    void runOnce();
  }, 10_000).unref();
}
