import { Client } from '@neondatabase/serverless';

// ========== CONFIGURATION ========== //
const CONFIG = {
  DATABASE_URL: "postgresql://neondb_owner:npg_wkaTu52xezYC@ep-long-frost-aeryi5bb-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require",
  BOT_TOKEN: "8456273643:AAE1rKr1P-JEb_5Cg8EsPJfuUulpTjYztuo",
  WELCOME_IMAGE: "https://ar-hosting.pages.dev/1753585583429.jpg",
  CREATOR_LINK: "https://t.me/zerocreations",
  MAX_FILE_SIZE: 5 * 1024 * 1024 // 5MB
};

// ========== UTILITIES ========== //
async function sendTelegramMessage(chatId, text, parseMode = 'Markdown') {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: parseMode,
    disable_web_page_preview: true
  };

  return fetch(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

// ========== HANDLERS ========== //
async function handleStartCommand(chatId) {
  const welcomeMessage = `
✨ *Welcome to Premium Image Hosting Bot* ✨

📸 *Features:*
✓ Free image hosting
✓ Direct media links
✓ 24/7 availability

🔹 *How to use:* Just send me any image!

🛠 *Created by:* [Zero Creations](${CONFIG.CREATOR_LINK})
  `;

  try {
    // Send welcome photo with caption
    await fetch(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        photo: CONFIG.WELCOME_IMAGE,
        caption: welcomeMessage,
        parse_mode: 'Markdown'
      })
    });
  } catch (error) {
    console.error('Welcome message error:', error);
    await sendTelegramMessage(chatId, "🚀 Welcome! Send me images to host them!");
  }
}

async function handleImageUpload(chatId, fileId, client) {
  try {
    // Get file info from Telegram
    const fileInfo = await fetch(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/getFile?file_id=${fileId}`);
    const fileData = await fileInfo.json();
    
    // Download image
    const imageUrl = `https://api.telegram.org/file/bot${CONFIG.BOT_TOKEN}/${fileData.result.file_path}`;
    const imageResponse = await fetch(imageUrl);
    
    // Check file size
    const contentLength = imageResponse.headers.get('content-length');
    if (contentLength > CONFIG.MAX_FILE_SIZE) {
      await sendTelegramMessage(chatId, `❌ File too large (max ${CONFIG.MAX_FILE_SIZE/1024/1024}MB)`);
      return;
    }

    // Store in database
    const buffer = await imageResponse.arrayBuffer();
    const filename = fileData.result.file_path.split('/').pop();
    const contentType = imageResponse.headers.get('content-type');
    
    const result = await client.query(
      `INSERT INTO images(filename, content_type, data, user_id) 
       VALUES($1, $2, $3, $4) RETURNING id`,
      [filename, contentType, buffer, chatId]
    );

    // Send success message with link
    const imageLink = `https://${new URL(CONFIG.WELCOME_IMAGE).hostname}/image/${result.rows[0].id}`;
    await sendTelegramMessage(
      chatId,
      `✅ *Image hosted successfully!*\n\n🔗 [Direct Link](${imageLink})\n\nShare this link anywhere!`
    );

  } catch (error) {
    console.error('Image upload error:', error);
    await sendTelegramMessage(chatId, '❌ Error processing image. Please try again.');
  }
}

// ========== MAIN WORKER ========== //
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const client = new Client(CONFIG.DATABASE_URL);

    try {
      // Telegram Webhook
      if (url.pathname === '/telegram-webhook' && request.method === 'POST') {
        const update = await request.json();
        await client.connect();

        if (update.message?.text === '/start') {
          await handleStartCommand(update.message.chat.id);
        } 
        else if (update.message?.photo) {
          const photo = update.message.photo.pop(); // Get highest quality
          await handleImageUpload(update.message.chat.id, photo.file_id, client);
        }

        return new Response('OK');
      }

      // Image Retrieval
      if (url.pathname.startsWith('/image/') && request.method === 'GET') {
        await client.connect();
        const id = url.pathname.split('/')[2];
        const result = await client.query(
          'SELECT data, content_type FROM images WHERE id = $1',
          [id]
        );

        if (result.rows.length === 0) {
          return new Response('Image not found', { status: 404 });
        }

        return new Response(result.rows[0].data, {
          headers: { 
            'Content-Type': result.rows[0].content_type,
            'Cache-Control': 'public, max-age=31536000' // 1 year cache
          }
        });
      }

      return new Response('Not Found', { status: 404 });

    } catch (error) {
      console.error('Global error:', error);
      return new Response('Server Error', { status: 500 });
    } finally {
      await client.end();
    }
  }
};
