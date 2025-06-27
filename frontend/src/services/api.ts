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
}

export const patchouliAPI = new PatchouliAPI();