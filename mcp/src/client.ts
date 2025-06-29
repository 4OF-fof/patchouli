import axios, { AxiosInstance } from 'axios';
import open from 'open';

interface AuthTokenResponse {
  token: string;
  auth_url: string;
}

interface AccessTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: {
    id: string;
    email: string;
    name: string;
    is_root: boolean;
    can_invite: boolean;
  };
}

interface ProtectedContent {
  message: string;
  user: string;
  timestamp: string;
}

interface SystemStatus {
  status: string;
  version: string;
  users_registered: number;
  root_user_exists: boolean;
  timestamp: string;
}

export class PatchouliClient {
  private client: AxiosInstance;
  private baseUrl: string;
  private jwtToken: string | null = null;

  constructor(baseUrl: string = 'http://localhost:8080') {
    this.baseUrl = baseUrl;
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add request interceptor to include JWT token
    this.client.interceptors.request.use((config) => {
      if (this.jwtToken && config.headers) {
        config.headers['Authorization'] = `Bearer ${this.jwtToken}`;
      }
      return config;
    });
  }

  async getProtectedContent(): Promise<ProtectedContent> {
    try {
      const response = await this.client.get('/content');

      if (response.status === 200) {
        return response.data;
      } else {
        throw new Error(`Unexpected response status: ${response.status}`);
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          throw new Error('Authentication failed: Invalid or expired JWT token');
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

  async authenticate(): Promise<AccessTokenResponse> {
    try {
      // 認証トークンとOAuth URLを取得
      const authResponse = await this.client.post('/auth/tokens', {
        grant_type: 'client_credentials'
      });
      const authData: AuthTokenResponse = authResponse.data;

      console.error('Opening browser for authentication...');
      console.error(`Authentication token: ${authData.token}`);
      
      // ブラウザでOAuth URLを開く
      await open(authData.auth_url);

      // 認証完了をポーリング
      return await this.pollAuthCompletion(authData.token);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to start authentication: ${error.message}`);
      }
      throw error;
    }
  }

  private async pollAuthCompletion(authToken: string): Promise<AccessTokenResponse> {
    const maxAttempts = 60; // 60秒間ポーリング
    const pollInterval = 1000; // 1秒間隔

    console.error('Waiting for authentication to complete...');
    console.error('Please complete the OAuth flow in your browser.');

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Note: In the new RESTful API, there's no polling endpoint.
        // We expect the user to manually provide the authorization code.
        // For now, we'll simulate the old behavior by asking user to input the code.
        
        if (attempt === 0) {
          console.error('');
          console.error('After completing authentication in your browser, you will be redirected to:');
          console.error(`${this.baseUrl}/oauth/callback?code=<CODE>&state=<STATE>`);
          console.error('');
          console.error('Please copy the "code" parameter from the URL and provide it to complete authentication.');
        }

        // In a real implementation, you might use readline to get user input
        // For this MCP implementation, we'll need to modify the approach
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        
        // Check if we can somehow detect completion
        // This is a limitation of the current design - MCP might need manual intervention
        if (attempt >= 10) {
          console.error('');
          console.error('Authentication is taking longer than expected.');
          console.error('Please ensure you have completed the OAuth flow in your browser.');
          console.error('');
        }
      } catch (error) {
        if (attempt === maxAttempts - 1) {
          throw new Error('Authentication polling failed');
        }
      }
    }

    throw new Error('Authentication timeout (60 seconds). Please try again and complete the OAuth flow quickly.');
  }

  async exchangeCodeForToken(code: string, state: string): Promise<AccessTokenResponse> {
    try {
      const response = await this.client.post('/auth/tokens', {
        grant_type: 'authorization_code',
        code,
        state
      });

      const tokenData: AccessTokenResponse = response.data;
      this.jwtToken = tokenData.access_token;
      
      console.error(`Authentication successful! User: ${tokenData.user.name} (${tokenData.user.email})`);
      return tokenData;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to exchange code for token: ${error.response?.data?.message || error.message}`);
      }
      throw error;
    }
  }

  setJWTToken(token: string): void {
    this.jwtToken = token;
  }

  getJWTToken(): string | null {
    return this.jwtToken;
  }

  clearJWTToken(): void {
    this.jwtToken = null;
  }

  async logout(): Promise<void> {
    try {
      if (this.jwtToken) {
        await this.client.delete('/auth/tokens');
      }
    } catch (error) {
      // Ignore logout errors
      console.error('Logout request failed:', error);
    } finally {
      this.clearJWTToken();
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.get('/system/status');
      return true;
    } catch {
      return false;
    }
  }

  async getSystemStatus(): Promise<SystemStatus> {
    try {
      const response = await this.client.get('/system/status');
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to get system status: ${error.message}`);
      }
      throw error;
    }
  }

  isAuthenticated(): boolean {
    return !!this.jwtToken;
  }

  async validateToken(): Promise<boolean> {
    if (!this.jwtToken) {
      return false;
    }

    try {
      await this.getProtectedContent();
      return true;
    } catch {
      this.clearJWTToken();
      return false;
    }
  }
}