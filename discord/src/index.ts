import 'dotenv/config';
import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import { PatchouliClient } from './client.js';
import { commands, handleAuthCompletion } from './commands.js';
import express from 'express';

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

if (!TOKEN) {
  console.error('DISCORD_BOT_TOKEN environment variable is required');
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error('DISCORD_CLIENT_ID environment variable is required');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const patchouliClient = new PatchouliClient();

client.once('ready', async () => {
  console.log(`Discord bot logged in as ${client.user?.tag}!`);
  
  // Patchouliサーバーの接続確認
  const isHealthy = await patchouliClient.healthCheck();
  if (isHealthy) {
    console.log('✅ Patchouli core server is accessible');
  } else {
    console.warn('⚠️  Patchouli core server is not accessible at http://localhost:8080');
  }
  
  // スラッシュコマンドを登録
  await registerCommands();
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.find(cmd => cmd.data.name === interaction.commandName);
  
  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    return;
  }

  try {
    await command.execute(interaction, patchouliClient);
  } catch (error) {
    console.error('Error executing command:', error);
    
    const errorMessage = 'コマンドの実行中にエラーが発生しました。';
    
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
});

async function registerCommands() {
  const rest = new REST().setToken(TOKEN!);
  
  try {
    console.log('Started refreshing application (/) commands.');

    const commandData = commands.map(command => command.data.toJSON());
    
    await rest.put(
      Routes.applicationCommands(CLIENT_ID!),
      { body: commandData },
    );

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
}

// グレースフルシャットダウン
process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  client.destroy();
  process.exit(0);
});

// Express サーバーを起動して認証完了通知を受け取る
const app = express();
app.use(express.json());

app.post('/auth-complete', async (req, res) => {
  try {
    const { auth_token, user_email } = req.body;
    
    if (!auth_token || !user_email) {
      return res.status(400).json({ error: 'Missing auth_token or user_email' });
    }

    console.log(`Received auth completion notification: ${user_email} (token: ${auth_token})`);
    await handleAuthCompletion(auth_token, user_email, client);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error handling auth completion:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const DISCORD_BOT_PORT = process.env.DISCORD_BOT_PORT || 3001;
app.listen(DISCORD_BOT_PORT, () => {
  console.log(`Discord bot notification server running on port ${DISCORD_BOT_PORT}`);
});

client.login(TOKEN);