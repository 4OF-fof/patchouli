import axios from 'axios';
import type { AxiosInstance } from 'axios';

export interface UserSession {
  user_id: string;
  email: string;
}

export interface AuthResponse {
  session_id: string;
  user_email: string;
}

export interface SessionQuery {
  session_id: string;
}

export interface InviteCodeResponse {
  invite_code: string;
  invite_url: string;
}

export interface InviteCode {
  id: number;
  code: string;
  created_by: number;
  created_at: string;
  expires_at: string | null;
  used_by: number | null;
  used_at: string | null;
  is_active: boolean;
}

export interface InviteCodesListResponse {
  invite_codes: InviteCode[];
}

export interface RegisteredUser {
  id: number;
  google_id: string;
  email: string;
  name: string;
  registered_at: string;
  last_login: string | null;
  is_root: boolean;
  can_invite: boolean;
  invited_by: number | null;
}

export interface UsersListResponse {
  users: RegisteredUser[];
}

export interface DeleteUserResponse {
  success: boolean;
  message: string;
}

class PatchouliAPI {
  private client: AxiosInstance;

  constructor(baseURL: string = '/api') {
    this.client = axios.create({
      baseURL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async login(): Promise<string> {
    const response = await this.client.get('/login');
    return response.data;
  }

  async getProtectedContent(sessionId: string): Promise<string> {
    const response = await this.client.get('/protected', {
      params: { session_id: sessionId },
    });
    return response.data;
  }

  async logout(sessionId: string): Promise<void> {
    await this.client.get('/logout', {
      params: { session_id: sessionId },
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.get('/');
      return true;
    } catch {
      return false;
    }
  }

  async createInviteCode(sessionId: string): Promise<InviteCodeResponse> {
    const response = await this.client.get('/invite/create', {
      params: { session_id: sessionId },
    });
    return response.data;
  }

  async listInviteCodes(sessionId: string): Promise<InviteCodesListResponse> {
    const response = await this.client.get('/invite/list', {
      params: { session_id: sessionId },
    });
    return response.data;
  }

  async listUsers(sessionId: string): Promise<UsersListResponse> {
    const response = await this.client.get('/admin/users', {
      params: { session_id: sessionId },
    });
    return response.data;
  }

  async deleteUser(sessionId: string, userId: number): Promise<DeleteUserResponse> {
    const response = await this.client.delete(`/admin/users/${userId}?session_id=${encodeURIComponent(sessionId)}`);
    return response.data;
  }

  async validateSession(sessionId: string): Promise<boolean> {
    try {
      const response = await this.client.get('/protected', {
        params: { session_id: sessionId },
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }
}

export const patchouliAPI = new PatchouliAPI();