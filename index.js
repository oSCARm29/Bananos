const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');

// Servidor HTTP para que Koyeb no mate el proceso
http.createServer((req, res) => res.end('Bananon bot activo 🍌')).listen(process.env.PORT || 3000);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const BASE44_APP_ID = '69acab7d598308711cde8720';
const BASE44_SERVICE_TOKEN = process.env.BASE44_SERVICE_TOKEN;

client.once('ready', () => {
  console.log(`✅ Bananon conectado como ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const isMentioned = message.mentions.has(client.user);
  const isDM = message.channel.type === 1;

  if (!isMentioned && !isDM) return;

  const content = message.content.replace(/<@!?\d+>/g, '').trim();
  if (!content) return;

  console.log(`📨 ${message.author.username}: ${content}`);
  message.channel.sendTyping();

  try {
    const response = await axios.post(
      `https://api.base44.com/api/apps/${BASE44_APP_ID}/agent/message`,
      {
        message: content,
        context: {
          discord_user: message.author.username,
          channel: message.channel.name || 'DM',
          guild: message.guild?.name || 'DM',
        },
      },
      {
        headers: {
          Authorization: `Bearer ${BASE44_SERVICE_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    const reply = response.data?.message || response.data?.response || 'No pude procesar tu mensaje.';

    if (reply.length > 2000) {
      const chunks = reply.match(/.{1,2000}/gs);
      for (const chunk of chunks) await message.reply(chunk);
    } else {
      await message.reply(reply);
    }
  } catch (error) {
    console.error('Error:', error.message);
    await message.reply('Hubo un error. Intenta de nuevo. 🍌');
  }
});

client.login(DISCORD_BOT_TOKEN);
