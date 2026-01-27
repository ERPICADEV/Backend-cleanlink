import { Router } from 'express';
import {
  getTeams,
  createTeam,
  deleteTeam,
  addTeamMembers,
  removeTeamMember,
  getTeam,
} from '../controllers/teamController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// All team routes require authentication
router.use(authMiddleware);

// GET /api/v1/teams - Get all teams
router.get('/', getTeams);

// POST /api/v1/teams - Create a new team
router.post('/', createTeam);

// GET /api/v1/teams/:id - Get team details
router.get('/:id', getTeam);

// DELETE /api/v1/teams/:id - Delete a team
router.delete('/:id', deleteTeam);

// POST /api/v1/teams/:id/members - Add members to team
router.post('/:id/members', addTeamMembers);

// DELETE /api/v1/teams/:id/members/:username - Remove member from team
router.delete('/:id/members/:username', removeTeamMember);

export default router;

