import { PrismaClient } from '@prisma/client';
import { resetAndSeedDemoData } from './seedData';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('Seeding Sysfortech Client Portal demo data...');
  await resetAndSeedDemoData(prisma);
  console.log('Seed complete: 2 client tenants, 3 demo identities, 9 projects, 11 invoices, 7 support tickets.');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
