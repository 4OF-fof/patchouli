import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { patchouliAPI } from '../services/api';
import { css } from '../../styled-system/css';
import { container, stack, hstack } from '../../styled-system/patterns';

export const Dashboard: React.FC = () => {
  const { sessionId, userEmail, logout } = useAuth();
  const [protectedContent, setProtectedContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const fetchProtectedContent = async () => {
    if (!sessionId) return;

    setIsLoading(true);
    setError('');
    
    try {
      const content = await patchouliAPI.getProtectedContent(sessionId);
      setProtectedContent(content);
    } catch (err) {
      setError('保護されたコンテンツの取得に失敗しました');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    if (sessionId) {
      try {
        await patchouliAPI.logout(sessionId);
      } catch (err) {
        console.error('Logout error:', err);
      }
    }
    logout();
  };

  useEffect(() => {
    fetchProtectedContent();
  }, [sessionId]);

  return (
    <div className={css({ minH: '100vh', bg: 'gray.50' })}>
      {/* Header */}
      <header className={css({ 
        bg: 'white', 
        shadow: 'sm', 
        borderBottom: '1px solid', 
        borderColor: 'gray.200' 
      })}>
        <div className={container({ maxW: '6xl', py: '4' })}>
          <div className={hstack({ justify: 'space-between' })}>
            <h1 className={css({ 
              fontSize: '2xl', 
              fontWeight: 'bold', 
              color: 'gray.900' 
            })}>
              Patchouli Knowledge Base
            </h1>
            
            <div className={hstack({ gap: '4' })}>
              <span className={css({ color: 'gray.600', fontSize: 'sm' })}>
                {userEmail}
              </span>
              <button
                onClick={handleLogout}
                className={css({
                  bg: 'gray.100',
                  color: 'gray.700',
                  py: '2',
                  px: '4',
                  rounded: 'md',
                  fontSize: 'sm',
                  fontWeight: 'medium',
                  transition: 'colors',
                  cursor: 'pointer',
                  _hover: {
                    bg: 'gray.200',
                  },
                })}
              >
                ログアウト
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className={container({ maxW: '4xl', py: '8' })}>
        <div className={stack({ gap: '6' })}>
          <div>
            <h2 className={css({ 
              fontSize: '2xl', 
              fontWeight: 'bold', 
              color: 'gray.900', 
              mb: '2' 
            })}>
              ダッシュボード
            </h2>
            <p className={css({ color: 'gray.600' })}>
              魔法図書館の保護されたコンテンツにアクセスできます
            </p>
          </div>

          {/* Protected Content Section */}
          <div className={css({ 
            bg: 'white', 
            rounded: 'lg', 
            shadow: 'sm', 
            p: '6',
            border: '1px solid',
            borderColor: 'gray.200'
          })}>
            <div className={css({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '4' })}>
              <h3 className={css({ 
                fontSize: 'lg', 
                fontWeight: 'semibold', 
                color: 'gray.900' 
              })}>
                保護されたコンテンツ
              </h3>
              <button
                onClick={fetchProtectedContent}
                disabled={isLoading}
                className={css({
                  bg: 'brand.primary',
                  color: 'white',
                  py: '2',
                  px: '4',
                  rounded: 'md',
                  fontSize: 'sm',
                  fontWeight: 'medium',
                  transition: 'colors',
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  opacity: isLoading ? '0.5' : '1',
                  _hover: {
                    bg: isLoading ? 'brand.primary' : 'brand.secondary',
                  },
                })}
              >
                {isLoading ? '読み込み中...' : '更新'}
              </button>
            </div>

            {error && (
              <div className={css({ 
                bg: 'red.50', 
                border: '1px solid', 
                borderColor: 'red.200', 
                rounded: 'md', 
                p: '4', 
                mb: '4' 
              })}>
                <p className={css({ color: 'red.800', fontSize: 'sm' })}>
                  {error}
                </p>
              </div>
            )}

            {protectedContent && (
              <div className={css({ 
                bg: 'gray.50', 
                rounded: 'md', 
                p: '4' 
              })}>
                <p className={css({ color: 'gray.800', lineHeight: '1.6' })}>
                  {protectedContent}
                </p>
              </div>
            )}

            {!protectedContent && !isLoading && !error && (
              <div className={css({ 
                textAlign: 'center', 
                py: '8', 
                color: 'gray.500' 
              })}>
                保護されたコンテンツを読み込むには「更新」ボタンを押してください
              </div>
            )}
          </div>

          {/* Session Info */}
          <div className={css({ 
            bg: 'blue.50', 
            border: '1px solid', 
            borderColor: 'blue.200', 
            rounded: 'md', 
            p: '4' 
          })}>
            <h4 className={css({ 
              fontSize: 'sm', 
              fontWeight: 'semibold', 
              color: 'blue.900', 
              mb: '2' 
            })}>
              セッション情報
            </h4>
            <div className={css({ fontSize: 'xs', color: 'blue.800', fontFamily: 'mono' })}>
              セッションID: {sessionId}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};