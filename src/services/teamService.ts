import axios, { AxiosInstance } from 'axios';

/**
 * Service to communicate with Django Teams Service
 * Handles all team-related operations including CRUD and area management
 */
class TeamService {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor() {
    // Get Django service URL from environment, default to localhost:8000
    this.baseUrl = process.env.DJANGO_TEAMS_SERVICE_URL || 'http://localhost:8000';
    
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000, // 10 second timeout
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        console.log(`[TeamService] ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        console.error('[TeamService] Request error:', error);
        return Promise.reject(error);
      }
    );

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        console.error('[TeamService] Response error:', {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Create a new team
   * @param name Team name
   * @param leader Username of the team leader
   * @returns Team ID
   */
  async createTeam(name: string, leader: string): Promise<string> {
    try {
      const response = await this.client.post('/api/createTeam/', {
        name,
        leader,
      });

      if (response.status === 201 && response.data.team_id) {
        return response.data.team_id;
      }

      throw new Error('Invalid response from Django service');
    } catch (error: any) {
      if (error.response?.status === 400) {
        throw new Error(error.response.data.error || 'Failed to create team');
      }
      throw new Error(`Team service unavailable: ${error.message}`);
    }
  }

  /**
   * Delete a team
   * @param teamId Team ID to delete
   */
  async deleteTeam(teamId: string): Promise<void> {
    try {
      const response = await this.client.post('/api/deleteTeam/', {
        team_id: teamId,
      });

      if (response.status !== 200) {
        throw new Error('Failed to delete team');
      }
    } catch (error: any) {
      if (error.response?.status === 404) {
        throw new Error('Team not found');
      }
      throw new Error(`Team service unavailable: ${error.message}`);
    }
  }

  /**
   * Add members to a team
   * @param teamId Team ID
   * @param usernames Array of usernames to add
   */
  async addMembers(teamId: string, usernames: string[]): Promise<void> {
    try {
      const response = await this.client.post('/api/addMember/', {
        team_id: teamId,
        username: usernames,
      });

      if (response.status !== 200) {
        throw new Error('Failed to add members');
      }
    } catch (error: any) {
      if (error.response?.status === 400) {
        throw new Error(error.response.data.error || 'Failed to add members');
      }
      throw new Error(`Team service unavailable: ${error.message}`);
    }
  }

  /**
   * Remove a member from a team
   * @param username Username to remove
   */
  async removeMember(username: string): Promise<void> {
    try {
      const response = await this.client.post('/api/deleteMember/', {
        username,
      });

      if (response.status !== 200) {
        throw new Error('Failed to remove member');
      }
    } catch (error: any) {
      if (error.response?.status === 400) {
        throw new Error(error.response.data.error || 'Failed to remove member');
      }
      throw new Error(`Team service unavailable: ${error.message}`);
    }
  }

  /**
   * Get all teams
   * @returns Array of teams
   */
  async getTeams(): Promise<any[]> {
    try {
      const response = await this.client.get('/api/teams/');
      return response.data || [];
    } catch (error: any) {
      console.error('[TeamService] Failed to get teams:', error.message);
      return [];
    }
  }

  /**
   * Trigger report processing for team area calculation
   * Called when a report is resolved
   * @param reporterUsername Username of the reporter
   * @param latitude Report latitude
   * @param longitude Report longitude
   * @returns Area information (boundary, area_created, area_expanded)
   */
  async triggerReport(
    reporterUsername: string,
    latitude: number,
    longitude: number
  ): Promise<{
    report_added: boolean;
    area_created?: boolean;
    area_expanded?: boolean;
    boundary?: Array<{ lat: number; lng: number }>;
  }> {
    try {
      const response = await this.client.post('/api/triggerReport/', {
        reporter: reporterUsername,
        latitude,
        longitude,
      });

      if (response.status === 200) {
        return response.data;
      }

      throw new Error('Invalid response from Django service');
    } catch (error: any) {
      // If member has no team, that's okay - just log it
      if (error.response?.status === 400 && error.response.data.error?.includes('no team')) {
        console.log(`[TeamService] Reporter ${reporterUsername} has no team, skipping area calculation`);
        return {
          report_added: false,
        };
      }

      console.error('[TeamService] Failed to trigger report:', error.message);
      // Don't throw - this is a non-critical operation
      return {
        report_added: false,
      };
    }
  }
}

// Export singleton instance
export const teamService = new TeamService();

