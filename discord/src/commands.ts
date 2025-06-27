import { SlashCommandBuilder, CommandInteraction, EmbedBuilder } from 'discord.js';
import { PatchouliClient } from './client.js';

export interface Command {
  data: SlashCommandBuilder;
  execute: (interaction: CommandInteraction, patchouliClient: PatchouliClient) => Promise<void>;
}

// セッションストレージ（メモリ内、実際のプロダクションではデータベースを使用）
const userSessions = new Map<string, string>();
const pendingAuth = new Map<string, string>();
const authChannels = new Map<string, string>(); // authToken -> channelId の対応

// 認証完了通知を処理する関数
export async function handleAuthCompletion(authToken: string, userEmail: string, client: any) {
  const channelId = authChannels.get(authToken);
  if (!channelId) {
    console.log(`No channel found for auth token: ${authToken}`);
    return;
  }

  // 認証完了時にセッションIDを取得して保存
  let userId: string | null = null;
  for (const [user, token] of pendingAuth.entries()) {
    if (token === authToken) {
      userId = user;
      break;
    }
  }

  if (userId) {
    try {
      // PatchouliClientを使用してセッションIDを取得
      const patchouliClient = new (await import('./client.js')).PatchouliClient();
      const authStatus = await patchouliClient.checkAuthStatus(authToken);
      
      if (authStatus.status === 'completed' && authStatus.session_id) {
        // セッションIDを保存
        userSessions.set(userId, authStatus.session_id);
        pendingAuth.delete(userId);
        console.log(`Stored session ID for user ${userId}: ${authStatus.session_id}`);
      }
    } catch (error) {
      console.error('Failed to retrieve session ID during auth completion:', error);
    }
  }

  try {
    const channel = await client.channels.fetch(channelId);
    if (channel?.isTextBased()) {
      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('✅ 認証完了')
        .setDescription('Patchouliサーバーでの認証が完了しました！\n`/getcontent` コマンドで保護されたコンテンツにアクセスできます。')
        .addFields(
          { name: 'ユーザー', value: userEmail }
        )
        .setTimestamp();

      await channel.send({ embeds: [embed] });
      console.log(`Sent auth completion notification to channel ${channelId} for user ${userEmail}`);
    }
  } catch (error) {
    console.error('Failed to send auth completion notification:', error);
  }

  // 通知送信後にクリーンアップ
  authChannels.delete(authToken);
}

