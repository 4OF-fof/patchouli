import React, { useEffect, useState } from 'react';
import { css } from '../../styled-system/css';
import { center, stack } from '../../styled-system/patterns';
import { patchouliAPI } from '../services/api';
import { useNavigate } from 'react-router-dom';

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [isRegistration, setIsRegistration] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string>('');

  useEffect(() => {
    const checkRootAndRedirect = async () => {
      try {
        const { root_exists } = await patchouliAPI.checkRootExists();
        if (!root_exists) {
          navigate('/register');
          return;
        }
      } catch (error) {
        console.error('Failed to check root existence:', error);
      }
    };

    const urlParams = new URLSearchParams(window.location.search);
    const register = urlParams.get('register') === 'true';
    const invite = urlParams.get('invite');
    
    setIsRegistration(register);
    setInviteCode(invite);

    // 通常のログインページの場合のみrootアカウント存在確認
    if (!register) {
      checkRootAndRedirect();
    }

    // 招待コード付きの登録URLの場合の検証
    if (register && invite) {
      // 招待コードの基本的な形式チェック（UUID形式）
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(invite)) {
        setInviteError('無効な招待コード形式です');
      }
    }
  }, [navigate]);

  const handleLogin = () => {
    let loginUrl = '/api/login';
    const params = new URLSearchParams();

    if (isRegistration) {
      params.append('register', 'true');
    }

    if (inviteCode) {
      params.append('invite', inviteCode);
    }

    if (params.toString()) {
      loginUrl += '?' + params.toString();
    }

    window.location.href = loginUrl;
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
              {isRegistration ? '魔法図書館への新規登録' : '魔法図書館へようこそ'}
            </p>
          </div>

          {/* 招待コードエラー表示 */}
          {inviteError && (
            <div className={css({ 
              bg: 'red.50', 
              border: '1px solid', 
              borderColor: 'red.200', 
              rounded: 'md', 
              p: '4' 
            })}>
              <p className={css({ color: 'red.800', fontSize: 'sm', textAlign: 'center' })}>
                {inviteError}
              </p>
            </div>
          )}

          {/* 招待コード情報表示 */}
          {isRegistration && inviteCode && !inviteError && (
            <div className={css({ 
              bg: 'green.50', 
              border: '1px solid', 
              borderColor: 'green.200', 
              rounded: 'md', 
              p: '4' 
            })}>
              <h3 className={css({ 
                fontSize: 'md', 
                fontWeight: 'semibold', 
                color: 'green.800',
                mb: '2'
              })}>
                招待登録
              </h3>
              <p className={css({ color: 'green.700', fontSize: 'sm' })}>
                有効な招待コードが検出されました。新規登録を行います。
              </p>
            </div>
          )}
          
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
              {isRegistration ? '新規登録' : 'ログインが必要です'}
            </h2>
            <p className={css({ 
              color: 'gray.600', 
              fontSize: 'sm', 
              mb: '4' 
            })}>
              {isRegistration 
                ? 'Googleアカウントで新規登録を行います。' 
                : '保護されたコンテンツにアクセスするには、Googleアカウントでログインしてください。'
              }
            </p>
            
            <button
              onClick={handleLogin}
              disabled={!!inviteError}
              className={css({
                w: 'full',
                bg: inviteError ? 'gray.400' : (isRegistration ? 'orange.600' : 'brand.primary'),
                color: 'white',
                py: '2',
                px: '4',
                rounded: 'md',
                fontWeight: 'medium',
                transition: 'colors',
                cursor: inviteError ? 'not-allowed' : 'pointer',
                _hover: {
                  bg: inviteError ? 'gray.400' : (isRegistration ? 'orange.700' : 'brand.secondary'),
                },
              })}
            >
              {isRegistration ? 'Googleアカウントで登録' : 'Googleでログイン'}
            </button>
          </div>
          
          <div className={css({ 
            fontSize: 'xs', 
            color: 'gray.500', 
            textAlign: 'center' 
          })}>
            {isRegistration ? '登録後、自動的にダッシュボードにリダイレクトされます' : 'ログイン後、自動的にダッシュボードにリダイレクトされます'}
          </div>

        </div>
      </div>
    </div>
  );
};