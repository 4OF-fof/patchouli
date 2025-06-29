import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { patchouliAPI } from '../services/api';
import type { InviteResponse, UserResponse, ProtectedContent } from '../services/api';
import { css } from '../../styled-system/css';
import { container, stack, hstack } from '../../styled-system/patterns';

export const Dashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const [protectedContent, setProtectedContent] = useState<ProtectedContent | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [inviteCodes, setInviteCodes] = useState<InviteResponse[]>([]);
  const [isCreatingInvite, setIsCreatingInvite] = useState(false);
  const [inviteError, setInviteError] = useState<string>('');
  const [newInviteUrl, setNewInviteUrl] = useState<string>('');
  const [users, setUsers] = useState<UserResponse[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [usersError, setUsersError] = useState<string>('');

  const fetchProtectedContent = async () => {
    setIsLoading(true);
    setError('');
    
    try {
      const content = await patchouliAPI.getProtectedContent();
      setProtectedContent(content);
    } catch (err: any) {
      setError('保護されたコンテンツの取得に失敗しました');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  const fetchInviteCodes = async () => {
    if (!user?.can_invite) return;

    try {
      const codes = await patchouliAPI.getInvites();
      setInviteCodes(codes);
    } catch (err: any) {
      setInviteError('招待コードの取得に失敗しました');
      console.error(err);
    }
  };

  const createInviteCode = async () => {
    if (!user?.can_invite) return;

    setIsCreatingInvite(true);
    setInviteError('');
    setNewInviteUrl('');

    try {
      const invite = await patchouliAPI.createInvite();
      
      // 招待URLを生成
      const baseUrl = window.location.origin;
      const inviteUrl = `${baseUrl}/login?register=true&invite=${invite.code}`;
      setNewInviteUrl(inviteUrl);
      
      // 招待コード一覧を更新
      await fetchInviteCodes();
    } catch (err: any) {
      setInviteError('招待コードの作成に失敗しました');
      console.error(err);
    } finally {
      setIsCreatingInvite(false);
    }
  };

  const fetchUsers = async () => {
    if (!user?.is_root) return;

    setIsLoadingUsers(true);
    setUsersError('');

    try {
      const usersList = await patchouliAPI.getUsers();
      setUsers(usersList);
    } catch (err: any) {
      setUsersError('ユーザー一覧の取得に失敗しました');
      console.error(err);
    } finally {
      setIsLoadingUsers(false);
    }
  };

  const deleteUser = async (userId: number) => {
    if (!user?.is_root) return;
    
    if (!confirm('このユーザーを削除してもよろしいですか？')) {
      return;
    }

    try {
      await patchouliAPI.deleteUser(userId);
      await fetchUsers(); // ユーザー一覧を再取得
    } catch (err: any) {
      alert('ユーザーの削除に失敗しました');
      console.error(err);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      alert('クリップボードにコピーしました');
    }).catch(err => {
      console.error('コピーに失敗しました:', err);
    });
  };

  // 初期データ読み込み
  useEffect(() => {
    fetchProtectedContent();
    if (user?.can_invite) {
      fetchInviteCodes();
    }
    if (user?.is_root) {
      fetchUsers();
    }
  }, [user]);

  return (
    <div className={container({ maxW: '6xl', py: '8' })}>
      <div className={stack({ gap: '8' })}>
        {/* ヘッダー */}
        <header className={hstack({ justify: 'space-between', alignItems: 'center' })}>
          <div>
            <h1 className={css({ fontSize: '3xl', fontWeight: 'bold', color: 'gray.900' })}>
              Patchouli Dashboard
            </h1>
            <p className={css({ mt: '1', color: 'gray.600' })}>
              ようこそ、{user?.name}さん ({user?.email})
            </p>
            <div className={css({ mt: '1', fontSize: 'sm', color: 'gray.500' })}>
              {user?.is_root && <span className={css({ bg: 'red.100', color: 'red.800', px: '2', py: '1', rounded: 'md', mr: '2' })}>Root</span>}
              {user?.can_invite && <span className={css({ bg: 'blue.100', color: 'blue.800', px: '2', py: '1', rounded: 'md' })}>招待権限</span>}
            </div>
          </div>
          <button
            onClick={handleLogout}
            className={css({
              bg: 'gray.600',
              color: 'white',
              px: '4',
              py: '2',
              rounded: 'md',
              fontWeight: 'medium',
              _hover: { bg: 'gray.700' },
            })}
          >
            ログアウト
          </button>
        </header>

        {/* 保護されたコンテンツ */}
        <section className={css({ bg: 'white', p: '6', rounded: 'lg', shadow: 'sm' })}>
          <h2 className={css({ fontSize: '2xl', fontWeight: 'semibold', mb: '4' })}>
            保護されたコンテンツ
          </h2>
          
          <button
            onClick={fetchProtectedContent}
            disabled={isLoading}
            className={css({
              bg: 'brand.primary',
              color: 'white',
              px: '4',
              py: '2',
              rounded: 'md',
              fontWeight: 'medium',
              mb: '4',
              _hover: { bg: 'brand.secondary' },
              _disabled: { bg: 'gray.400', cursor: 'not-allowed' },
            })}
          >
            {isLoading ? 'ロード中...' : 'コンテンツを取得'}
          </button>

          {error && (
            <div className={css({ bg: 'red.50', border: '1px solid', borderColor: 'red.200', rounded: 'md', p: '4', mb: '4' })}>
              <p className={css({ color: 'red.800' })}>{error}</p>
            </div>
          )}

          {protectedContent && (
            <div className={css({ bg: 'gray.50', p: '4', rounded: 'md' })}>
              <p className={css({ mb: '2' })}>{protectedContent.message}</p>
              <p className={css({ fontSize: 'sm', color: 'gray.600' })}>
                取得時刻: {new Date(protectedContent.timestamp).toLocaleString('ja-JP')}
              </p>
            </div>
          )}
        </section>

        {/* 招待コード管理 (招待権限を持つユーザーのみ) */}
        {user?.can_invite && (
          <section className={css({ bg: 'white', p: '6', rounded: 'lg', shadow: 'sm' })}>
            <h2 className={css({ fontSize: '2xl', fontWeight: 'semibold', mb: '4' })}>
              招待コード管理
            </h2>

            <button
              onClick={createInviteCode}
              disabled={isCreatingInvite}
              className={css({
                bg: 'green.600',
                color: 'white',
                px: '4',
                py: '2',
                rounded: 'md',
                fontWeight: 'medium',
                mb: '4',
                _hover: { bg: 'green.700' },
                _disabled: { bg: 'gray.400', cursor: 'not-allowed' },
              })}
            >
              {isCreatingInvite ? '作成中...' : '新しい招待コードを作成'}
            </button>

            {inviteError && (
              <div className={css({ bg: 'red.50', border: '1px solid', borderColor: 'red.200', rounded: 'md', p: '4', mb: '4' })}>
                <p className={css({ color: 'red.800' })}>{inviteError}</p>
              </div>
            )}

            {newInviteUrl && (
              <div className={css({ bg: 'green.50', border: '1px solid', borderColor: 'green.200', rounded: 'md', p: '4', mb: '4' })}>
                <h3 className={css({ fontWeight: 'semibold', color: 'green.800', mb: '2' })}>
                  新しい招待URLが作成されました
                </h3>
                <div className={hstack({ gap: '2' })}>
                  <input
                    type="text"
                    value={newInviteUrl}
                    readOnly
                    className={css({
                      flex: '1',
                      p: '2',
                      border: '1px solid',
                      borderColor: 'green.300',
                      rounded: 'md',
                      fontSize: 'sm',
                    })}
                  />
                  <button
                    onClick={() => copyToClipboard(newInviteUrl)}
                    className={css({
                      bg: 'green.600',
                      color: 'white',
                      px: '3',
                      py: '2',
                      rounded: 'md',
                      fontSize: 'sm',
                      _hover: { bg: 'green.700' },
                    })}
                  >
                    コピー
                  </button>
                </div>
              </div>
            )}

            {inviteCodes.length > 0 && (
              <div>
                <h3 className={css({ fontSize: 'lg', fontWeight: 'semibold', mb: '3' })}>
                  作成済み招待コード
                </h3>
                <div className={css({ overflowX: 'auto' })}>
                  <table className={css({ w: 'full', border: '1px solid', borderColor: 'gray.200' })}>
                    <thead className={css({ bg: 'gray.50' })}>
                      <tr>
                        <th className={css({ p: '3', textAlign: 'left', borderBottom: '1px solid', borderColor: 'gray.200' })}>コード</th>
                        <th className={css({ p: '3', textAlign: 'left', borderBottom: '1px solid', borderColor: 'gray.200' })}>作成日時</th>
                        <th className={css({ p: '3', textAlign: 'left', borderBottom: '1px solid', borderColor: 'gray.200' })}>使用状況</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inviteCodes.map((invite) => (
                        <tr key={invite.id}>
                          <td className={css({ p: '3', borderBottom: '1px solid', borderColor: 'gray.200' })}>
                            <code className={css({ fontSize: 'sm', bg: 'gray.100', p: '1', rounded: 'sm' })}>
                              {invite.code}
                            </code>
                          </td>
                          <td className={css({ p: '3', borderBottom: '1px solid', borderColor: 'gray.200' })}>
                            {new Date(invite.created_at).toLocaleString('ja-JP')}
                          </td>
                          <td className={css({ p: '3', borderBottom: '1px solid', borderColor: 'gray.200' })}>
                            {invite.used_by ? (
                              <span className={css({ color: 'green.600' })}>
                                使用済み ({invite.used_at ? new Date(invite.used_at).toLocaleString('ja-JP') : ''})
                              </span>
                            ) : (
                              <span className={css({ color: 'blue.600' })}>未使用</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ユーザー管理 (Rootユーザーのみ) */}
        {user?.is_root && (
          <section className={css({ bg: 'white', p: '6', rounded: 'lg', shadow: 'sm' })}>
            <h2 className={css({ fontSize: '2xl', fontWeight: 'semibold', mb: '4' })}>
              ユーザー管理
            </h2>

            <button
              onClick={fetchUsers}
              disabled={isLoadingUsers}
              className={css({
                bg: 'blue.600',
                color: 'white',
                px: '4',
                py: '2',
                rounded: 'md',
                fontWeight: 'medium',
                mb: '4',
                _hover: { bg: 'blue.700' },
                _disabled: { bg: 'gray.400', cursor: 'not-allowed' },
              })}
            >
              {isLoadingUsers ? 'ロード中...' : 'ユーザー一覧を更新'}
            </button>

            {usersError && (
              <div className={css({ bg: 'red.50', border: '1px solid', borderColor: 'red.200', rounded: 'md', p: '4', mb: '4' })}>
                <p className={css({ color: 'red.800' })}>{usersError}</p>
              </div>
            )}

            {users.length > 0 && (
              <div className={css({ overflowX: 'auto' })}>
                <table className={css({ w: 'full', border: '1px solid', borderColor: 'gray.200' })}>
                  <thead className={css({ bg: 'gray.50' })}>
                    <tr>
                      <th className={css({ p: '3', textAlign: 'left', borderBottom: '1px solid', borderColor: 'gray.200' })}>ID</th>
                      <th className={css({ p: '3', textAlign: 'left', borderBottom: '1px solid', borderColor: 'gray.200' })}>名前</th>
                      <th className={css({ p: '3', textAlign: 'left', borderBottom: '1px solid', borderColor: 'gray.200' })}>メール</th>
                      <th className={css({ p: '3', textAlign: 'left', borderBottom: '1px solid', borderColor: 'gray.200' })}>権限</th>
                      <th className={css({ p: '3', textAlign: 'left', borderBottom: '1px solid', borderColor: 'gray.200' })}>登録日</th>
                      <th className={css({ p: '3', textAlign: 'left', borderBottom: '1px solid', borderColor: 'gray.200' })}>最終ログイン</th>
                      <th className={css({ p: '3', textAlign: 'left', borderBottom: '1px solid', borderColor: 'gray.200' })}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td className={css({ p: '3', borderBottom: '1px solid', borderColor: 'gray.200' })}>{u.id}</td>
                        <td className={css({ p: '3', borderBottom: '1px solid', borderColor: 'gray.200' })}>{u.name}</td>
                        <td className={css({ p: '3', borderBottom: '1px solid', borderColor: 'gray.200' })}>{u.email}</td>
                        <td className={css({ p: '3', borderBottom: '1px solid', borderColor: 'gray.200' })}>
                          <div className={stack({ gap: '1' })}>
                            {u.is_root && <span className={css({ bg: 'red.100', color: 'red.800', px: '2', py: '1', rounded: 'sm', fontSize: 'xs' })}>Root</span>}
                            {u.can_invite && <span className={css({ bg: 'blue.100', color: 'blue.800', px: '2', py: '1', rounded: 'sm', fontSize: 'xs' })}>招待権限</span>}
                          </div>
                        </td>
                        <td className={css({ p: '3', borderBottom: '1px solid', borderColor: 'gray.200' })}>
                          {new Date(u.created_at).toLocaleString('ja-JP')}
                        </td>
                        <td className={css({ p: '3', borderBottom: '1px solid', borderColor: 'gray.200' })}>
                          {u.last_login ? new Date(u.last_login).toLocaleString('ja-JP') : 'なし'}
                        </td>
                        <td className={css({ p: '3', borderBottom: '1px solid', borderColor: 'gray.200' })}>
                          {u.id !== parseInt(user.id) && !u.is_root && (
                            <button
                              onClick={() => deleteUser(u.id)}
                              className={css({
                                bg: 'red.600',
                                color: 'white',
                                px: '3',
                                py: '1',
                                rounded: 'sm',
                                fontSize: 'sm',
                                _hover: { bg: 'red.700' },
                              })}
                            >
                              削除
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
};