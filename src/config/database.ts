import { PrismaClient } from '@prisma/client';

const prisma: PrismaClient = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

// Simple connection test on startup
prisma.$connect()
  .then(() => console.log('✅ Database connected'))
  .catch((error) => console.error('❌ Database connection failed:', error));

export default prisma;