export const commands: Command[] = [
  {
    data: new SlashCommandBuilder()
      .setName('authenticate')
      .setDescription('Patchouliサーバーで認証を行います'),
    
    async execute(interaction: CommandInteraction, patchouliClient: PatchouliClient) {
      const userId = interaction.user.id;
      
      try {
        // 既に認証済みかチェック
        if (userSessions.has(userId)) {
          await interaction.reply({
            content: '既に認証済みです！',
            ephemeral: true
          });
          return;
        }

        // 認証トークンを取得
        const authToken = await patchouliClient.authenticateForDiscordUser(userId);
        pendingAuth.set(userId, authToken);
        authChannels.set(authToken, interaction.channelId!);

        const embed = new EmbedBuilder()
          .setColor(0x0099FF)
          .setTitle('🔐 Patchouli認証')
          .setDescription('以下のリンクをクリックして認証を完了してください：')
          .addFields(
            { name: '認証URL', value: `http://localhost:8080/login?token=${authToken}` },
            { name: '認証トークン', value: authToken }
          )
          .setFooter({ text: '認証後、/checkauth コマンドで状態を確認してください' });

        await interaction.reply({
          embeds: [embed],
          ephemeral: true
        });

      } catch (error) {
        console.error('Authentication error:', error);
        await interaction.reply({
          content: `認証の開始に失敗しました: ${error instanceof Error ? error.message : 'Unknown error'}`,
          ephemeral: true
        });
      }
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('checkauth')
      .setDescription('認証状態をチェックします'),
    
    async execute(interaction: CommandInteraction, patchouliClient: PatchouliClient) {
      const userId = interaction.user.id;
      
      try {
        // 既にセッションIDがあるかチェック
        if (userSessions.has(userId)) {
          await interaction.reply({
            content: '✅ 認証済みです！',
            ephemeral: true
          });
          return;
        }

        // 認証待ちのトークンがあるかチェック
        const authToken = pendingAuth.get(userId);
        if (!authToken) {
          await interaction.reply({
            content: '認証が開始されていません。まず `/authenticate` コマンドを実行してください。',
            ephemeral: true
          });
          return;
        }

        // 認証状態をチェック
        const authStatus = await patchouliClient.checkAuthStatus(authToken);
        
        switch (authStatus.status) {
          case 'completed':
            if (authStatus.session_id) {
              userSessions.set(userId, authStatus.session_id);
              pendingAuth.delete(userId);
              
              const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ 認証完了')
                .setDescription('Patchouliサーバーでの認証が完了しました！')
                .addFields(
                  { name: 'ユーザー', value: authStatus.user_email || 'Unknown' }
                );

              await interaction.reply({
                embeds: [embed],
                ephemeral: true
              });
            }
            break;
            
          case 'pending':
            await interaction.reply({
              content: '⏳ 認証待ちです。ブラウザで認証を完了してください。',
              ephemeral: true
            });
            break;
            
          case 'error':
            pendingAuth.delete(userId);
            await interaction.reply({
              content: '❌ 認証でエラーが発生しました。再度 `/authenticate` コマンドを実行してください。',
              ephemeral: true
            });
            break;
            
          default:
            await interaction.reply({
              content: `未知の認証状態: ${authStatus.status}`,
              ephemeral: true
            });
        }

      } catch (error) {
        console.error('Check auth error:', error);
        await interaction.reply({
          content: `認証状態の確認に失敗しました: ${error instanceof Error ? error.message : 'Unknown error'}`,
          ephemeral: true
        });
      }
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('getcontent')
      .setDescription('保護されたコンテンツを取得します'),
    
    async execute(interaction: CommandInteraction, patchouliClient: PatchouliClient) {
      const userId = interaction.user.id;
      
      try {
        const sessionId = userSessions.get(userId);
        if (!sessionId) {
          await interaction.reply({
            content: '認証が必要です。まず `/authenticate` コマンドを実行してください。',
            ephemeral: true
          });
          return;
        }

        // 処理中メッセージ
        await interaction.deferReply({ ephemeral: true });

        const content = await patchouliClient.getProtectedContent(sessionId);
        
        const embed = new EmbedBuilder()
          .setColor(0x00FF00)
          .setTitle('📚 Patchouli Knowledge Base')
          .setDescription(content.substring(0, 4000)) // Discord埋め込みの制限
          .setTimestamp();

        await interaction.editReply({
          embeds: [embed]
        });

      } catch (error) {
        console.error('Get content error:', error);
        
        if (error instanceof Error && error.message.includes('Invalid or expired session ID')) {
          // セッションが無効な場合、ローカルセッションを削除
          userSessions.delete(userId);
          await interaction.editReply({
            content: 'セッションが無効または期限切れです。再度 `/authenticate` コマンドを実行してください。'
          });
        } else {
          await interaction.editReply({
            content: `コンテンツの取得に失敗しました: ${error instanceof Error ? error.message : 'Unknown error'}`
          });
        }
      }
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('status')
      .setDescription('Patchouliサーバーの状態を確認します'),
    
    async execute(interaction: CommandInteraction, patchouliClient: PatchouliClient) {
      try {
        const isHealthy = await patchouliClient.healthCheck();
        
        const embed = new EmbedBuilder()
          .setColor(isHealthy ? 0x00FF00 : 0xFF0000)
          .setTitle('🏥 Patchouliサーバー状態')
          .addFields(
            { name: 'ステータス', value: isHealthy ? '✅ 正常' : '❌ 接続不可' },
            { name: 'URL', value: 'http://localhost:8080' }
          )
          .setTimestamp();

        await interaction.reply({
          embeds: [embed],
          ephemeral: true
        });

      } catch (error) {
        console.error('Status check error:', error);
        await interaction.reply({
          content: `ステータスチェックに失敗しました: ${error instanceof Error ? error.message : 'Unknown error'}`,
          ephemeral: true
        });
      }
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('logout')
      .setDescription('認証をクリアします'),
    
    async execute(interaction: CommandInteraction, patchouliClient: PatchouliClient) {
      const userId = interaction.user.id;
      
      const hadSession = userSessions.has(userId);
      const hadPendingAuth = pendingAuth.has(userId);
      
      userSessions.delete(userId);
      pendingAuth.delete(userId);
      
      if (hadSession || hadPendingAuth) {
        await interaction.reply({
          content: '✅ ログアウトしました。',
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: 'ログインしていません。',
          ephemeral: true
        });
      }
    }
  }
];