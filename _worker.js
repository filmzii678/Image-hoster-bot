import { Hono } from 'hono';
import { Client } from '@neondatabase/serverless';

const app = new Hono();

// ===== CONFIGURATION ===== //
const CONFIG = {
  // Neon Database
  NEON_CONNECTION: "postgresql://neondb_owner:npg_wkaTu52xezYC@ep-long-frost-aeryi5bb-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require",
  
  // Telegram
  BOT_TOKEN: "8456273643:AAE1rKr1P-JEb_5Cg8EsPJfuUulpTjYztuo",
  
  // Branding
  WELCOME_IMAGE: "https://ar-hosting.pages.dev/1753585583429.jpg",
  CREATOR_LINK: "https://t.me/zerocreations"
};

// ===== MIDDLEWARE ===== //
app.use('*', async (c, next) => {
  c.set('config', CONFIG);
  await next();
});

// ===== HELPER FUNCTIONS ===== //
const sendMessage = async (botToken, chatId, text, options = {}) => {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      ...options
    })
  });
};

const sendPhoto = async (botToken, chatId, photo, caption, options = {}) => {
  await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      photo,
      caption,
      parse_mode: 'HTML',
      ...options
    })
  });
};

// ===== TELEGRAM WEBHOOK ===== //
app.post('/telegram-webhook', async (c) => {
  const { BOT_TOKEN, WELCOME_IMAGE, CREATOR_LINK } = c.get('config');
  const update = await c.req.json();
  
  const client = new Client(CONFIG.NEON_CONNECTION);
  await client.connect();
  
  try {
    // Handle /start command
    if (update.message?.text === '/start') {
      const welcomeMessage = `
🔥 <b>Welcome to Image Hoster Bot!</b> 🔥

<i>Your premium image hosting solution</i>

🚀 <b>What I can do:</b>
• Host your images instantly
• Generate permanent links
• Fast & reliable storage
• Easy sharing

📸 <b>How to use:</b>
Simply send me any image and I'll host it for you!

💎 <b>Features:</b>
✅ Unlimited uploads
✅ High-speed CDN
✅ Permanent storage
✅ Direct image links

👑 Created with ❤️ by <a href="${CREATOR_LINK}">Zero Creations</a>

<i>Send an image to get started!</i>
      `.trim();

      const keyboard = {
        inline_keyboard: [
          [
            { text: '📸 Upload Image', callback_data: 'upload_guide' },
            { text: '❓ Help', callback_data: 'help' }
          ],
          [
            { text: '👑 Creator', url: CREATOR_LINK }
          ]
        ]
      };

      await sendPhoto(BOT_TOKEN, update.message.chat.id, WELCOME_IMAGE, welcomeMessage, {
        reply_markup: keyboard
      });
    }

    // Handle image uploads
    else if (update.message?.photo) {
      const chatId = update.message.chat.id;
      const photo = update.message.photo[update.message.photo.length - 1]; // Get highest resolution
      
      // Send processing message
      const processingMsg = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: '⏳ <b>Processing your image...</b>\n<i>Please wait a moment</i>',
          parse_mode: 'HTML'
        })
      });
      const processingMsgData = await processingMsg.json();

      try {
        // Get file info from Telegram
        const fileResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${photo.file_id}`);
        const fileData = await fileResponse.json();
        
        // Download the file
        const imageResponse = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${fileData.result.file_path}`);
        const imageBuffer = await imageResponse.arrayBuffer();
        
        // Store in database
        const result = await client.query(
          `INSERT INTO images(filename, content_type, data, uploaded_at) 
           VALUES($1, $2, $3, NOW()) RETURNING id`,
          [`image_${Date.now()}.jpg`, 'image/jpeg', imageBuffer]
        );
        
        const hostedUrl = `${new URL(c.req.url).origin}/image/${result.rows[0].id}`;
        
        // Delete processing message
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: processingMsgData.result.message_id
          })
        });

        // Send success message
        const successMessage = `
✅ <b>Image hosted successfully!</b>

🔗 <b>Your hosted link:</b>
<code>${hostedUrl}</code>

📊 <b>Image Info:</b>
• ID: <code>${result.rows[0].id}</code>
• Size: ${Math.round(imageBuffer.byteLength / 1024)} KB
• Status: Active ✅

💡 <i>Click the link to copy it!</i>
        `.trim();

        const keyboard = {
          inline_keyboard: [
            [
              { text: '🔗 Open Link', url: hostedUrl },
              { text: '📋 Copy Link', callback_data: `copy_${result.rows[0].id}` }
            ],
            [
              { text: '📸 Upload Another', callback_data: 'upload_guide' }
            ]
          ]
        };

        await sendMessage(BOT_TOKEN, chatId, successMessage, {
          reply_markup: keyboard
        });

      } catch (error) {
        // Delete processing message
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: processingMsgData.result.message_id
          })
        });

        await sendMessage(BOT_TOKEN, chatId, '❌ <b>Error:</b> Failed to process your image. Please try again.');
      }
    }

    // Handle callback queries
    else if (update.callback_query) {
      const callbackData = update.callback_query.data;
      const chatId = update.callback_query.message.chat.id;

      if (callbackData === 'help') {
        const helpMessage = `
📚 <b>How to use Image Hoster Bot</b>

<b>Step 1:</b> Send any image to the bot
<b>Step 2:</b> Wait for processing (usually instant)
<b>Step 3:</b> Get your hosted link!

🔧 <b>Supported formats:</b>
• JPG, PNG, GIF, WebP
• Max size: 20MB per image

🌟 <b>Features:</b>
• Permanent hosting
• Fast loading speeds
• Direct image links
• No watermarks

❓ <b>Need help?</b> Contact: ${CREATOR_LINK}
        `.trim();

        await sendMessage(BOT_TOKEN, chatId, helpMessage);
      }
      
      else if (callbackData === 'upload_guide') {
        await sendMessage(BOT_TOKEN, chatId, '📸 <b>Ready to upload!</b>\n\nJust send me any image and I\'ll host it for you instantly! 🚀');
      }

      // Acknowledge callback query
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: update.callback_query.id
        })
      });
    }

    // Handle other message types
    else if (update.message?.text && update.message.text !== '/start') {
      const helpMessage = `
🤖 <b>I'm an Image Hosting Bot!</b>

I can only process images. Please send me an image to host it.

📸 <i>Supported: Photos, Images, Screenshots</i>
❌ <i>Not supported: Text, Videos, Documents</i>

Need help? Use /start to see the main menu.
      `.trim();

      await sendMessage(BOT_TOKEN, update.message.chat.id, helpMessage);
    }
    
    return c.text('OK');
  } finally {
    await client.end();
  }
});

