const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, delay } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');
const yts = require('yt-search');

const app = express();
const PORT = process.env.PORT || 8080;

const BOT_NAME = "BROKEN MD";
const PREFIX = ".";

let sock;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

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
        try {
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
        } catch (e) {
            console.log(e);
        }
    });
}

// Pairing Code Web Server
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>${BOT_NAME} Pairing</title>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                    body { font-family: Arial; background: #121212; color: white; text-align: center; padding: 50px 20px; }
                    input, button { padding: 12px; font-size: 16px; margin: 10px; border-radius: 8px; border: none; }
                    input { width: 80%; max-width: 300px; }
                    button { background: #25D366; color: white; cursor: pointer; font-weight: bold; }
                </style>
            </head>
            <body>
                <h2>🤖 ${BOT_NAME} Pairing Code</h2>
                <form action="/pair" method="POST">
                    <input type="text" name="number" placeholder="Country code ke sath (e.g. 923001234567)" required /><br>
                    <button type="submit">Get Pairing Code</button>
                </form>
            </body>
        </html>
    `);
});

app.post('/pair', async (req, res) => {
    let num = req.body.number.replace(/[^0-9]/g, '');
    if (!num) return res.send('Invalid Number!');
    
    if (!sock || !sock.authState) return res.send('Bot initialize ho raha hai, 10 second baad refresh karke try karein!');

    if (!sock.authState.creds.registered) {
        await delay(1500);
        let code = await sock.requestPairingCode(num);
        code = code?.match(/.{1,4}/g)?.join("-") || code;
        res.send(`
            <html>
                <body style="background: #121212; color: white; text-align: center; font-family: Arial; padding-top: 50px;">
                    <h2>Your Pairing Code:</h2>
                    <h1 style="color: #25D366; letter-spacing: 5px;">${code}</h1>
                    <p>WhatsApp > Linked Devices > Link with Phone Number par jaakar yeh code daalein.</p>
                    <a href="/" style="color: white;">Back</a>
                </body>
            </html>
        `);
    } else {
        res.send('Bot already paired!');
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    startBot();
});
                
