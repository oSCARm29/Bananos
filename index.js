const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder } = require('discord.js');
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
// CONFIG
// ============================================================
const VOICE_ALERT_CHANNEL_ID = '1074481398594940998';
const VOICE_ALERT_ROLE_ID = '1311712873072037919';
const VOICE_ALERT_TEXT_CHANNEL_ID = '1478033994225291358';

const STAFF_CHAT_ID = '1478033994225291358';   // canal de staff chat
const STAFF_ROLE_ID = '1311712873072037919';    // rol de staff

const TICKET_REMINDER_MS = 2 * 60 * 1000; // 2 minutos

// Palabras clave para detectar categoría del ticket
const TICKET_KEYWORDS = {
  'donacion': 'Donación 💸',
  'donación': 'Donación 💸',
  'donar': 'Donación 💸',
  'comprar': 'Donación 💸',
  'vip': 'Donación 💸',
  'vipcoin': 'Donación 💸',
  'propiedad': 'Donación 💸',
  'vehiculo': 'Donación 💸',
  'vehículo': 'Donación 💸',
  'ganga': 'Ganga 🔫',
  'banda': 'Ganga 🔫',
  'clan': 'Ganga 🔫',
  'bug': 'Bug/Error 🐛',
  'error': 'Bug/Error 🐛',
  'glitch': 'Bug/Error 🐛',
  'ban': 'Apelación de Ban 🔨',
  'baneado': 'Apelación de Ban 🔨',
  'apelacion': 'Apelación de Ban 🔨',
  'apelación': 'Apelación de Ban 🔨',
  'reporte': 'Reporte 📋',
  'reportar': 'Reporte 📋',
  'staff': 'Reporte 📋',
  'streamer': 'Rol Streamer 🎥',
  'stream': 'Rol Streamer 🎥',
  'soporte': 'Soporte General',
  'ayuda': 'Soporte General',
  'help': 'Soporte General',
  'realtor': 'Realtor',
  'casa': 'Realtor',
  'diseño': 'Diseño',
  'design': 'Diseño',
  'programacion': 'Programación',
  'programación': 'Programación',
  'script': 'Programación',
};

// Canales donde hay tickets (nombres que contengan "ticket")
// Rastreamos tickets activos: channelId -> { userId, username, firstMessage, category, reminded, staffNotified, staffMsgId }
const activeTickets = new Map();

// ============================================================
// FUNCIÓN: detectar categoría del ticket
// ============================================================
function detectTicketCategory(text) {
  const lower = text.toLowerCase();
  for (const [keyword, category] of Object.entries(TICKET_KEYWORDS)) {
    if (lower.includes(keyword)) return category;
  }
  return 'Soporte General';
}

// ============================================================
// FUNCIÓN: notificar al staff sobre un ticket
// ============================================================
async function notifyStaff(guild, ticketChannel, userId, username, firstMessage, category, isReminder = false) {
  try {
    const staffChannel = await client.channels.fetch(STAFF_CHAT_ID).catch(() => null);
    if (!staffChannel) return null;

    const ticketLink = `https://discord.com/channels/${guild.id}/${ticketChannel.id}`;

    const embed = new EmbedBuilder()
      .setColor(isReminder ? 0xFF4444 : 0xFFD700)
      .setTitle(isReminder ? '⚠️ Ticket sin atender — Recordatorio' : '🎫 Nuevo Ticket Abierto')
      .addFields(
        { name: '👤 Usuario', value: `<@${userId}> (${username})`, inline: true },
        { name: '📂 Categoría', value: category, inline: true },
        { name: '💬 Mensaje', value: firstMessage.length > 200 ? firstMessage.slice(0, 200) + '...' : firstMessage },
        { name: '🔗 Ir al ticket', value: `[Click aquí](${ticketLink})` }
      )
      .setTimestamp()
      .setFooter({ text: isReminder ? 'Han pasado 2 minutos sin respuesta' : 'Bananon Bot 🍌' });

    const msg = await staffChannel.send({
      content: isReminder
        ? `<@&${STAFF_ROLE_ID}> ⚠️ Este ticket lleva **2 minutos sin atender**, ¿alguien puede ayudar?`
        : `<@&${STAFF_ROLE_ID}> hay un nuevo ticket que necesita atención 🍌`,
      embeds: [embed]
    });

    return msg.id;
  } catch (err) {
    console.error('Error notificando staff:', err.message);
    return null;
  }
}

// ============================================================
// FUNCIÓN: verificar si un canal es un ticket
// ============================================================
function normalizeUnicode(str) {
  // Convierte letras unicode matematicas (bold, italic, etc.) a ASCII normal
  let result = '';
  for (const c of str) {
    const code = c.codePointAt(0);
    // Rango de letras matematicas unicode bold/italic
    if (code >= 0x1D400 && code <= 0x1D7FF) {
      const offset = code - 0x1D400;
      const bases = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      const idx = offset % 52;
      result += bases[idx] || '';
    } else if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === ' ') {
      result += c;
    }
  }
  return result.toLowerCase().trim();
}

