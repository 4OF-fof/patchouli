import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { patchouliAPI, type UserInfo } from '../services/api';

interface AuthContextType {
  jwtToken: string | null;
  user: UserInfo | null;
  isAuthenticated: boolean;
  isValidating: boolean;
  login: (token: string, userInfo: UserInfo) => void;
  logout: () => Promise<void>;
  updateUser: (userInfo: UserInfo) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [jwtToken, setJwtToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [isValidating, setIsValidating] = useState(true);

  // JWTトークンをローカルストレージから復元し、有効性を検証
  useEffect(() => {
    const validateStoredToken = async () => {
      const savedToken = patchouliAPI.getJWTToken();
      
      if (savedToken) {
        // トークンの有効性を検証
        const isValid = await patchouliAPI.validateToken();
        if (isValid) {
          setJwtToken(savedToken);
          // ユーザー情報を取得
          try {
            const savedUserInfo = localStorage.getItem('patchouli_user_info');
            if (savedUserInfo) {
              setUser(JSON.parse(savedUserInfo));
            }
          } catch (error) {
            console.warn('Failed to parse stored user info:', error);
            localStorage.removeItem('patchouli_user_info');
          }
        } else {
          // 無効なトークンの場合はクリア
          patchouliAPI.clearJWTToken();
          localStorage.removeItem('patchouli_user_info');
        }
      }
      setIsValidating(false);
    };

    validateStoredToken();
  }, []);

  const login = (token: string, userInfo: UserInfo) => {
    setJwtToken(token);
    setUser(userInfo);
    
    // APIクライアントにトークンを設定
    patchouliAPI.setJWTToken(token);
    
    // ユーザー情報をローカルストレージに保存
    localStorage.setItem('patchouli_user_info', JSON.stringify(userInfo));
  };

  const logout = async () => {
    try {
      // サーバーにログアウトリクエストを送信
      await patchouliAPI.logout();
    } catch (error) {
      console.warn('Logout request failed:', error);
      // サーバーエラーでもローカルの状態はクリアする
    }
    
    setJwtToken(null);
    setUser(null);
    
    // ローカルストレージから削除
    localStorage.removeItem('patchouli_user_info');
  };

  const updateUser = (userInfo: UserInfo) => {
    setUser(userInfo);
    localStorage.setItem('patchouli_user_info', JSON.stringify(userInfo));
  };

  const value: AuthContextType = {
    jwtToken,
    user,
    isAuthenticated: !!jwtToken && !!user,
    isValidating,
    login,
    logout,
    updateUser,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};