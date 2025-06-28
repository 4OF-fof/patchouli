import React from 'react';
import { css } from '../../styled-system/css';
import { center, stack } from '../../styled-system/patterns';

export const RegistrationPage: React.FC = () => {
  const handleRegistration = () => {
    window.location.href = '/api/login?register=true';
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
              魔法図書館への新規登録
            </p>
          </div>
          
          <div className={css({ 
            border: '1px solid', 
            borderColor: 'orange.200', 
            bg: 'orange.50',
            rounded: 'md', 
            p: '4' 
          })}>
            <h2 className={css({ 
              fontSize: 'lg', 
              fontWeight: 'semibold', 
              mb: '2',
              color: 'orange.800'
            })}>
              初回登録
            </h2>
            <p className={css({ 
              color: 'orange.700', 
              fontSize: 'sm', 
              mb: '4' 
            })}>
              Patchouliナレッジベースにアクセスするには、Googleアカウントでの登録が必要です。
              一度登録されたアカウントのみ、今後保護されたコンテンツにアクセスできます。
            </p>
            
            <button
              onClick={handleRegistration}
              className={css({
                w: 'full',
                bg: 'orange.600',
                color: 'white',
                py: '3',
                px: '4',
                rounded: 'md',
                fontWeight: 'medium',
                transition: 'colors',
                cursor: 'pointer',
                _hover: {
                  bg: 'orange.700',
                },
              })}
            >
              Googleアカウントで登録
            </button>
          </div>

          <div className={css({ 
            border: '1px solid', 
            borderColor: 'blue.200', 
            bg: 'blue.50',
            rounded: 'md', 
            p: '4' 
          })}>
            <h3 className={css({ 
              fontSize: 'md', 
              fontWeight: 'semibold', 
              mb: '2',
              color: 'blue.800'
            })}>
              既に登録済みの方
            </h3>
            <p className={css({ 
              color: 'blue.700', 
              fontSize: 'sm', 
              mb: '3' 
            })}>
              登録済みのGoogleアカウントでログインしてください。
            </p>
            
            <a
              href="/login"
              className={css({
                display: 'inline-block',
                w: 'full',
                bg: 'blue.600',
                color: 'white',
                py: '2',
                px: '4',
                rounded: 'md',
                fontWeight: 'medium',
                textAlign: 'center',
                textDecoration: 'none',
                transition: 'colors',
                cursor: 'pointer',
                _hover: {
                  bg: 'blue.700',
                },
              })}
            >
              ログインページへ
            </a>
          </div>
          
          <div className={css({ 
            fontSize: 'xs', 
            color: 'gray.500', 
            textAlign: 'center' 
          })}>
            登録後、自動的にダッシュボードにリダイレクトされます
          </div>
        </div>
      </div>
    </div>
  );
};