function isTicketChannel(channel) {
  // Detectar por categoría padre del canal (Ticket Tool usa emojis y letras unicode bold)
  const parentName = normalizeUnicode(channel.parent?.name || '');
  if (parentName.includes('ticket')) return true;
  // Fallback: nombre del canal
  const name = (channel.name || '').toLowerCase();
  return name.includes('ticket') || name.startsWith('🎫');
}

// ============================================================
// EVENTO: alguien entra a una sala de voz
// ============================================================
client.on('voiceStateUpdate', async (oldState, newState) => {
  const enteredChannel = newState.channelId && newState.channelId !== oldState.channelId;
  if (!enteredChannel) return;
  if (newState.channelId !== VOICE_ALERT_CHANNEL_ID) return;

  const member = newState.member;
  const guild = newState.guild;
  const channelName = newState.channel?.name || 'sala de voz';

  console.log(`🎙️ ${member.user.username} entró a ${channelName}`);

  try {
    let textChannel = await client.channels.fetch(VOICE_ALERT_TEXT_CHANNEL_ID).catch(() => null);

    if (!textChannel) {
      textChannel = guild.channels.cache.find(
        c => c.type === 0 && c.permissionsFor(guild.members.me)?.has('SendMessages')
      );
    }

    if (!textChannel) return;

    await textChannel.send(
      `🎙️ <@&${VOICE_ALERT_ROLE_ID}> **${member.user.username}** se conectó a **${channelName}**`
    );
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
  const inTicket = !isDM && isTicketChannel(message.channel);
  
  // DEBUG
  if (!isDM) {
    const parentName = message.channel.parent?.name || 'sin categoria';
    console.log(`📌 Canal: ${message.channel.name} | Categoría: ${parentName} | isTicket: ${inTicket}`);
  }

  // ---- LÓGICA DE TICKETS ----
  if (inTicket) {
    const channelId = message.channel.id;

    if (!activeTickets.has(channelId)) {
      // Primer mensaje en este ticket — registrar y notificar staff
      // Usar nombre de la categoría del canal directamente
      const rawCategoryName = message.channel.parent?.name || '';
      const category = normalizeUnicode(rawCategoryName) || detectTicketCategory(message.content);

      activeTickets.set(channelId, {
        userId: message.author.id,
        username: message.author.username,
        firstMessage: message.content,
        category,
        reminded: false,
        staffNotified: true,
      });

      // Responder al usuario
      await message.channel.send(
        `Hola <@${message.author.id}> 👋🍌\n\nTu ticket ha sido recibido en la categoría **${category}**.\nUn miembro del staff te va a atender en breve.\n\nMientras tanto, explica tu situación con el mayor detalle posible.`
      );

      // Notificar al staff
      await notifyStaff(
        message.guild,
        message.channel,
        message.author.id,
        message.author.username,
        message.content,
        category,
        false
      );

      // Recordatorio a los 2 minutos si nadie del staff ha respondido
      setTimeout(async () => {
        const ticket = activeTickets.get(channelId);
        if (!ticket || ticket.reminded) return;

        // Verificar si algún staff respondió (buscamos mensajes recientes de no-bot y no el usuario original)
        try {
          const recent = await message.channel.messages.fetch({ limit: 10 });
          const staffReplied = recent.some(m =>
            !m.author.bot &&
            m.author.id !== ticket.userId &&
            m.createdTimestamp > Date.now() - TICKET_REMINDER_MS - 5000
          );

          if (!staffReplied) {
            ticket.reminded = true;
            activeTickets.set(channelId, ticket);

            await notifyStaff(
              message.guild,
              message.channel,
              ticket.userId,
              ticket.username,
              ticket.firstMessage,
              ticket.category,
              true // es recordatorio
            );
          }
        } catch (err) {
          console.error('Error en recordatorio de ticket:', err.message);
        }
      }, TICKET_REMINDER_MS);

    } else {
      // Mensajes subsiguientes — si un staff responde, marcar ticket como atendido
      const ticket = activeTickets.get(channelId);
      if (ticket && message.author.id !== ticket.userId) {
        // Un staff u otra persona respondió — limpiar el ticket
        activeTickets.delete(channelId);
        console.log(`✅ Ticket ${channelId} atendido por ${message.author.username}`);
      }
    }

    // En tickets siempre responde con IA (no necesita mención)
    // Solo saltar si no hay contenido útil
  }

  // ---- LÓGICA NORMAL DEL BOT ----
  // Fuera de tickets, solo responde si lo mencionan o dicen "bananon"
  if (!inTicket && !isMentioned && !isDM && !containsBananon) return;

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
          in_ticket: inTicket,
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
