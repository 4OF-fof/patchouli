import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';

interface AuthContextType {
  sessionId: string | null;
  userEmail: string | null;
  isAuthenticated: boolean;
  login: (sessionId: string, email: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // セッション情報をローカルストレージから復元
  useEffect(() => {
    const savedSessionId = localStorage.getItem('patchouli_session_id');
    const savedUserEmail = localStorage.getItem('patchouli_user_email');
    
    if (savedSessionId && savedUserEmail) {
      setSessionId(savedSessionId);
      setUserEmail(savedUserEmail);
    }
  }, []);

  const login = (newSessionId: string, email: string) => {
    setSessionId(newSessionId);
    setUserEmail(email);
    
    // ローカルストレージに保存
    localStorage.setItem('patchouli_session_id', newSessionId);
    localStorage.setItem('patchouli_user_email', email);
  };

  const logout = () => {
    setSessionId(null);
    setUserEmail(null);
    
    // ローカルストレージから削除
    localStorage.removeItem('patchouli_session_id');
    localStorage.removeItem('patchouli_user_email');
  };

  const value: AuthContextType = {
    sessionId,
    userEmail,
    isAuthenticated: !!sessionId,
    login,
    logout,
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