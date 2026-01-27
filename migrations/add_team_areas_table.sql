-- Migration: Add team_areas table for storing team area boundaries
-- This table stores the area boundaries calculated by the Django Teams Service
-- Run with: psql $DATABASE_URL -f migrations/add_team_areas_table.sql

CREATE TABLE IF NOT EXISTS team_areas (
  team_id TEXT PRIMARY KEY,
  area_boundary JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_team_areas_team_id ON team_areas(team_id);

COMMENT ON TABLE team_areas IS 'Stores team area boundaries calculated by Django Teams Service';
COMMENT ON COLUMN team_areas.team_id IS 'Team ID from Django Teams Service';
COMMENT ON COLUMN team_areas.area_boundary IS 'JSON array of {lat, lng} points defining the team area boundary';

