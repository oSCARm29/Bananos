const { Client, GatewayIntentBits, Partials } = require('discord.js');
const axios = require('axios');
const http = require('http');

http.createServer((req, res) => res.end('Bananon bot activo 🍌')).listen(process.env.PORT || 3000);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const BASE44_ENDPOINT = process.env.BASE44_ENDPOINT;

const channelHistory = {};

client.once('ready', () => {
  console.log(`✅ Bot conectado como ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const isMentioned = message.mentions.has(client.user);
  const isDM = message.channel.type === 1;
  const containsBananon = message.content.toLowerCase().includes('bananon');

  const channelId = message.channel.id;
  if (!channelHistory[channelId]) channelHistory[channelId] = [];
  
  channelHistory[channelId].push({
    user: message.author.username,
    content: message.content,
    timestamp: new Date().toISOString(),
  });

  if (channelHistory[channelId].length > 50) {
    channelHistory[channelId].shift();
  }

  if (!isMentioned && !isDM && !containsBananon) return;

  let content = message.content.replace(/<@!?\d+>/g, '').trim();
  if (!content) content = '(sin texto)';

  console.log(`📨 Mensaje de ${message.author.username}: ${content}`);

  try {
    await message.channel.sendTyping();

    const response = await axios.post(
      BASE44_ENDPOINT,
      {
        message: content,
        context: {
          discord_user: message.author.username,
          discord_user_id: message.author.id,
          channel: message.channel.name || 'DM',
          guild: message.guild?.name || 'DM',
          recent_messages: channelHistory[channelId].slice(-20),
        },
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      }
    );

    const reply = response.data?.reply || 'No pude procesar tu mensaje.';

    if (reply.length > 2000) {
      const chunks = reply.match(/.{1,2000}/gs);
      for (const chunk of chunks) {
        await message.reply(chunk);
      }
    } else {
      await message.reply(reply);
    }
  } catch (error) {
    console.error('Error al contactar a Bananon:', error.message);
    await message.reply('Hubo un error procesando tu mensaje. Intenta de nuevo. 🍌');
  }
});

client.login(DISCORD_BOT_TOKEN);
