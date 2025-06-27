import axios, { AxiosInstance } from 'axios';

export class PatchouliClient {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:8080') {
    this.baseUrl = baseUrl;
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async getProtectedContent(sessionId: string): Promise<string> {
    try {
      const response = await this.client.get('/protected', {
        params: {
          session_id: sessionId,
        },
      });

      if (response.status === 200) {
        return response.data;
      } else {
        throw new Error(`Unexpected response status: ${response.status}`);
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          throw new Error('Authentication failed: Invalid or expired session ID');
        } else if (error.response?.status === 404) {
          throw new Error('Protected content endpoint not found');
        } else if (error.code === 'ECONNREFUSED') {
          throw new Error('Failed to connect to Patchouli core server. Make sure it is running.');
        } else {
          throw new Error(`HTTP Error: ${error.response?.status || 'Unknown'} - ${error.message}`);
        }
      } else {
        throw new Error(`Network error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  async authenticateForDiscordUser(discordUserId: string): Promise<string> {
    try {
      // Discord用の認証トークンとログインURLを取得
      const response = await this.client.get('/login/api', {
        params: {
          discord_user: discordUserId
        }
      });
      const { auth_token, login_url } = response.data;

      console.log(`Opening authentication for Discord user: ${discordUserId}`);
      console.log(`Authentication token: ${auth_token}`);
      
      return auth_token;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to start authentication: ${error.message}`);
      }
      throw error;
    }
  }

  async checkAuthStatus(authToken: string): Promise<{status: string, session_id?: string, user_email?: string}> {
    try {
      const response = await this.client.get(`/auth/status/${authToken}`);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw new Error('Invalid authentication token');
      }
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.get('/');
      return true;
    } catch {
      return false;
    }
  }
}