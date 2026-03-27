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
const BASE44_CHAT_ENDPOINT = 'https://bananon-1cde8720.base44.app/functions/discordChat';
const OWNER_ID = '479099285707816962';

const channelHistory = {};

client.once('ready', () => {
  console.log(`✅ Bot conectado como ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const isMentioned = message.mentions.has(client.user);
  const isDM = message.channel.type === 1;
  const containsBananon = message.content.toLowerCase().includes('bananon');
  const isOwner = message.author.id === OWNER_ID;

  // Guardar contexto del canal en memoria
  const channelId = message.channel.id;
  if (!channelHistory[channelId]) channelHistory[channelId] = [];
  channelHistory[channelId].push({
    user: message.author.username,
    content: message.content,
    timestamp: new Date().toISOString(),
  });
  if (channelHistory[channelId].length > 50) channelHistory[channelId].shift();

  if (!isMentioned && !isDM && !containsBananon) return;

  // Bloquear comandos destructivos si no es owner
  let content = message.content.replace(/<@!?\d+>/g, '').trim();
  if (!content) content = '(sin texto)';

  if (!isOwner) {
    const blockedKeywords = ['banea', 'kickea', 'elimina', 'borra', 'silencia', 'ban', 'kick', 'delete', 'purge'];
    const isBlocked = blockedKeywords.some(k => content.toLowerCase().includes(k));
    if (isBlocked) {
      await message.reply('Solo el dueño del servidor puede darme ese tipo de órdenes. 🍌');
      return;
    }
  }

  console.log(`📨 Mensaje de ${message.author.username} (owner: ${isOwner}): ${content}`);

  try {
    await message.channel.sendTyping();

    // Guardar mensaje y obtener historial de la base de datos
    let conversationHistory = '';
    try {
      const chatRes = await axios.post(BASE44_CHAT_ENDPOINT, {
        discord_user_id: message.author.id,
        discord_username: message.author.username,
        channel_id: channelId,
        channel_name: message.channel.name || 'DM',
        guild_name: message.guild?.name || 'DM',
        message: content,
        is_owner: isOwner,
      }, { timeout: 10000 });
      conversationHistory = chatRes.data?.history || '';
    } catch (e) {
      console.error('Error guardando historial:', e.message);
    }

    // Enviar a Bananon con historial completo
    const response = await axios.post(
      BASE44_ENDPOINT,
      {
        message: content,
        context: {
          discord_user: message.author.username,
          discord_user_id: message.author.id,
          is_owner: isOwner,
          channel: message.channel.name || 'DM',
          guild: message.guild?.name || 'DM',
          recent_channel_messages: channelHistory[channelId].slice(-20),
          conversation_history: conversationHistory,
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
