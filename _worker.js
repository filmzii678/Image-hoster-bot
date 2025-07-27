import { Client } from '@neondatabase/serverless';

const CONFIG = {
  DATABASE_URL: "postgresql://neondb_owner:npg_wkaTu52xezYC@ep-long-frost-aeryi5bb-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require",
  BOT_TOKEN: "8456273643:AAE1rKr1P-JEb_5Cg8EsPJfuUulpTjYztuo",
  WELCOME_IMAGE: "https://ar-hosting.pages.dev/1753585583429.jpg",
  CREATOR_LINK: "https://t.me/zerocreations"
};

async function sendMessage(chatId, text, options = {}) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        ...options
      })
    });
    return await response.json();
  } catch (error) {
    console.error('Failed to send message:', error);
  }
}

async function editMessage(chatId, messageId, newText) {
  await fetch(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: newText,
      parse_mode: 'Markdown'
    })
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    try {
      // Telegram Webhook Handler
      if (url.pathname === '/telegram-webhook' && request.method === 'POST') {
        const update = await request.json();
        
        // Handle /start command
        if (update.message?.text === '/start') {
          await sendMessage(
            update.message.chat.id,
            `🌟 *Welcome to Image Hosting Bot* 🌟\n\n` +
            `📤 Send me images to get permanent hosting links!\n\n` +
            `⚡ *Features:*\n` +
            `• Fast cloud storage\n` +
            `• Direct media links\n` +
            `• 24/7 availability\n\n` +
            `_Created by [Zero Creations](${CONFIG.CREATOR_LINK})_`
          );
          return new Response('OK');
        }

        // Handle image uploads
        if (update.message?.photo) {
          const chatId = update.message.chat.id;
          const messageId = update.message.message_id;
          
          // Send initial status message
          const statusMsg = await sendMessage(
            chatId, 
            "🔄 *Uploading your image to cloud storage...*",
            { reply_to_message_id: messageId }
          );

          const client = new Client(CONFIG.DATABASE_URL);
          try {
            await client.connect();
            const photo = update.message.photo[update.message.photo.length - 1]; // Highest quality
            
            // Update status
            await editMessage(chatId, statusMsg.result.message_id, "⚡ *Processing image data...*");
            
            // Get file info
            const fileInfo = await fetch(
              `https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/getFile?file_id=${photo.file_id}`
            ).then(r => r.json());

            // Download image
            const imageUrl = `https://api.telegram.org/file/bot${CONFIG.BOT_TOKEN}/${fileInfo.result.file_path}`;
            const imageResponse = await fetch(imageUrl);
            const buffer = await imageResponse.arrayBuffer();

            // Store in database
            await editMessage(chatId, statusMsg.result.message_id, "🔒 *Securing your file in database...*");
            const startTime = Date.now();
            const result = await client.query(
              `INSERT INTO images(filename, content_type, data, user_id) 
               VALUES($1, $2, $3, $4) RETURNING id`,
              [
                fileInfo.result.file_path.split('/').pop(),
                imageResponse.headers.get('content-type'),
                buffer,
                chatId.toString()
              ]
            );
            const dbTime = Date.now() - startTime;

            // Final success message
            await editMessage(
              chatId, 
              statusMsg.result.message_id,
              `✅ *Upload Complete!*\n\n` +
              `🔗 [Direct Link](https://${url.hostname}/image/${result.rows[0].id})\n` +
              `⏱ Processed in ${dbTime}ms\n\n` +
              `_Share this link anywhere!_`
            );

          } catch (error) {
            console.error('Upload error:', error);
            await editMessage(
              chatId,
              statusMsg.result.message_id,
              `❌ *Upload Failed*\n\n` +
              `_Error: ${error.message}_`
            );
          } finally {
            await client.end();
          }
          return new Response('OK');
        }
      }

      // Image retrieval endpoint
      if (url.pathname.startsWith('/image/')) {
        const client = new Client(CONFIG.DATABASE_URL);
        try {
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
        } finally {
          await client.end();
        }
      }

      return new Response('Not Found', { status: 404 });

    } catch (error) {
      console.error('Global error:', error);
      return new Response('Server Error', { status: 500 });
    }
  }
};
