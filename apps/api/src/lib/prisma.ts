import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';

export const prisma: PrismaClient = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
