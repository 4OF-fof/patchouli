import React, { useEffect } from 'react';
import { css } from '../../styled-system/css';
import { center, stack } from '../../styled-system/patterns';
import { patchouliAPI } from '../services/api';
import { useNavigate } from 'react-router-dom';

export const RegistrationPage: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const checkRootAndRedirect = async () => {
      try {
        const { root_exists } = await patchouliAPI.checkRootExists();
        if (root_exists) {
          navigate('/login');
        }
      } catch (error) {
        console.error('Failed to check root existence:', error);
      }
    };
    
    checkRootAndRedirect();
  }, [navigate]);

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