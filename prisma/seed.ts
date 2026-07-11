/* eslint-disable no-console */
// Seed runs under the system role (DATABASE_URL): it creates tenants, which
// no tenant-scoped role could do. Idempotent — safe to re-run.
import { LedgerEntryType, PlanInterval, PrismaClient, UserRole } from '@prisma/client';
import { hashPassword } from '../src/auth/password.util';

const prisma = new PrismaClient();

interface SeedEntry {
  type: LedgerEntryType;
  amountCents: bigint;
  description: string;
}

const TENANTS = [
  { slug: 'northwind', name: 'Northwind Robotics' },
  { slug: 'acme', name: 'Acme Analytics' },
];

const PLANS = [
  { code: 'starter', name: 'Starter', amountCents: 4900, interval: PlanInterval.MONTHLY },
  { code: 'growth', name: 'Growth', amountCents: 19900, interval: PlanInterval.MONTHLY },
  { code: 'scale-annual', name: 'Scale (annual)', amountCents: 190000, interval: PlanInterval.YEARLY },
];

function demoLedger(): SeedEntry[] {
  return [
    { type: LedgerEntryType.CHARGE, amountCents: -19900n, description: 'Subscription charge — Growth' },
    { type: LedgerEntryType.PAYMENT, amountCents: 19900n, description: 'Card payment' },
    { type: LedgerEntryType.CHARGE, amountCents: -19900n, description: 'Subscription charge — Growth' },
    { type: LedgerEntryType.CREDIT, amountCents: 2500n, description: 'Goodwill credit — support outage' },
    { type: LedgerEntryType.PAYMENT, amountCents: 10000n, description: 'Partial wire payment' },
  ];
}

async function main() {
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'demo-password';
  const passwordHash = await hashPassword(password);

  for (const t of TENANTS) {
    const tenant = await prisma.tenant.upsert({
      where: { slug: t.slug },
      update: {},
      create: { slug: t.slug, name: t.name },
    });

    for (const [email, role] of [
      [`admin@${t.slug}.demo`, UserRole.ADMIN],
      [`analyst@${t.slug}.demo`, UserRole.ANALYST],
    ] as const) {
      await prisma.user.upsert({
        where: { tenantId_email: { tenantId: tenant.id, email } },
        update: {},
        create: { tenantId: tenant.id, email, role, passwordHash },
      });
    }

    for (const p of PLANS) {
      await prisma.plan.upsert({
        where: { tenantId_code: { tenantId: tenant.id, code: p.code } },
        update: {},
        create: { tenantId: tenant.id, ...p },
      });
    }

    for (const n of [1, 2, 3]) {
      const email = `customer${n}@${t.slug}.example`;
      let account = await prisma.account.findUnique({
        where: { tenantId_email: { tenantId: tenant.id, email } },
      });
      if (!account) {
        account = await prisma.account.create({
          data: { tenantId: tenant.id, name: `${t.name} Customer ${n}`, email },
        });
      }

      const existing = await prisma.ledgerEntry.count({ where: { accountId: account.id } });
      if (existing === 0) {
        const entries = demoLedger();
        await prisma.ledgerEntry.createMany({
          data: entries.map((e) => ({
            tenantId: tenant.id,
            accountId: account!.id,
            type: e.type,
            amountCents: e.amountCents,
            currency: account!.currency,
            description: e.description,
          })),
        });
        const sum = entries.reduce((acc, e) => acc + e.amountCents, 0n);
        await prisma.account.update({
          where: { id: account.id },
          data: { balanceCents: sum },
        });
      }
    }
    console.log(`Seeded tenant "${t.slug}" (admin@${t.slug}.demo / analyst@${t.slug}.demo, password "${password}")`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
