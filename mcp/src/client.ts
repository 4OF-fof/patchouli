import axios, { AxiosInstance } from 'axios';
import open from 'open';
import { createServer } from 'http';
import { URL } from 'url';

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

  async authenticate(): Promise<string> {
    try {
      // 認証トークンとログインURLを取得
      const response = await this.client.get('/login/api');
      const { auth_token, login_url } = response.data;

      console.error('Opening browser for authentication...');
      console.error(`Authentication token: ${auth_token}`);
      
      // ブラウザでログインURLを開く
      await open(login_url);

      // 認証完了をポーリング
      return await this.pollAuthStatus(auth_token);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to start authentication: ${error.message}`);
      }
      throw error;
    }
  }

  private async pollAuthStatus(authToken: string): Promise<string> {
    const maxAttempts = 60; // 60秒間ポーリング
    const pollInterval = 1000; // 1秒間隔

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await this.client.get(`/auth/status/${authToken}`);
        const { status, session_id, user_email } = response.data;

        switch (status) {
          case 'completed':
            console.error(`Authentication successful! User: ${user_email}`);
            return session_id;
          
          case 'pending':
            // 認証待ち、続行
            if (attempt === 0) {
              console.error('Waiting for authentication to complete...');
            }
            break;
          
          case 'error':
            throw new Error('Authentication failed on server');
          
          default:
            throw new Error(`Unknown authentication status: ${status}`);
        }

        // 1秒待機
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          throw new Error('Invalid authentication token');
        }
        
        // ネットワークエラーの場合は継続
        if (attempt === maxAttempts - 1) {
          throw new Error('Authentication polling failed');
        }
      }
    }

    throw new Error('Authentication timeout (60 seconds)');
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