// ===== IMAGE HOSTING ENDPOINTS ===== //
app.post('/upload', async (c) => {
  const client = new Client(CONFIG.NEON_CONNECTION);
  const formData = await c.req.formData();
  const file = formData.get('file');
  
  try {
    await client.connect();
    const buffer = await file.arrayBuffer();
    const res = await client.query(
      `INSERT INTO images(filename, content_type, data, uploaded_at) 
       VALUES($1, $2, $3, NOW()) RETURNING id`,
      [file.name, file.type, buffer]
    );
    
    return c.json({
      success: true,
      id: res.rows[0].id,
      url: `${new URL(c.req.url).origin}/image/${res.rows[0].id}`,
      filename: file.name,
      size: buffer.byteLength
    });
  } catch (error) {
    return c.json({ 
      success: false, 
      error: 'Upload failed' 
    }, 500);
  } finally {
    await client.end();
  }
});

app.get('/image/:id', async (c) => {
  const client = new Client(CONFIG.NEON_CONNECTION);
  try {
    await client.connect();
    const res = await client.query(
      'SELECT data, content_type, filename FROM images WHERE id = $1',
      [c.req.param('id')]
    );
    
    if (res.rows.length === 0) {
      return c.text('Image not found', 404);
    }
    
    return new Response(res.rows[0].data, {
      headers: {
        'Content-Type': res.rows[0].content_type,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Disposition': `inline; filename="${res.rows[0].filename || 'image'}"`
      }
    });
  } finally {
    await client.end();
  }
});

// ===== HEALTH CHECK ===== //
app.get('/health', (c) => {
  return c.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'Image Hoster Bot'
  });
});

export default app;
