import React from 'react';
import { css } from '../../styled-system/css';
import { center, stack } from '../../styled-system/patterns';

export const LoginPage: React.FC = () => {
  const handleLogin = () => {
    // ログインページにリダイレクト
    window.location.href = '/api/login';
  };

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
        <div className={stack({ gap: '6', textAlign: 'center' })}>
          <div>
            <h1 className={css({ 
              fontSize: '3xl', 
              fontWeight: 'bold', 
              color: 'gray.900' 
            })}>
              Patchouli Knowledge Base
            </h1>
            <p className={css({ 
              mt: '2', 
              color: 'gray.600' 
            })}>
              魔法図書館へようこそ
            </p>
          </div>
          
          <div className={css({ 
            border: '1px solid', 
            borderColor: 'gray.200', 
            rounded: 'md', 
            p: '4' 
          })}>
            <h2 className={css({ 
              fontSize: 'lg', 
              fontWeight: 'semibold', 
              mb: '2' 
            })}>
              ログインが必要です
            </h2>
            <p className={css({ 
              color: 'gray.600', 
              fontSize: 'sm', 
              mb: '4' 
            })}>
              保護されたコンテンツにアクセスするには、Googleアカウントでログインしてください。
            </p>
            
            <button
              onClick={handleLogin}
              className={css({
                w: 'full',
                bg: 'brand.primary',
                color: 'white',
                py: '2',
                px: '4',
                rounded: 'md',
                fontWeight: 'medium',
                transition: 'colors',
                cursor: 'pointer',
                _hover: {
                  bg: 'brand.secondary',
                },
              })}
            >
              Googleでログイン
            </button>
          </div>
          
          <div className={css({ 
            fontSize: 'xs', 
            color: 'gray.500', 
            textAlign: 'center' 
          })}>
            ログイン後、自動的にダッシュボードにリダイレクトされます
          </div>
        </div>
      </div>
    </div>
  );
};