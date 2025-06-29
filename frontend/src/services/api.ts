import axios from 'axios';
import type { AxiosInstance } from 'axios';

// JWT Authentication types
export interface AuthTokenResponse {
  token: string;
  auth_url: string;
}

export interface AccessTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: UserInfo;
}

export interface UserInfo {
  id: string;
  email: string;
  name: string;
  is_root: boolean;
  can_invite: boolean;
}

export interface CreateTokenRequest {
  grant_type: string;
  code?: string;
  state?: string;
}

// User management types
export interface CreateUserRequest {
  email: string;
  name: string;
  invite_code?: string;
}

export interface UpdateUserRequest {
  name?: string;
  can_invite?: boolean;
}

export interface UserResponse {
  id: number;
  email: string;
  name: string;
  google_id: string;
  is_root: boolean;
  can_invite: boolean;
  created_at: string;
  last_login: string | null;
}

// Invite types
export interface InviteResponse {
  id: string;
  code: string;
  created_at: string;
  created_by: number;
  used_by: number | null;
  used_at: string | null;
}

// System types
export interface SystemStatus {
  status: string;
  version: string;
  users_registered: number;
  root_user_exists: boolean;
  timestamp: string;
}

// Generic response types
export interface ErrorResponse {
  error: string;
  message: string;
}

export interface SuccessResponse {
  success: boolean;
  message: string;
}

// Protected content type
export interface ProtectedContent {
  message: string;
  user: string;
  timestamp: string;
}

class PatchouliAPI {
  private client: AxiosInstance;
  private jwtToken: string | null = null;

  constructor(baseURL: string = 'http://localhost:8080') {
    this.client = axios.create({
      baseURL,
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

    // Load token from localStorage on initialization
    const savedToken = localStorage.getItem('patchouli_jwt_token');
    if (savedToken) {
      this.jwtToken = savedToken;
    }
  }

  // Authentication methods
  async createAuthToken(): Promise<AuthTokenResponse> {
    const response = await this.client.post('/auth/tokens', {
      grant_type: 'client_credentials'
    });
    return response.data;
  }

  async exchangeCodeForToken(code: string, state: string): Promise<AccessTokenResponse> {
    const response = await this.client.post('/auth/tokens', {
      grant_type: 'authorization_code',
      code,
      state
    });
    
    const tokenResponse: AccessTokenResponse = response.data;
    this.setJWTToken(tokenResponse.access_token);
    return tokenResponse;
  }

  async logout(): Promise<SuccessResponse> {
    try {
      const response = await this.client.delete('/auth/tokens');
      this.clearJWTToken();
      return response.data;
    } catch (error) {
      // Even if the request fails, clear the local token
      this.clearJWTToken();
      throw error;
    }
  }

  setJWTToken(token: string): void {
    this.jwtToken = token;
    localStorage.setItem('patchouli_jwt_token', token);
  }

  clearJWTToken(): void {
    this.jwtToken = null;
    localStorage.removeItem('patchouli_jwt_token');
  }

  getJWTToken(): string | null {
    return this.jwtToken;
  }

  isAuthenticated(): boolean {
    return !!this.jwtToken;
  }

  // User management methods
  async getUsers(): Promise<UserResponse[]> {
    const response = await this.client.get('/users');
    return response.data;
  }

  async createUser(userData: CreateUserRequest): Promise<UserResponse> {
    const response = await this.client.post('/users', userData);
    return response.data;
  }

  async getUser(userId: number): Promise<UserResponse> {
    const response = await this.client.get(`/users/${userId}`);
    return response.data;
  }

  async updateUser(userId: number, updates: UpdateUserRequest): Promise<UserResponse> {
    const response = await this.client.put(`/users/${userId}`, updates);
    return response.data;
  }

  async deleteUser(userId: number): Promise<SuccessResponse> {
    const response = await this.client.delete(`/users/${userId}`);
    return response.data;
  }

  // Invite management methods
  async getInvites(): Promise<InviteResponse[]> {
    const response = await this.client.get('/invites');
    return response.data;
  }

  async createInvite(): Promise<InviteResponse> {
    const response = await this.client.post('/invites');
    return response.data;
  }

  async deleteInvite(inviteId: string): Promise<SuccessResponse> {
    const response = await this.client.delete(`/invites/${inviteId}`);
    return response.data;
  }

  // Protected content
  async getProtectedContent(): Promise<ProtectedContent> {
    const response = await this.client.get('/content');
    return response.data;
  }

  // System information
  async getSystemStatus(): Promise<SystemStatus> {
    const response = await this.client.get('/system/status');
    return response.data;
  }

  // Legacy methods for backward compatibility
  async healthCheck(): Promise<boolean> {
    try {
      await this.getSystemStatus();
      return true;
    } catch {
      return false;
    }
  }

  async checkRootExists(): Promise<{ root_exists: boolean }> {
    const status = await this.getSystemStatus();
    return { root_exists: status.root_user_exists };
  }

  // Validation methods
  async validateToken(): Promise<boolean> {
    if (!this.jwtToken) {
      return false;
    }
    
    try {
      await this.getProtectedContent();
      return true;
    } catch {
      // If token is invalid, clear it
      this.clearJWTToken();
      return false;
    }
  }
}

export const patchouliAPI = new PatchouliAPI();