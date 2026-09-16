const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const yts = require('yt-search');

const BOT_NAME = "BROKEN MD";
const PREFIX = ".";

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const sock = makeWASocket({ auth: state, printQRInTerminal: true });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log(`[+] ${BOT_NAME} Connected Successfully!`);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const from = m.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        const text = m.message.conversation || m.message.extendedTextMessage?.text || '';
        if (!text.startsWith(PREFIX) && !text.includes('chat.whatsapp.com/')) return;

        const args = text.slice(PREFIX.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        let groupMetadata, groupAdminList, isBotAdmin, isAdmin;
        if (isGroup) {
            groupMetadata = await sock.groupMetadata(from);
            const participants = groupMetadata.participants;
            groupAdminList = participants.filter(p => p.admin !== null).map(p => p.id);
            const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
            
            isBotAdmin = groupAdminList.includes(botId);
            const sender = m.key.participant || m.participant;
            isAdmin = groupAdminList.includes(sender);
        }

        // Anti-Link
        if (isGroup && text.includes('chat.whatsapp.com/')) {
            if (!isAdmin) {
                await sock.sendMessage(from, { delete: m.key });
                if (isBotAdmin) {
                    await sock.sendMessage(from, { text: `⚠️ *[${BOT_NAME}]* Link sharing allowed nahi hai!` });
                }
            }
        }

        // TagAll
        if (command === 'tagall' && isGroup) {
            if (!isAdmin) return sock.sendMessage(from, { text: '❌ Sirf admins tagall kar sakte hain!' });
            const participants = groupMetadata.participants;
            let mentions = [];
            let textMsg = `⚙️ *${BOT_NAME} - TAG ALL* ⚙️\n\n📢 *Attention Everyone:*\n\n`;
            for (let mem of participants) {
                textMsg += `✨ @${mem.id.split('@')[0]}\n`;
                mentions.push(mem.id);
            }
            await sock.sendMessage(from, { text: textMsg, mentions });
        }

        // Promote
        if (command === 'promote' && isGroup) {
            if (!isAdmin) return sock.sendMessage(from, { text: '❌ Admins only!' });
            if (!isBotAdmin) return sock.sendMessage(from, { text: '❌ Bot ko admin banayein!' });
            const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (mentioned) {
                await sock.groupParticipantsUpdate(from, [mentioned], 'promote');
                await sock.sendMessage(from, { text: `✅ *${BOT_NAME}:* User Admin ban gaya!` });
            }
        }

        // Demote
        if (command === 'demote' && isGroup) {
            if (!isAdmin) return sock.sendMessage(from, { text: '❌ Admins only!' });
            if (!isBotAdmin) return sock.sendMessage(from, { text: '❌ Bot ko admin banayein!' });
            const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (mentioned) {
                await sock.groupParticipantsUpdate(from, [mentioned], 'demote');
                await sock.sendMessage(from, { text: `🔻 *${BOT_NAME}:* User demote ho gaya!` });
            }
        }

        // Play
        if (command === 'play') {
            const query = args.join(' ');
            if (!query) return sock.sendMessage(from, { text: 'Usage: `.play song_name`' });
            await sock.sendMessage(from, { text: `🔍 *${BOT_NAME}* searching...` });
            const search = await yts(query);
            const video = search.videos[0];
            if (video) {
                await sock.sendMessage(from, {
                    image: { url: video.thumbnail },
                    caption: `🎵 *Title:* ${video.title}\n⏱️ *Duration:* ${video.timestamp}\n🔗 *Link:* ${video.url}`
                });
            } else {
                await sock.sendMessage(from, { text: '❌ Song nahi mila!' });
            }
        }
    });
}

startBot();
  
