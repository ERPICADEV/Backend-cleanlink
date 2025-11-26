import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  // Add connection pool settings
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
})

// Test connection on startup
prisma.$connect()
  .then(() => console.log('✅ Database connected'))
  .catch(err => console.error('❌ Database connection failed:', err))

export default prisma