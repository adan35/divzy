// Idempotent demo seed: 4 users, a Lisbon Trip group (EUR) with varied split
// types + a settlement, a Flat 12 home group (USD) with a monthly recurring
// rent + utilities, and one non-group expense. Safe to re-run.
import type { $Enums, Prisma } from '@prisma/client';
import {
  AVATAR_COLORS,
  computeSplits,
  type SplitItemInput,
  type SplitParticipantInput,
  type SplitType,
} from '@divzy/shared';
import { hashPassword } from '../src/lib/auth';
import { prisma } from '../src/lib/prisma';
import { ensureFriendshipsAmong } from '../src/lib/social';

const DEMO_PASSWORD = 'password123';

const daysAgo = (n: number): Date => new Date(Date.now() - n * 86_400_000);

function firstOfNextMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 9, 0, 0));
}

async function upsertUser(
  email: string,
  name: string,
  avatarColor: string,
  defaultCurrency: string,
  passwordHash: string,
) {
  return prisma.user.upsert({
    where: { email },
    update: { name, avatarColor },
    create: { email, name, avatarColor, defaultCurrency, passwordHash },
  });
}

async function upsertMember(groupId: string, userId: string, role: $Enums.MemberRole) {
  return prisma.groupMember.upsert({
    where: { groupId_userId: { groupId, userId } },
    update: { role, leftAt: null },
    create: { groupId, userId, role },
  });
}

interface SeedExpense {
  groupId: string | null;
  description: string;
  amount: number;
  currency: string;
  category: $Enums.ExpenseCategory;
  date: Date;
  splitType: SplitType;
  createdById: string;
  payers: Array<{ userId: string; amount: number }>;
  participants: SplitParticipantInput[];
  items?: SplitItemInput[];
  notes?: string;
}

async function ensureExpense(e: SeedExpense): Promise<void> {
  const existing = await prisma.expense.findFirst({
    where: { description: e.description, groupId: e.groupId },
    select: { id: true },
  });
  if (existing) return;

  const payerSum = e.payers.reduce((acc, p) => acc + p.amount, 0);
  if (payerSum !== e.amount) {
    throw new Error(`Seed bug: payers for "${e.description}" sum to ${payerSum}, not ${e.amount}`);
  }

  const splits = computeSplits({
    splitType: e.splitType,
    amount: e.amount,
    participants: e.participants,
    items: e.items,
  });
  const inputByUser = new Map(e.participants.map((p) => [p.userId, p]));

  await prisma.expense.create({
    data: {
      groupId: e.groupId,
      description: e.description,
      amount: e.amount,
      currency: e.currency,
      category: e.category,
      date: e.date,
      splitType: e.splitType,
      notes: e.notes ?? null,
      createdById: e.createdById,
      payers: { create: e.payers.map((p) => ({ userId: p.userId, amount: p.amount })) },
      splits: {
        create: splits.map((s) => ({
          userId: s.userId,
          amount: s.amount,
          shares: inputByUser.get(s.userId)?.shares ?? null,
          percentBps: inputByUser.get(s.userId)?.percentBps ?? null,
          adjustment: inputByUser.get(s.userId)?.adjustment ?? null,
        })),
      },
      items: e.items
        ? {
            create: e.items.map((i) => ({
              name: i.name,
              amount: i.amount,
              participantIds: i.participantIds,
            })),
          }
        : undefined,
    },
  });
}

