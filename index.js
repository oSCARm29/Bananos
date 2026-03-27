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

const channelCache = {};

client.once('ready', async () => {
  console.log('Bot conectado como ' + client.user.tag);
  console.log('Servidores: ' + client.guilds.cache.size);
});

async function executeActions(actions, message) {
  if (!actions || !Array.isArray(actions)) return;
  for (const action of actions) {
    try {
      if (action.type === 'dm_role') {
        await message.guild.members.fetch();
        const role = message.guild.roles.cache.get(action.role_id);
        if (!role) { await message.channel.send('No encontre el rol ' + action.role_id); continue; }
        let sent = 0, failed = 0;
        await message.channel.send('Enviando DM a ' + role.members.size + ' miembros del rol ' + role.name + '...');
        for (const [, member] of role.members) {
          if (member.user.bot) continue;
          try { await member.send(action.message); sent++; } catch { failed++; }
          await new Promise(r => setTimeout(r, 500));
        }
        await message.channel.send('DMs enviados: ' + sent + ' | Fallidos: ' + failed);
      } else if (action.type === 'dm_user') {
        const u = await client.users.fetch(action.user_id);
        await u.send(action.message);
        await message.channel.send('DM enviado a ' + u.username);
      } else if (action.type === 'send_channel') {
        const ch = client.channels.cache.get(action.channel_id);
        if (!ch) { await message.channel.send('No encontre el canal ' + action.channel_id); continue; }
        await ch.send(action.message);
        await message.channel.send('Mensaje enviado al canal');
      } else if (action.type === 'send_here') {
        await message.channel.send(action.message);
      } else if (action.type === 'mention_role') {
        await message.channel.send('<@&' + action.role_id + '> ' + action.message);
      } else if (action.type === 'list_role_members') {
        await message.guild.members.fetch();
        const role = message.guild.roles.cache.get(action.role_id);
        if (!role) { await message.channel.send('No encontre el rol'); continue; }
        const members = role.members.map(m => m.user.username).join(', ');
        await message.channel.send('**' + role.name + '** (' + role.members.size + '):\n' + (members || 'Nadie'));
      } else if (action.type === 'user_info') {
        const member = await message.guild.members.fetch(action.user_id);
        const roles = member.roles.cache.map(r => r.name).filter(r => r !== '@everyone').join(', ');
        await message.channel.send('Usuario: ' + member.user.username + '\nID: ' + member.user.id + '\nUnido: ' + member.joinedAt?.toDateString() + '\nRoles: ' + (roles || 'Ninguno'));
      }
    } catch (e) {
      console.error('Error en accion ' + action.type + ': ' + e.message);
      await message.channel.send('Error ejecutando accion: ' + e.message);
    }
  }
}

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const channelId = message.channel.id;
  if (!channelCache[channelId]) channelCache[channelId] = [];
  channelCache[channelId].push({ user: message.author.username, user_id: message.author.id, content: message.content, timestamp: new Date().toISOString() });
  if (channelCache[channelId].length > 100) channelCache[channelId].shift();

  axios.post(BASE44_SAVE_ENDPOINT, {
    discord_user_id: message.author.id,
    discord_username: message.author.username,
    channel_id: channelId,
    channel_name: message.channel.name || 'DM',
    guild_name: message.guild?.name || 'DM',
    message: message.content,
    is_owner: message.author.id === OWNER_ID,
  }).catch(e => console.error('Error guardando:', e.message));

  const isMentioned = message.mentions.has(client.user);
  const isDM = message.channel.type === 1;
  const containsBananon = message.content.toLowerCase().includes('bananon');
  const isOwner = message.author.id === OWNER_ID;

  if (!isMentioned && !isDM && !containsBananon) return;

  let content = message.content.replace(/<@!?\d+>/g, '').trim();
  if (!content) content = '(sin texto)';

  if (!isOwner) {
    const blocked = ['dm rol', 'enviar canal', 'banea', 'kickea', 'ban', 'kick', 'purge'];
    if (blocked.some(k => content.toLowerCase().includes(k))) {
      await message.reply('Solo el dueno del servidor puede darme ese tipo de ordenes. 🍌');
      return;
    }
  }

  try {
    await message.channel.sendTyping();
    const response = await axios.post(BASE44_ENDPOINT, {
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
    }, { headers: { 'Content-Type': 'application/json' }, timeout: 30000 });

    const data = response.data;
    const reply = data?.reply || '';
    const actions = data?.actions || null;

    if (actions && actions.length > 0) {
      await executeActions(actions, message);
    }

    if (reply && reply.trim()) {
      if (reply.length > 2000) {
        const chunks = reply.match(/.{1,2000}/gs);
        for (const chunk of chunks) await message.reply(chunk);
      } else {
        await message.reply(reply);
      }
    }
  } catch (error) {
    console.error('Error:', error.message);
    await message.reply('Hubo un error. Intenta de nuevo. 🍌');
  }
});

client.login(DISCORD_BOT_TOKEN);
