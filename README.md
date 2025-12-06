# CleanLink Backend

Node.js backend API for CleanLink - a civic reporting platform.

## Tech Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL
- **Cache/Queue**: Redis
- **Authentication**: JWT

## Prerequisites

- Node.js 18+ 
- PostgreSQL 12+
- Redis (for queue processing)

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Database Setup

#### On Render (Production)

1. Create a PostgreSQL database on Render
2. Copy the **Internal Database URL** from your Render dashboard
3. Set it as `DATABASE_URL` in your environment variables

#### Local Development

1. Create a PostgreSQL database:
```bash
createdb cleanlink
```

2. Set `DATABASE_URL` in your `.env` file:
```
DATABASE_URL=postgresql://username:password@localhost:5432/cleanlink
```

### 3. Run Database Migrations

Run the schema to create all tables:

```bash
psql $DATABASE_URL -f schema.sql
```

Or if using a connection string directly:
```bash
psql postgresql://username:password@localhost:5432/cleanlink -f schema.sql
```

### 4. Environment Variables

Create a `.env` file in the root directory:

```env
# Database
DATABASE_URL=postgresql://username:password@localhost:5432/cleanlink

# Server
PORT=3000
NODE_ENV=production

# Redis (for AI queue processing)
REDIS_URL=redis://localhost:6379

# JWT Secrets
JWT_SECRET=your-secret-key-here
JWT_REFRESH_SECRET=your-refresh-secret-key-here

# AI Service
OPENROUTER_API_KEY=your-openrouter-api-key

# API Keys
AI_SERVICE_API_KEY=your-api-key
```

### 5. Build and Run

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

## Database Schema

The database schema is defined in `schema.sql`. Key tables:

- `users` - User accounts
- `reports` - Civic issue reports
- `comments` - Comments on reports
- `votes` - Upvotes/downvotes on reports
- `admins` - Admin users with role-based access
- `report_progress` - Admin progress tracking
- `rewards` - Reward catalog
- `redemptions` - User reward redemptions
- `notifications` - User notifications
- `audit_logs` - System audit trail

## API Endpoints

- `GET /api/v1` - API information
- `GET /health` - Health check
- `/api/v1/auth/*` - Authentication
- `/api/v1/users/*` - User management
- `/api/v1/reports/*` - Report management
- `/api/v1/admin/*` - Admin operations
- `/api/v1/rewards/*` - Rewards system
- `/api/v1/notifications/*` - Notifications
- `/api/v1/map/*` - Map data

## Deployment on Render

1. Connect your GitHub repository to Render
2. Create a new **Web Service**
3. Set build command: `npm install && npm run build`
4. Set start command: `npm start`
5. Add environment variables (especially `DATABASE_URL`)
6. Create a PostgreSQL database on Render and use its Internal Database URL
7. Run migrations: Connect to your database and run `psql $DATABASE_URL -f schema.sql`

## Migration from SQLite

This project was migrated from SQLite to PostgreSQL. The migration includes:

- All queries converted from SQLite syntax to PostgreSQL
- Parameterized queries using `$1, $2, ...` instead of `?`
- Transaction handling using PostgreSQL client pooling
- Schema converted to PostgreSQL types (TEXT, TIMESTAMP, etc.)

## Troubleshooting

### Database Connection Issues

- Verify `DATABASE_URL` is set correctly
- Check PostgreSQL is running and accessible
- Ensure SSL settings match your database provider (Render requires SSL)

### Migration Errors

- Ensure all tables are created by running `schema.sql`
- Check for existing data conflicts
- Verify foreign key constraints

## License

ISC

