import { Pool } from '@neondatabase/serverless';

// Configuration
const CONFIG = {
  DATABASE_URL: "postgresql://neondb_owner:npg_wkaTu52xezYC@ep-long-frost-aeryi5bb-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require",
  BOT_TOKEN: "8456273643:AAE1rKr1P-JEb_5Cg8EsPJfuUulpTjYztuo",
  WELCOME_IMAGE: "https://ar-hosting.pages.dev/1753585583429.jpg"
};

// Database connection pool
let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: CONFIG.DATABASE_URL });
    pool.on('error', err => console.error('Database error:', err));
  }
  return pool;
}

async function sendMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    })
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const pool = getPool();
    const client = await pool.connect();

    try {
      // Telegram Webhook
      if (url.pathname === '/telegram-webhook' && request.method === 'POST') {
        const update = await request.json();
        
        // Start Command
        if (update.message?.text === '/start') {
          await sendMessage(
            update.message.chat.id,
            `🌟 *Welcome to Image Hosting Bot* 🌟\n\n` +
            `Send me images to get permanent links!`
          );
          return new Response('OK');
        }

        // Image Upload
        if (update.message?.photo) {
          const statusMsg = await sendMessage(
            update.message.chat.id,
            "🔄 Uploading your image..."
          );

          try {
            const photo = update.message.photo[update.message.photo.length - 1];
            const fileInfo = await fetch(
              `https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/getFile?file_id=${photo.file_id}`
            ).then(r => r.json());

            const imageUrl = `https://api.telegram.org/file/bot${CONFIG.BOT_TOKEN}/${fileInfo.result.file_path}`;
            const imageResponse = await fetch(imageUrl);
            const buffer = await imageResponse.arrayBuffer();

            const result = await client.query(
              `INSERT INTO images(filename, content_type, data, user_id) 
               VALUES($1, $2, $3, $4) RETURNING id`,
              [
                fileInfo.result.file_path.split('/').pop(),
                imageResponse.headers.get('content-type'),
                buffer,
                update.message.from.id
              ]
            );

            await sendMessage(
              update.message.chat.id,
              `✅ Upload successful!\n` +
              `🔗 https://${url.hostname}/image/${result.rows[0].id}`
            );

          } catch (err) {
            console.error('Upload error:', err);
            await sendMessage(
              update.message.chat.id,
              "❌ Failed to upload. Please try again later."
            );
          }
          return new Response('OK');
        }
      }

      // Image Retrieval
      if (url.pathname.startsWith('/image/')) {
        const id = url.pathname.split('/')[2];
        const result = await client.query(
          'SELECT data, content_type FROM images WHERE id = $1',
          [id]
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
      }

      return new Response('Not Found', { status: 404 });

    } catch (err) {
      console.error('Global error:', err);
      return new Response('Server Error', { status: 500 });
    } finally {
      client.release();
    }
  }
};
