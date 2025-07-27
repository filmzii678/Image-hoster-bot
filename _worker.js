import { Client } from '@neondatabase/serverless';

const CONFIG = {
  DATABASE_URL: "postgresql://neondb_owner:npg_wkaTu52xezYC@ep-long-frost-aeryi5bb-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require",
  BOT_TOKEN: "8456273643:AAE1rKr1P-JEb_5Cg8EsPJfuUulpTjYztuo",
  WELCOME_IMAGE: "https://ar-hosting.pages.dev/1753585583429.jpg",
  CREATOR_LINK: "https://t.me/zerocreations"
};

async function sendMessage(chatId, text, options = {}) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    ...options
  };
  
  const response = await fetch(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  
  return await response.json();
}

async function deleteMessage(chatId, messageId) {
  await fetch(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/deleteMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId })
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const client = new Client(CONFIG.DATABASE_URL);

    try {
      if (url.pathname === '/telegram-webhook' && request.method === 'POST') {
        const update = await request.json();
        
        // Handle /start command
        if (update.message?.text === '/start') {
          await sendMessage(update.message.chat.id, 
            `🌟 *Upload Bot Ready* 🌟\n\n` +
            `⚡ *Fast cloud hosting*\n` +
            `📤 Just send me any image!\n\n` +
            `_Powered by [Zero Creations](${CONFIG.CREATOR_LINK})_`);
          return new Response('OK');
        }

        // Handle image uploads
        if (update.message?.photo) {
          const chatId = update.message.chat.id;
          
          // Send initial "uploading" message
          const { result: statusMsg } = await sendMessage(chatId, 
            `🔄 *Uploading to cloud storage...*`, 
            { reply_to_message_id: update.message.message_id });
          
          try {
            await client.connect();
            const photo = update.message.photo[update.message.photo.length - 1];
            
            // Get file info (non-blocking)
            const fileInfo = await fetch(
              `https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/getFile?file_id=${photo.file_id}`
            ).then(r => r.json());
            
            // Update status
            await sendMessage(chatId, `⚡ *Processing image...*`);
            
            // Download and store (fast streaming)
            const imageUrl = `https://api.telegram.org/file/bot${CONFIG.BOT_TOKEN}/${fileInfo.result.file_path}`;
            const imageResponse = await fetch(imageUrl);
            const buffer = await imageResponse.arrayBuffer();
            
            // Fast DB insert
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
            
            // Delete status messages
            await deleteMessage(chatId, statusMsg.message_id);
            
            // Send success message with speed info
            await sendMessage(chatId,
              `✅ *Upload Complete!*\n\n` +
              `🔗 [Direct Link](https://${url.hostname}/image/${result.rows[0].id})\n` +
              `⚡ Processed in ${dbTime}ms\n\n` +
              `_Share this link anywhere!_`,
              { disable_web_page_preview: true });
              
          } catch (error) {
            console.error('Upload error:', error);
            await sendMessage(chatId, 
              `❌ Upload failed\n\n` +
              `_Error: ${error.message}_`);
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
          const result = await client.query(
            'SELECT data, content_type FROM images WHERE id = $1',
            [url.pathname.split('/')[2]]
          );
          
          return new Response(
            result.rows[0]?.data || 'Not found',
            {
              headers: {
                'Content-Type': result.rows[0]?.content_type || 'text/plain',
                'Cache-Control': 'public, max-age=31536000'
              },
              status: result.rows[0] ? 200 : 404
            }
          );
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
