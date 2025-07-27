import { Client } from '@neondatabase/serverless';

const CONFIG = {
  DATABASE_URL: "postgresql://neondb_owner:npg_wkaTu52xezYC@ep-long-frost-aeryi5bb-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require",
  BOT_TOKEN: "8456273643:AAE1rKr1P-JEb_5Cg8EsPJfuUulpTjYztuo",
  WELCOME_IMAGE: "https://ar-hosting.pages.dev/1753585583429.jpg",
  CREATOR_LINK: "https://t.me/zerocreations"
};

async function sendTelegramRequest(endpoint, payload) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await response.json();
  } catch (error) {
    console.error('Telegram API Error:', error);
    return null;
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const client = new Client(CONFIG.DATABASE_URL);

    try {
      // Telegram Webhook Handler
      if (url.pathname === '/telegram-webhook' && request.method === 'POST') {
        const update = await request.json();
        console.log('Received update:', JSON.stringify(update));

        // Handle /start command
        if (update.message?.text === '/start') {
          await sendTelegramRequest('sendPhoto', {
            chat_id: update.message.chat.id,
            photo: CONFIG.WELCOME_IMAGE,
            caption: `🌟 *Welcome to Image Hoster Bot* 🌟\n\nSend me images to host them!\n\n🔹 *Features:*\n- Fast image hosting\n- Direct links\n- 24/7 availability\n\n📌 Created by: ${CONFIG.CREATOR_LINK}`,
            parse_mode: 'Markdown'
          });
          return new Response('OK');
        }

        // Handle image uploads
        if (update.message?.photo) {
          await client.connect();
          const photo = update.message.photo[update.message.photo.length - 1]; // Get highest quality
          
          // Get file path from Telegram
          const fileInfo = await sendTelegramRequest('getFile', { file_id: photo.file_id });
          if (!fileInfo.ok) throw new Error('Failed to get file info');
          
          // Download image
          const imageUrl = `https://api.telegram.org/file/bot${CONFIG.BOT_TOKEN}/${fileInfo.result.file_path}`;
          const imageResponse = await fetch(imageUrl);
          const buffer = await imageResponse.arrayBuffer();
          
          // Store in database
          const result = await client.query(
            `INSERT INTO images(filename, content_type, data, user_id) 
             VALUES($1, $2, $3, $4) RETURNING id`,
            [fileInfo.result.file_path.split('/').pop(), 
             imageResponse.headers.get('content-type'),
             buffer,
             update.message.chat.id.toString()]
          );

          // Send success message
          await sendTelegramRequest('sendMessage', {
            chat_id: update.message.chat.id,
            text: `✅ Image hosted successfully!\n\n🔗 Direct link: https://${url.hostname}/image/${result.rows[0].id}\n\nShare this link anywhere!`,
            parse_mode: 'Markdown'
          });
          
          return new Response('OK');
        }
      }

      // Image retrieval endpoint
      if (url.pathname.startsWith('/image/')) {
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
            'Cache-Control': 'public, max-age=31536000'
          }
        });
      }

      return new Response('Not Found', { status: 404 });

    } catch (error) {
      console.error('Error:', error);
      // Send error message to user
      if (update?.message?.chat?.id) {
        await sendTelegramRequest('sendMessage', {
          chat_id: update.message.chat.id,
          text: '⚠️ An error occurred. Our team has been notified. Please try again later.'
        });
      }
      return new Response('Server Error', { status: 500 });
    } finally {
      await client.end();
    }
  }
};
