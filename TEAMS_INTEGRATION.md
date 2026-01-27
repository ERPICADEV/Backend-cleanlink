# Teams Service Integration Guide

This document describes the integration between the Node.js CleanLink backend and the Django Teams Service.

## Overview

The Teams feature allows users to form teams and claim virtual areas on the map based on their resolved reports. The Django service handles all team CRUD operations and area calculations, while the Node.js backend stores area boundaries and integrates with the report resolution workflow.

## Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   Node.js API   │────────▶│  Django Service  │────────▶│   PostgreSQL    │
│  (Main Backend) │         │  (Teams Service) │         │  (Teams DB)     │
└─────────────────┘         └──────────────────┘         └─────────────────┘
         │                            │
         │                            │
         ▼                            ▼
┌─────────────────┐         ┌──────────────────┐
│   PostgreSQL    │         │   SQLite/Postgres │
│  (Main DB)      │         │  (Teams DB)      │
└─────────────────┘         └──────────────────┘
```

## Setup

### 1. Environment Variables

Add the following to your `.env` file in the Node.js backend:

```bash
# Django Teams Service URL
DJANGO_TEAMS_SERVICE_URL=http://localhost:8000
```

**Default**: If not set, defaults to `http://localhost:8000`

### 2. Database Migration

Run the migration to create the `team_areas` table:

```bash
psql $DATABASE_URL -f migrations/add_team_areas_table.sql
```

Or manually:

```sql
CREATE TABLE IF NOT EXISTS team_areas (
  team_id TEXT PRIMARY KEY,
  area_boundary JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_team_areas_team_id ON team_areas(team_id);
```

### 3. Start Django Service

Make sure the Django Teams Service is running:

```bash
cd CleanLink-TeamServices
python manage.py runserver 8000
```

Or with gunicorn:

```bash
gunicorn backend.wsgi:application --bind 0.0.0.0:8000
```

## API Endpoints

### Team Management (Node.js API)

All endpoints require authentication (`authMiddleware`).

#### GET `/api/v1/teams`
Get all teams with their area boundaries.

**Response:**
```json
{
  "data": [
    {
      "id": "team-uuid",
      "name": "Team Name",
      "leader": "leader-username",
      "members": ["member1", "member2"],
      "area_boundary": [
        {"lat": 28.6139, "lng": 77.2090},
        {"lat": 28.6140, "lng": 77.2091}
      ]
    }
  ]
}
```

#### POST `/api/v1/teams`
Create a new team.

**Request:**
```json
{
  "name": "Team Name",
  "leader": "leader-username"
}
```

**Response:**
```json
{
  "id": "team-uuid",
  "name": "Team Name",
  "leader": "leader-username",
  "message": "Team created successfully"
}
```

#### GET `/api/v1/teams/:id`
Get team details including area boundary.

#### DELETE `/api/v1/teams/:id`
Delete a team.

#### POST `/api/v1/teams/:id/members`
Add members to a team.

**Request:**
```json
{
  "usernames": ["member1", "member2", "member3"]
}
```

#### DELETE `/api/v1/teams/:id/members/:username`
Remove a member from a team.

## Integration Flow

### 1. Team Creation

1. User calls `POST /api/v1/teams` with team name and leader username
2. Node.js validates leader exists in database
3. Node.js calls Django `POST /api/createTeam/`
4. Django creates team and returns `team_id`
5. Node.js stores `team_id` in `team_areas` table (without boundary yet)

### 2. Report Resolution & Area Calculation

When a report is resolved:

1. Admin resolves report via `PATCH /api/v1/admin/reports/:id/resolve` or approval workflow
2. Node.js extracts:
   - Reporter username
   - Report location (latitude, longitude)
3. Node.js calls Django `POST /api/triggerReport/` (non-blocking)
4. Django service:
   - Checks if reporter belongs to a team
   - Validates report location (max 400m distance between reports)
   - Creates area if team has ≥10 reports
   - Expands area if report is outside current boundary
   - Returns area boundary
5. Node.js updates `team_areas.area_boundary` with new boundary

### 3. Area Boundary Storage

Area boundaries are stored in the Node.js database as JSONB:

```json
[
  {"lat": 28.6139, "lng": 77.2090},
  {"lat": 28.6140, "lng": 77.2091},
  {"lat": 28.6141, "lng": 77.2092}
]
```

This allows the frontend to:
- Display team areas on the map
- Query areas by location
- Show team rankings by area

## Django Service Endpoints

The Node.js service communicates with these Django endpoints:

- `GET /api/teams/` - Get all teams
- `POST /api/createTeam/` - Create team
- `POST /api/deleteTeam/` - Delete team
- `POST /api/addMember/` - Add members
- `POST /api/deleteMember/` - Remove member
- `POST /api/triggerReport/` - Process resolved report for area calculation

## Error Handling

### Team Service Unavailable

If the Django service is unavailable:
- Team CRUD operations will fail with appropriate error messages
- Report resolution will still succeed (team integration is non-blocking)
- Area boundary updates will be skipped

### Member Already in Team

If trying to add a member who is already in a team:
- Django returns 400 error
- Node.js forwards the error to the client

### Invalid Team ID

If team ID doesn't exist:
- Django returns 404 error
- Node.js forwards the error to the client

## Area Calculation Logic

The Django service uses:

1. **Haversine Formula**: Calculate distance between report locations
2. **Convex Hull Algorithm**: Create area boundaries from report points
3. **Validation**: Reports must be within 400m of each other
4. **Minimum Reports**: Team needs ≥10 reports to create an area
5. **Area Expansion**: New reports outside current boundary expand the area

## Future Enhancements

- [ ] Overlapping area resolution (credit score + legit reports)
- [ ] Team credit score calculation (0.25x for reporter, 0.05x for team members)
- [ ] Area civic score ranking
- [ ] Real-time area updates via WebSocket
- [ ] Area visualization on map

## Troubleshooting

### Team service connection fails

1. Check Django service is running: `curl http://localhost:8000/api/teams/`
2. Verify `DJANGO_TEAMS_SERVICE_URL` in `.env`
3. Check CORS settings in Django `settings.py` (should allow Node.js origin)

### Area boundaries not updating

1. Check Django service logs for errors
2. Verify report has valid location (lat/lng)
3. Check reporter belongs to a team
4. Verify team has ≥10 reports (minimum for area creation)

### Team creation fails

1. Verify leader username exists in Node.js database
2. Check Django service is accessible
3. Verify team name is unique (Django enforces this)

## Testing

### Test Team Creation

```bash
# Create team
curl -X POST http://localhost:3000/api/v1/teams \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Team", "leader": "testuser"}'

# Get teams
curl http://localhost:3000/api/v1/teams \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Test Report Resolution Integration

1. Create a report with location
2. Resolve the report as admin
3. Check Django service logs for `triggerReport` call
4. Verify `team_areas` table is updated with boundary

## Notes

- Team integration is **non-blocking** - report resolution succeeds even if Django service is down
- Area boundaries are stored in Node.js database for fast queries
- Django service handles all team membership and area calculation logic
- Node.js acts as a proxy and cache layer for team data

