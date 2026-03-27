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
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel, Partials.Message],
});

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const BASE44_ENDPOINT = process.env.BASE44_ENDPOINT;
const BASE44_SAVE_ENDPOINT = 'https://bananon-1cde8720.base44.app/functions/discordChat';
const OWNER_ID = '479099285707816962';

// Cache de mensajes por canal (en memoria para acceso rápido)
const channelCache = {};

client.once('ready', async () => {
  console.log(`✅ Bot conectado como ${client.user.tag}`);
  console.log(`📡 Servidores conectados: ${client.guilds.cache.size}`);
});

// ============ GUARDAR TODOS LOS MENSAJES ============
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const channelId = message.channel.id;
  if (!channelCache[channelId]) channelCache[channelId] = [];

  const msgObj = {
    user: message.author.username,
    user_id: message.author.id,
    content: message.content,
    timestamp: new Date().toISOString(),
  };

  channelCache[channelId].push(msgObj);
  if (channelCache[channelId].length > 100) channelCache[channelId].shift();

  // Guardar en base de datos de forma asíncrona (sin esperar)
  axios.post(BASE44_SAVE_ENDPOINT, {
    discord_user_id: message.author.id,
    discord_username: message.author.username,
    channel_id: channelId,
    channel_name: message.channel.name || 'DM',
    guild_name: message.guild?.name || 'DM',
    message: message.content,
    is_owner: message.author.id === OWNER_ID,
  }).catch(e => console.error('Error guardando mensaje:', e.message));

  const isMentioned = message.mentions.has(client.user);
  const isDM = message.channel.type === 1;
  const containsBananon = message.content.toLowerCase().includes('bananon');
  const isOwner = message.author.id === OWNER_ID;

  if (!isMentioned && !isDM && !containsBananon) return;

  let content = message.content.replace(/<@!?\d+>/g, '').trim();
  if (!content) content = '(sin texto)';

  // ============ COMANDOS ESPECIALES (SOLO OWNER) ============
  if (isOwner) {

    // Comando: dm rol [roleId] [mensaje]
    if (content.toLowerCase().startsWith('dm rol ')) {
      const parts = content.slice(7).split(' ');
      const roleId = parts[0];
      const dmMessage = parts.slice(1).join(' ');

      if (!roleId || !dmMessage) {
        await message.reply('Uso correcto: `dm rol [roleId] [mensaje]`');
        return;
      }

      try {
        await message.guild.members.fetch();
        const role = message.guild.roles.cache.get(roleId);
        if (!role) {
          await message.reply(`No encontré el rol con ID ${roleId}`);
          return;
        }

        const members = role.members;
        let sent = 0, failed = 0;

        await message.reply(`📨 Enviando DM a ${members.size} miembros con el rol **${role.name}**...`);

        for (const [, member] of members) {
          if (member.user.bot) continue;
          try {
            await member.send(dmMessage);
            sent++;
          } catch {
            failed++;
          }
          await new Promise(r => setTimeout(r, 500));
        }

        await message.reply(`✅ DMs enviados: ${sent} | ❌ Fallidos: ${failed}`);
        return;
      } catch (e) {
        await message.reply(`Error: ${e.message}`);
        return;
      }
    }

    // Comando: enviar canal [channelId] [mensaje]
    if (content.toLowerCase().startsWith('enviar canal ')) {
      const parts = content.slice(13).split(' ');
      const targetChannelId = parts[0];
      const msg = parts.slice(1).join(' ');

      try {
        const targetChannel = client.channels.cache.get(targetChannelId);
        if (!targetChannel) {
          await message.reply(`No encontré el canal con ID ${targetChannelId}`);
          return;
        }
        await targetChannel.send(msg);
        await message.reply(`✅ Mensaje enviado a <#${targetChannelId}>`);
        return;
      } catch (e) {
        await message.reply(`Error: ${e.message}`);
        return;
      }
    }

    // Comando: info usuario [userId]
    if (content.toLowerCase().startsWith('info usuario ')) {
      const userId = content.slice(13).trim();
      try {
        const member = await message.guild.members.fetch(userId);
        const roles = member.roles.cache.map(r => r.name).filter(r => r !== '@everyone').join(', ');
        const info = `👤 **${member.user.username}**\n🆔 ID: ${member.user.id}\n📅 Unido: ${member.joinedAt?.toDateString()}\n🎭 Roles: ${roles || 'Ninguno'}`;
        await message.reply(info);
        return;
      } catch (e) {
        await message.reply(`No encontré el usuario: ${e.message}`);
        return;
      }
    }

    // Comando: listar rol [roleId]
    if (content.toLowerCase().startsWith('listar rol ')) {
      const roleId = content.slice(11).trim();
      try {
        await message.guild.members.fetch();
        const role = message.guild.roles.cache.get(roleId);
        if (!role) {
          await message.reply(`No encontré el rol con ID ${roleId}`);
          return;
        }
        const members = role.members.map(m => m.user.username).join(', ');
        await message.reply(`👥 **${role.name}** (${role.members.size} miembros):\n${members || 'Nadie'}`);
        return;
      } catch (e) {
        await message.reply(`Error: ${e.message}`);
        return;
      }
    }

  } else {
    // Bloquear comandos destructivos para no-owners
    const blockedKeywords = ['banea', 'kickea', 'elimina', 'borra', 'silencia', 'ban', 'kick', 'delete', 'purge', 'dm rol', 'enviar canal'];
    const isBlocked = blockedKeywords.some(k => content.toLowerCase().includes(k));
    if (isBlocked) {
      await message.reply('Solo el dueño del servidor puede darme ese tipo de órdenes. 🍌');
      return;
    }
  }

  // ============ RESPUESTA NORMAL CON CEREBRO ============
  console.log(`📨 Mensaje de ${message.author.username} (owner: ${isOwner}): ${content}`);

  try {
    await message.channel.sendTyping();

    const response = await axios.post(
      BASE44_ENDPOINT,
      {
        message: content,
        context: {
          discord_user: message.author.username,
          discord_user_id: message.author.id,
          is_owner: isOwner,
          channel: message.channel.name || 'DM',
          channel_id: channelId,
          guild: message.guild?.name || 'DM',
          recent_channel_messages: channelCache[channelId]?.slice(-30) || [],
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