async function main(): Promise<void> {
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  // -- Users ----------------------------------------------------------------
  const ana = await upsertUser('ana@divzy.dev', 'Ana Costa', AVATAR_COLORS[0], 'EUR', passwordHash);
  const sam = await upsertUser('sam@divzy.dev', 'Sam Rivera', AVATAR_COLORS[1], 'USD', passwordHash);
  const lee = await upsertUser('lee@divzy.dev', 'Lee Chen', AVATAR_COLORS[2], 'USD', passwordHash);
  const mia = await upsertUser('mia@divzy.dev', 'Mia Novak', AVATAR_COLORS[3], 'EUR', passwordHash);

  await ensureFriendshipsAmong([ana.id, sam.id, lee.id, mia.id]);

  // -- Lisbon Trip (EUR, all four) -------------------------------------------
  const lisbon = await prisma.group.upsert({
    where: { inviteCode: 'LISBONTRIP' },
    update: {},
    create: {
      name: 'Lisbon Trip',
      emoji: '✈️',
      type: 'TRIP',
      currency: 'EUR',
      inviteCode: 'LISBONTRIP',
      simplifyDebts: true,
      createdById: ana.id,
    },
  });
  await upsertMember(lisbon.id, ana.id, 'ADMIN');
  await upsertMember(lisbon.id, sam.id, 'MEMBER');
  await upsertMember(lisbon.id, lee.id, 'MEMBER');
  await upsertMember(lisbon.id, mia.id, 'MEMBER');

  const allFour = [ana.id, sam.id, lee.id, mia.id];

  await ensureExpense({
    groupId: lisbon.id,
    description: 'Dinner at Time Out Market',
    amount: 9640,
    currency: 'EUR',
    category: 'FOOD_DRINK',
    date: daysAgo(9),
    splitType: 'EQUAL',
    createdById: ana.id,
    payers: [{ userId: ana.id, amount: 9640 }],
    participants: allFour.map((userId) => ({ userId })),
  });

  await ensureExpense({
    groupId: lisbon.id,
    description: 'Airbnb — 3 nights in Alfama',
    amount: 54000,
    currency: 'EUR',
    category: 'TRAVEL',
    date: daysAgo(11),
    splitType: 'SHARES',
    createdById: sam.id,
    payers: [{ userId: sam.id, amount: 54000 }],
    participants: [
      { userId: ana.id, shares: 2 },
      { userId: sam.id, shares: 2 },
      { userId: lee.id, shares: 1 },
      { userId: mia.id, shares: 1 },
    ],
    notes: 'Ana and Sam took the big room.',
  });

  await ensureExpense({
    groupId: lisbon.id,
    description: 'Tram 28 day tickets',
    amount: 1200,
    currency: 'EUR',
    category: 'TRANSPORT',
    date: daysAgo(10),
    splitType: 'EXACT',
    createdById: lee.id,
    payers: [{ userId: lee.id, amount: 1200 }],
    participants: allFour.map((userId) => ({ userId, amount: 300 })),
  });

  // Multi-payer expense: Ana and Mia split the register.
  await ensureExpense({
    groupId: lisbon.id,
    description: 'Groceries for the apartment',
    amount: 6375,
    currency: 'EUR',
    category: 'GROCERIES',
    date: daysAgo(10),
    splitType: 'PERCENT',
    createdById: mia.id,
    payers: [
      { userId: ana.id, amount: 4000 },
      { userId: mia.id, amount: 2375 },
    ],
    participants: allFour.map((userId) => ({ userId, percentBps: 2500 })),
  });

  // Itemized expense with a shared tip on top of the items.
  await ensureExpense({
    groupId: lisbon.id,
    description: 'Seafood lunch at Cervejaria Ramiro',
    amount: 7850,
    currency: 'EUR',
    category: 'FOOD_DRINK',
    date: daysAgo(9),
    splitType: 'ITEMIZED',
    createdById: mia.id,
    payers: [{ userId: mia.id, amount: 7850 }],
    participants: allFour.map((userId) => ({ userId })),
    items: [
      { name: 'Seafood platter', amount: 4500, participantIds: [ana.id, sam.id, mia.id] },
      { name: 'Vinho verde', amount: 1800, participantIds: [ana.id, lee.id] },
      { name: 'Dessert', amount: 900, participantIds: [sam.id, mia.id] },
    ],
    notes: 'Total includes a €6.50 tip split proportionally.',
  });

  await ensureExpense({
    groupId: lisbon.id,
    description: 'Sintra day trip tickets',
    amount: 8000,
    currency: 'EUR',
    category: 'ENTERTAINMENT',
    date: daysAgo(8),
    splitType: 'ADJUSTMENT',
    createdById: ana.id,
    payers: [{ userId: ana.id, amount: 8000 }],
    participants: [
      { userId: ana.id },
      { userId: sam.id, adjustment: 1000 },
      { userId: lee.id },
      { userId: mia.id },
    ],
    notes: 'Sam grabbed the audio guide (+€10).',
  });

  const lisbonSettlement = await prisma.settlement.findFirst({
    where: { groupId: lisbon.id, fromUserId: sam.id, toUserId: ana.id, amount: 12000 },
    select: { id: true },
  });
  if (!lisbonSettlement) {
    await prisma.settlement.create({
      data: {
        groupId: lisbon.id,
        fromUserId: sam.id,
        toUserId: ana.id,
        amount: 12000,
        currency: 'EUR',
        method: 'BANK_TRANSFER',
        note: 'First chunk of the trip balance',
        date: daysAgo(6),
        createdById: sam.id,
      },
    });
  }

  // -- Flat 12 (USD home group: Ana, Sam, Lee) --------------------------------
  const flat = await prisma.group.upsert({
    where: { inviteCode: 'FLATTWELVE' },
    update: {},
    create: {
      name: 'Flat 12',
      emoji: '🏠',
      type: 'HOME',
      currency: 'USD',
      inviteCode: 'FLATTWELVE',
      simplifyDebts: true,
      createdById: sam.id,
    },
  });
  await upsertMember(flat.id, sam.id, 'ADMIN');
  await upsertMember(flat.id, ana.id, 'MEMBER');
  await upsertMember(flat.id, lee.id, 'MEMBER');
  await ensureFriendshipsAmong([ana.id, sam.id, lee.id]);

  const flatmates: SplitParticipantInput[] = [
    { userId: ana.id },
    { userId: sam.id },
    { userId: lee.id },
  ];

  const rentRecurring = await prisma.recurringExpense.findFirst({
    where: { groupId: flat.id, description: 'Rent' },
    select: { id: true },
  });
  if (!rentRecurring) {
    // Validate the stored split inputs the same way the API would.
    computeSplits({ splitType: 'EQUAL', amount: 240000, participants: flatmates });
    await prisma.recurringExpense.create({
      data: {
        groupId: flat.id,
        description: 'Rent',
        amount: 240000,
        currency: 'USD',
        category: 'RENT',
        splitType: 'EQUAL',
        payers: [{ userId: sam.id, amount: 240000 }] as Prisma.InputJsonValue,
        participants: flatmates.map((p) => ({ userId: p.userId })) as Prisma.InputJsonValue,
        frequency: 'MONTHLY',
        nextRunAt: firstOfNextMonth(),
        createdById: sam.id,
      },
    });
  }

  await ensureExpense({
    groupId: flat.id,
    description: 'Electricity + water bill',
    amount: 14532,
    currency: 'USD',
    category: 'UTILITIES',
    date: daysAgo(4),
    splitType: 'EQUAL',
    createdById: lee.id,
    payers: [{ userId: lee.id, amount: 14532 }],
    participants: flatmates.map((p) => ({ userId: p.userId })),
  });

  // -- Non-group expense between Ana and Sam ----------------------------------
  await ensureExpense({
    groupId: null,
    description: 'Concert tickets',
    amount: 15000,
    currency: 'USD',
    category: 'ENTERTAINMENT',
    date: daysAgo(2),
    splitType: 'EQUAL',
    createdById: ana.id,
    payers: [{ userId: ana.id, amount: 15000 }],
    participants: [{ userId: ana.id }, { userId: sam.id }],
  });

  console.log('Divzy demo data seeded. Log in with any of:');
  console.log('  ana@divzy.dev / password123');
  console.log('  sam@divzy.dev / password123');
  console.log('  lee@divzy.dev / password123');
  console.log('  mia@divzy.dev / password123');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err: unknown) => {
    console.error('Seed failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
