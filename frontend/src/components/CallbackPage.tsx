import React, { useEffect, useState } from 'react';
import { useSearchParams, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { css } from '../../styled-system/css';
import { center, stack } from '../../styled-system/patterns';

export const CallbackPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { login, isAuthenticated } = useAuth();
  const [isProcessing, setIsProcessing] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const processCallback = async () => {
      try {
        // URLパラメータからセッション情報を取得
        const sessionId = searchParams.get('session_id');
        const userEmail = searchParams.get('user_email');

        if (sessionId && userEmail) {
          // 認証成功
          login(sessionId, userEmail);
        } else {
          // パラメータが不足している場合
          setError('認証情報が不完全です。再度ログインしてください。');
        }
      } catch (err) {
        setError('認証処理中にエラーが発生しました。');
        console.error('Callback processing error:', err);
      } finally {
        setIsProcessing(false);
      }
    };

    processCallback();
  }, [searchParams, login]);

  // 認証済みの場合はダッシュボードにリダイレクト
  if (isAuthenticated && !isProcessing) {
    return <Navigate to="/dashboard" replace />;
  }

  // エラーが発生した場合はログインページにリダイレクト
  if (error && !isProcessing) {
    return <Navigate to="/login" replace />;
  }

  // 処理中の表示
  return (
    <div className={center({ minH: '100vh' })}>
      <div className={css({ 
        bg: 'white', 
        p: '8', 
        rounded: 'lg', 
        shadow: 'lg',
        w: 'full',
        maxW: 'md'
      })}>
        <div className={stack({ gap: '4', textAlign: 'center' })}>
          <div className={css({ 
            w: '12', 
            h: '12', 
            mx: 'auto',
            border: '3px solid',
            borderColor: 'gray.200',
            borderTopColor: 'brand.primary',
            rounded: 'full',
            animation: 'spin 1s linear infinite'
          })} />
          
          <div>
            <h2 className={css({ 
              fontSize: 'xl', 
              fontWeight: 'semibold', 
              color: 'gray.900' 
            })}>
              認証処理中...
            </h2>
            <p className={css({ 
              mt: '2', 
              color: 'gray.600',
              fontSize: 'sm'
            })}>
              しばらくお待ちください
            </p>
          </div>

          {error && (
            <div className={css({ 
              bg: 'red.50', 
              border: '1px solid', 
              borderColor: 'red.200', 
              rounded: 'md', 
              p: '4' 
            })}>
              <p className={css({ color: 'red.800', fontSize: 'sm' })}>
                {error}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};