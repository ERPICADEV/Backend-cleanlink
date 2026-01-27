import { Request, Response } from 'express';
import { pool } from '../config/postgres';
import { randomUUID } from 'crypto';
import { teamService } from '../services/teamService';
import { handleDatabaseError } from '../utils/dbErrorHandler';

/**
 * GET /api/v1/teams
 * Get all teams (with area boundaries if available)
 */
export const getTeams = async (req: Request, res: Response) => {
  try {
    // Get teams from Django service
    const djangoTeams = await teamService.getTeams();

    // Get area boundaries from Node.js database
    const areaResult = await pool.query(`
      SELECT team_id, area_boundary
      FROM team_areas
    `);

    // Create a map of team_id -> area_boundary
    const areaMap = new Map<string, any>();
    areaResult.rows.forEach((row: any) => {
      areaMap.set(row.team_id, row.area_boundary);
    });

    // Merge Django teams with area boundaries
    const teamsWithAreas = djangoTeams.map((team: any) => ({
      ...team,
      area_boundary: areaMap.get(team.id) || null,
    }));

    return res.status(200).json({
      data: teamsWithAreas,
    });
  } catch (error) {
    console.error('Get teams error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch teams' },
    });
  }
};

/**
 * POST /api/v1/teams
 * Create a new team
 */
export const createTeam = async (req: Request, res: Response) => {
  try {
    const { name, leader } = req.body;

    if (!name || !leader) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Team name and leader are required',
        },
      });
    }

    // Verify leader exists in our database
    const leaderResult = await pool.query(
      'SELECT id, username FROM users WHERE username = $1',
      [leader]
    );

    if (leaderResult.rows.length === 0) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Leader user not found',
        },
      });
    }

    // Create team in Django service
    const teamId = await teamService.createTeam(name, leader);

    // Store team_id in our database (for area_boundary later)
    // Note: We don't store area_boundary yet - it will be added when area is created
    await pool.query(
      `INSERT INTO team_areas (team_id, area_boundary, created_at, updated_at)
       VALUES ($1, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (team_id) DO NOTHING`,
      [teamId]
    );

    return res.status(201).json({
      id: teamId,
      name,
      leader,
      message: 'Team created successfully',
    });
  } catch (error: any) {
    console.error('Create team error:', error);
    
    if (error.message.includes('already exists')) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message,
        },
      });
    }

    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'Failed to create team',
      },
    });
  }
};

/**
 * DELETE /api/v1/teams/:id
 * Delete a team
 */
export const deleteTeam = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Delete from Django service
    await teamService.deleteTeam(id);

    // Delete area boundary from our database
    await pool.query('DELETE FROM team_areas WHERE team_id = $1', [id]);

    return res.status(200).json({
      message: 'Team deleted successfully',
    });
  } catch (error: any) {
    console.error('Delete team error:', error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: error.message,
        },
      });
    }

    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'Failed to delete team',
      },
    });
  }
};

/**
 * POST /api/v1/teams/:id/members
 * Add members to a team
 */
export const addTeamMembers = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { usernames } = req.body;

    if (!usernames || !Array.isArray(usernames) || usernames.length === 0) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'usernames array is required',
        },
      });
    }

    // Verify all usernames exist in our database
    const placeholders = usernames.map((_, i) => `$${i + 1}`).join(',');
    const usersResult = await pool.query(
      `SELECT username FROM users WHERE username IN (${placeholders})`,
      usernames
    );

    if (usersResult.rows.length !== usernames.length) {
      const foundUsernames = usersResult.rows.map((r: any) => r.username);
      const missingUsernames = usernames.filter((u) => !foundUsernames.includes(u));
      
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: `Users not found: ${missingUsernames.join(', ')}`,
        },
      });
    }

    // Add members via Django service
    await teamService.addMembers(id, usernames);

    return res.status(200).json({
      message: 'Members added successfully',
    });
  } catch (error: any) {
    console.error('Add team members error:', error);
    
    if (error.message.includes('already in a team')) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message,
        },
      });
    }

    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'Failed to add members',
      },
    });
  }
};

/**
 * DELETE /api/v1/teams/:id/members/:username
 * Remove a member from a team
 */
export const removeTeamMember = async (req: Request, res: Response) => {
  try {
    const { username } = req.params;

    // Remove member via Django service
    await teamService.removeMember(username);

    return res.status(200).json({
      message: 'Member removed successfully',
    });
  } catch (error: any) {
    console.error('Remove team member error:', error);
    
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'Failed to remove member',
      },
    });
  }
};

/**
 * GET /api/v1/teams/:id
 * Get team details including area boundary
 */
export const getTeam = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Get teams from Django service
    const djangoTeams = await teamService.getTeams();
    const team = djangoTeams.find((t: any) => t.id === id);

    if (!team) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Team not found',
        },
      });
    }

    // Get area boundary from our database
    const areaResult = await pool.query(
      'SELECT area_boundary FROM team_areas WHERE team_id = $1',
      [id]
    );

    const areaBoundary = areaResult.rows[0]?.area_boundary || null;

    return res.status(200).json({
      ...team,
      area_boundary: areaBoundary,
    });
  } catch (error) {
    console.error('Get team error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch team',
      },
    });
  }
};

