import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { patchouliAPI } from '../services/api';
import type { InviteCode, RegisteredUser } from '../services/api';
import { css } from '../../styled-system/css';
import { container, stack, hstack } from '../../styled-system/patterns';

export const Dashboard: React.FC = () => {
  const { sessionId, userEmail, logout } = useAuth();
  const [protectedContent, setProtectedContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
  const [isCreatingInvite, setIsCreatingInvite] = useState(false);
  const [inviteError, setInviteError] = useState<string>('');
  const [newInviteUrl, setNewInviteUrl] = useState<string>('');
  const [users, setUsers] = useState<RegisteredUser[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [usersError, setUsersError] = useState<string>('');
  const [currentUser, setCurrentUser] = useState<RegisteredUser | null>(null);

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

  const fetchInviteCodes = async () => {
    if (!sessionId) return;

    try {
      const response = await patchouliAPI.listInviteCodes(sessionId);
      setInviteCodes(response.invite_codes);
    } catch (err) {
      setInviteError('招待コードの取得に失敗しました');
      console.error(err);
    }
  };

  const createInviteCode = async () => {
    if (!sessionId) return;

    setIsCreatingInvite(true);
    setInviteError('');
    setNewInviteUrl('');

    try {
      const response = await patchouliAPI.createInviteCode(sessionId);
      setNewInviteUrl(response.invite_url);
      await fetchInviteCodes(); // 招待コードリストを更新
    } catch (err) {
      setInviteError('招待コードの作成に失敗しました');
      console.error(err);
    } finally {
      setIsCreatingInvite(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      alert('クリップボードにコピーしました');
    } catch (err) {
      console.error('Failed to copy text:', err);
      alert('コピーに失敗しました');
    }
  };

  const fetchUsers = async () => {
    if (!sessionId) return;

    setIsLoadingUsers(true);
    setUsersError('');

    try {
      const response = await patchouliAPI.listUsers(sessionId);
      setUsers(response.users);
      
      // 現在のユーザー情報を取得
      const current = response.users.find(user => user.email === userEmail);
      setCurrentUser(current || null);
    } catch (err: any) {
      if (err.response?.status === 403) {
        setUsersError('管理者権限がありません');
      } else {
        setUsersError('ユーザー一覧の取得に失敗しました');
      }
      console.error(err);
    } finally {
      setIsLoadingUsers(false);
    }
  };

  const deleteUser = async (userId: number, userName: string) => {
    if (!sessionId) return;

    if (!confirm(`ユーザー「${userName}」を削除しますか？この操作は取り消せません。`)) {
      return;
    }

    try {
      const response = await patchouliAPI.deleteUser(sessionId, userId);
      if (response.success) {
        alert(response.message);
        await fetchUsers(); // リストを更新
      } else {
        alert(`削除に失敗しました: ${response.message}`);
      }
    } catch (err) {
      alert('ユーザー削除中にエラーが発生しました');
      console.error(err);
    }
  };

  useEffect(() => {
    fetchProtectedContent();
    fetchInviteCodes();
    fetchUsers();
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

          {/* Invite Management Section - rootユーザーのみ表示 */}
          {currentUser?.can_invite && (
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
                招待コード管理
              </h3>
              <button
                onClick={createInviteCode}
                disabled={isCreatingInvite}
                className={css({
                  bg: 'green.600',
                  color: 'white',
                  py: '2',
                  px: '4',
                  rounded: 'md',
                  fontSize: 'sm',
                  fontWeight: 'medium',
                  transition: 'colors',
                  cursor: isCreatingInvite ? 'not-allowed' : 'pointer',
                  opacity: isCreatingInvite ? '0.5' : '1',
                  _hover: {
                    bg: isCreatingInvite ? 'green.600' : 'green.700',
                  },
                })}
              >
                {isCreatingInvite ? '作成中...' : '新しい招待コード作成'}
              </button>
            </div>

            {inviteError && (
              <div className={css({ 
                bg: 'red.50', 
                border: '1px solid', 
                borderColor: 'red.200', 
                rounded: 'md', 
                p: '4', 
                mb: '4' 
              })}>
                <p className={css({ color: 'red.800', fontSize: 'sm' })}>
                  {inviteError}
                </p>
              </div>
            )}

            {newInviteUrl && (
              <div className={css({ 
                bg: 'green.50', 
                border: '1px solid', 
                borderColor: 'green.200', 
                rounded: 'md', 
                p: '4', 
                mb: '4' 
              })}>
                <h4 className={css({ 
                  fontSize: 'sm', 
                  fontWeight: 'semibold', 
                  color: 'green.900', 
                  mb: '2' 
                })}>
                  新しい招待URLが作成されました
                </h4>
                <div className={css({ display: 'flex', gap: '2', alignItems: 'center' })}>
                  <input
                    type="text"
                    value={newInviteUrl}
                    readOnly
                    className={css({
                      flex: '1',
                      bg: 'white',
                      border: '1px solid',
                      borderColor: 'green.300',
                      rounded: 'md',
                      px: '3',
                      py: '2',
                      fontSize: 'sm',
                      fontFamily: 'mono'
                    })}
                  />
                  <button
                    onClick={() => copyToClipboard(newInviteUrl)}
                    className={css({
                      bg: 'green.600',
                      color: 'white',
                      py: '2',
                      px: '3',
                      rounded: 'md',
                      fontSize: 'sm',
                      cursor: 'pointer',
                      _hover: {
                        bg: 'green.700',
                      },
                    })}
                  >
                    コピー
                  </button>
                </div>
              </div>
            )}

            {/* Existing Invite Codes */}
            <div>
              <h4 className={css({ 
                fontSize: 'md', 
                fontWeight: 'semibold', 
                color: 'gray.900', 
                mb: '3' 
              })}>
                作成済み招待コード
              </h4>
              
              {inviteCodes.length === 0 ? (
                <div className={css({ 
                  textAlign: 'center', 
                  py: '6', 
                  color: 'gray.500' 
                })}>
                  まだ招待コードがありません
                </div>
              ) : (
                <div className={stack({ gap: '3' })}>
                  {inviteCodes.map((invite) => (
                    <div
                      key={invite.id}
                      className={css({
                        bg: 'gray.50',
                        border: '1px solid',
                        borderColor: 'gray.200',
                        rounded: 'md',
                        p: '4'
                      })}
                    >
                      <div className={hstack({ justify: 'space-between', mb: '2' })}>
                        <span className={css({ 
                          fontSize: 'sm', 
                          fontWeight: 'medium',
                          fontFamily: 'mono',
                          color: 'gray.800'
                        })}>
                          {invite.code}
                        </span>
                        <span className={css({
                          px: '2',
                          py: '1',
                          rounded: 'sm',
                          fontSize: 'xs',
                          fontWeight: 'medium',
                          bg: invite.used_by ? 'red.100' : 'green.100',
                          color: invite.used_by ? 'red.800' : 'green.800'
                        })}>
                          {invite.used_by ? '使用済み' : '未使用'}
                        </span>
                      </div>
                      <div className={css({ fontSize: 'xs', color: 'gray.600' })}>
                        作成日: {new Date(invite.created_at).toLocaleDateString('ja-JP')}
                        {invite.used_at && (
                          <span> | 使用日: {new Date(invite.used_at).toLocaleDateString('ja-JP')}</span>
                        )}
                      </div>
                      {!invite.used_by && (
                        <button
                          onClick={() => copyToClipboard(`${window.location.origin}/login?register=true&invite=${invite.code}`)}
                          className={css({
                            mt: '2',
                            bg: 'blue.600',
                            color: 'white',
                            py: '1',
                            px: '3',
                            rounded: 'sm',
                            fontSize: 'xs',
                            cursor: 'pointer',
                            _hover: {
                              bg: 'blue.700',
                            },
                          })}
                        >
                          招待URLをコピー
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          )}

          {/* User Management Section - rootユーザーのみ表示 */}
          {currentUser?.is_root && (
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
                  ユーザー管理 (管理者)
                </h3>
                <button
                  onClick={fetchUsers}
                  disabled={isLoadingUsers}
                  className={css({
                    bg: 'blue.600',
                    color: 'white',
                    py: '2',
                    px: '4',
                    rounded: 'md',
                    fontSize: 'sm',
                    fontWeight: 'medium',
                    transition: 'colors',
                    cursor: isLoadingUsers ? 'not-allowed' : 'pointer',
                    opacity: isLoadingUsers ? '0.5' : '1',
                    _hover: {
                      bg: isLoadingUsers ? 'blue.600' : 'blue.700',
                    },
                  })}
                >
                  {isLoadingUsers ? '読み込み中...' : '更新'}
                </button>
              </div>

              {usersError && (
                <div className={css({ 
                  bg: 'red.50', 
                  border: '1px solid', 
                  borderColor: 'red.200', 
                  rounded: 'md', 
                  p: '4', 
                  mb: '4' 
                })}>
                  <p className={css({ color: 'red.800', fontSize: 'sm' })}>
                    {usersError}
                  </p>
                </div>
              )}

              <div>
                <h4 className={css({ 
                  fontSize: 'md', 
                  fontWeight: 'semibold', 
                  color: 'gray.900', 
                  mb: '3' 
                })}>
                  登録ユーザー一覧
                </h4>
                
                {users.length === 0 ? (
                  <div className={css({ 
                    textAlign: 'center', 
                    py: '6', 
                    color: 'gray.500' 
                  })}>
                    ユーザーが見つかりません
                  </div>
                ) : (
                  <div className={stack({ gap: '3' })}>
                    {users.map((user) => (
                      <div
                        key={user.id}
                        className={css({
                          bg: user.is_root ? 'yellow.50' : 'gray.50',
                          border: '1px solid',
                          borderColor: user.is_root ? 'yellow.200' : 'gray.200',
                          rounded: 'md',
                          p: '4'
                        })}
                      >
                        <div className={hstack({ justify: 'space-between', mb: '2' })}>
                          <div>
                            <span className={css({ 
                              fontSize: 'md', 
                              fontWeight: 'semibold',
                              color: 'gray.800'
                            })}>
                              {user.name}
                            </span>
                            <span className={css({ 
                              fontSize: 'sm', 
                              color: 'gray.600',
                              ml: '2'
                            })}>
                              ({user.email})
                            </span>
                          </div>
                          <div className={hstack({ gap: '2' })}>
                            {user.is_root && (
                              <span className={css({
                                px: '2',
                                py: '1',
                                rounded: 'sm',
                                fontSize: 'xs',
                                fontWeight: 'medium',
                                bg: 'yellow.100',
                                color: 'yellow.800'
                              })}>
                                ROOT
                              </span>
                            )}
                            {user.can_invite && (
                              <span className={css({
                                px: '2',
                                py: '1',
                                rounded: 'sm',
                                fontSize: 'xs',
                                fontWeight: 'medium',
                                bg: 'green.100',
                                color: 'green.800'
                              })}>
                                招待権限
                              </span>
                            )}
                            {user.invited_by && (
                              <span className={css({
                                px: '2',
                                py: '1',
                                rounded: 'sm',
                                fontSize: 'xs',
                                fontWeight: 'medium',
                                bg: 'blue.100',
                                color: 'blue.800'
                              })}>
                                招待済み
                              </span>
                            )}
                          </div>
                        </div>
                        <div className={css({ fontSize: 'xs', color: 'gray.600', mb: '2' })}>
                          登録日: {new Date(user.registered_at).toLocaleDateString('ja-JP')}
                          {user.last_login && (
                            <span> | 最終ログイン: {new Date(user.last_login).toLocaleDateString('ja-JP')}</span>
                          )}
                          {user.invited_by && (
                            <span> | 招待者ID: {user.invited_by}</span>
                          )}
                        </div>
                        {!user.is_root && user.id !== currentUser?.id && (
                          <button
                            onClick={() => deleteUser(user.id, user.name)}
                            className={css({
                              bg: 'red.600',
                              color: 'white',
                              py: '1',
                              px: '3',
                              rounded: 'sm',
                              fontSize: 'xs',
                              cursor: 'pointer',
                              _hover: {
                                bg: 'red.700',
                              },
                            })}
                          >
                            削除
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

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