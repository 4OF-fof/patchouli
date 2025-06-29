import React, { useEffect, useState } from 'react';
import { useSearchParams, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { patchouliAPI } from '../services/api';
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
        // URLパラメータからOAuth認証コードを取得
        const code = searchParams.get('code');
        const state = searchParams.get('state');

        if (code && state) {
          // 認証コードをJWTトークンに交換
          const tokenResponse = await patchouliAPI.exchangeCodeForToken(code, state);
          
          // AuthContextにログイン情報を設定
          login(tokenResponse.access_token, tokenResponse.user);
        } else {
          // パラメータが不足している場合
          setError('認証情報が不完全です。再度ログインしてください。');
        }
      } catch (err: any) {
        let errorMessage = '認証処理中にエラーが発生しました。';
        
        // エラーレスポンスから詳細なメッセージを取得
        if (err.response?.data?.message) {
          errorMessage = err.response.data.message;
        } else if (err.message) {
          errorMessage = err.message;
        }
        
        setError(errorMessage);
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
    setTimeout(() => {
      // 3秒後にログインページにリダイレクト
      window.location.href = '/login';
    }, 3000);
  }

  // 処理中またはエラーの表示
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
          {isProcessing && (
            <>
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
                  JWTトークンを取得しています
                </p>
              </div>
            </>
          )}

          {error && (
            <div className={css({ 
              bg: 'red.50', 
              border: '1px solid', 
              borderColor: 'red.200', 
              rounded: 'md', 
              p: '4' 
            })}>
              <h3 className={css({ 
                fontSize: 'md', 
                fontWeight: 'semibold', 
                color: 'red.800',
                mb: '2'
              })}>
                認証エラー
              </h3>
              <p className={css({ color: 'red.700', fontSize: 'sm', mb: '2' })}>
                {error}
              </p>
              <p className={css({ color: 'red.600', fontSize: 'xs' })}>
                3秒後にログインページに戻ります...
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};