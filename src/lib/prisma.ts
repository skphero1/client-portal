import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  sysfortechPrisma?: PrismaClient;
};

export const prisma: PrismaClient =
  globalForPrisma.sysfortechPrisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG_QUERIES === 'true' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.sysfortechPrisma = prisma;
}
