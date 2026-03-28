const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const axios = require('axios');
const http = require('http');

// Servidor HTTP para que Railway no mate el proceso
http.createServer((req, res) => res.end('Bananon bot activo 🍌')).listen(process.env.PORT || 3000);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const BASE44_ENDPOINT = process.env.BASE44_ENDPOINT;

// ============================================================
// CONFIG - Sala de voz y rol a alertar
// ============================================================
const VOICE_ALERT_CHANNEL_ID = '1074481398594940998';   // sala de voz a monitorear
const VOICE_ALERT_ROLE_ID = '1311712873072037919';       // rol a mencionar cuando alguien entre
const VOICE_ALERT_TEXT_CHANNEL_ID = '1478033994225291358'; // canal de staff donde llega el ping
// ============================================================

client.once('ready', () => {
  console.log(`✅ Bot conectado como ${client.user.tag}`);
});

// ============================================================
// EVENTO: alguien entra a una sala de voz
// ============================================================
client.on('voiceStateUpdate', async (oldState, newState) => {
  // Solo cuando alguien ENTRA (antes no estaba en ese canal, ahora sí)
  const enteredChannel = newState.channelId && newState.channelId !== oldState.channelId;
  if (!enteredChannel) return;

  // Solo el canal específico que monitoreamos
  if (newState.channelId !== VOICE_ALERT_CHANNEL_ID) return;

  const member = newState.member;
  const guild = newState.guild;
  const channelName = newState.channel?.name || 'sala de voz';

  console.log(`🎙️ ${member.user.username} entró a ${channelName}`);

  try {
    let textChannel = await client.channels.fetch(VOICE_ALERT_TEXT_CHANNEL_ID).catch(() => null);

    // Fallback: primer canal donde el bot pueda escribir
    if (!textChannel) {
      textChannel = guild.channels.cache.find(
        c => c.type === 0 && c.permissionsFor(guild.members.me)?.has('SendMessages')
      );
    }

    if (!textChannel) {
      console.error('❌ No se encontró canal de texto para enviar el ping');
      return;
    }

    await textChannel.send(
      `🎙️ <@&${VOICE_ALERT_ROLE_ID}> **${member.user.username}** se conectó a **${channelName}**`
    );

    console.log(`✅ Ping enviado al canal de staff`);
  } catch (error) {
    console.error('Error enviando ping de voz:', error.message);
  }
});

// ============================================================
// Función para parsear comandos especiales en replies del agente
// ============================================================
async function processSpecialCommands(reply, message) {
  let finalReply = reply;
  let extraMessages = [];

  const pingRoleMatch = reply.match(/\[PING_ROLE:(\d+):([^\]]+)\]/);
  if (pingRoleMatch) {
    const roleId = pingRoleMatch[1];
    const msg = pingRoleMatch[2];
    finalReply = finalReply.replace(pingRoleMatch[0], '').trim();
    extraMessages.push({ type: 'ping_role', roleId, msg });
  }

  const pingRoleChannelMatch = reply.match(/\[PING_ROLE_IN_CHANNEL:(\d+):(\d+):([^\]]+)\]/);
  if (pingRoleChannelMatch) {
    const channelId = pingRoleChannelMatch[1];
    const roleId = pingRoleChannelMatch[2];
    const msg = pingRoleChannelMatch[3];
    finalReply = finalReply.replace(pingRoleChannelMatch[0], '').trim();
    extraMessages.push({ type: 'ping_role_in_channel', channelId, roleId, msg });
  }

  return { finalReply, extraMessages };
}

// ============================================================
// EVENTO: mensajes de texto
// ============================================================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const isMentioned = message.mentions.has(client.user);
  const isDM = message.channel.type === 1;
  const containsBananon = message.content.toLowerCase().includes('bananon');

  if (!isMentioned && !isDM && !containsBananon) return;

  let content = message.content.replace(/<@!?\d+>/g, '').trim();
  if (!content) return;

  const mentionedRoles = [...message.mentions.roles.values()].map(r => ({ id: r.id, name: r.name }));
  const mentionedChannels = [...message.mentions.channels.values()].map(c => ({ id: c.id, name: c.name }));

  const currentChannel = message.channel;
  const currentChannelId = currentChannel?.id || 'DM';
  const currentChannelName = currentChannel?.name || 'DM';

  let recentMessages = [];
  try {
    if (!isDM) {
      const fetched = await message.channel.messages.fetch({ limit: 10 });
      recentMessages = fetched
        .filter(m => m.id !== message.id)
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .map(m => ({ user: m.author.username, content: m.content }))
        .slice(-5);
    }
  } catch (e) {}

  const OWNER_ID = '479099285707816962';
  const isOwner = message.author.id === OWNER_ID;

  console.log(`📨 Mensaje de ${message.author.username}: ${content}`);

  try {
    message.channel.sendTyping();

    const response = await axios.post(
      BASE44_ENDPOINT,
      {
        message: content,
        context: {
          discord_user: message.author.username,
          discord_user_id: message.author.id,
          channel: currentChannelName,
          channel_id: currentChannelId,
          guild: message.guild?.name || 'DM',
          guild_id: message.guild?.id || null,
          is_owner: isOwner,
          mentioned_roles: mentionedRoles,
          mentioned_channels: mentionedChannels,
          recent_channel_messages: recentMessages,
        },
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
    );

    let reply = response.data?.reply || 'No pude procesar tu mensaje.';
    const { finalReply, extraMessages } = await processSpecialCommands(reply, message);

    if (finalReply && finalReply.length > 0) {
      if (finalReply.length > 2000) {
        const chunks = finalReply.match(/.{1,2000}/gs);
        for (const chunk of chunks) await message.reply(chunk);
      } else {
        await message.reply(finalReply);
      }
    }

    for (const extra of extraMessages) {
      if (extra.type === 'ping_role') {
        await message.channel.send(`<@&${extra.roleId}> ${extra.msg}`);
      } else if (extra.type === 'ping_role_in_channel') {
        const targetChannel = await client.channels.fetch(extra.channelId).catch(() => null);
        if (targetChannel) await targetChannel.send(`<@&${extra.roleId}> ${extra.msg}`);
      }
    }
  } catch (error) {
    console.error('Error al contactar a Bananon:', error.message);
    await message.reply('Hubo un error procesando tu mensaje. Intenta de nuevo. 🍌');
  }
});

client.login(DISCORD_BOT_TOKEN);
