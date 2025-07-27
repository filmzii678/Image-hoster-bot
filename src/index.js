import { Client } from '@neondatabase/serverless';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const client = new Client(env.NEON_CONNECTION_STRING);

    // Telegram Webhook Handler
    if (url.pathname === '/telegram-webhook') {
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
      }

      try {
        await client.connect();
        const update = await request.json();
        return await handleTelegramUpdate(update, env, client);
      } catch (error) {
        console.error('Error:', error);
        return new Response('Server Error', { status: 500 });
      } finally {
        await client.end();
      }
    }

    // Image Upload Endpoint
    if (url.pathname === '/upload' && request.method === 'POST') {
      return handleImageUpload(request, client);
    }

    // Image Retrieval Endpoint
    if (url.pathname.startsWith('/image/') && request.method === 'GET') {
      return handleImageRetrieval(url, client);
    }

    return new Response('Not Found', { status: 404 });
  }
};

async function handleTelegramUpdate(update, env, client) {
  const chatId = update.message?.chat.id;
  const messageText = update.message?.text;
  const photo = update.message?.photo;

  // Start Command
  if (messageText === '/start') {
    await sendWelcomeMessage(chatId, env);
    return new Response('OK');
  }

  // Handle Image Uploads
  if (photo) {
    return await handleTelegramPhoto(photo, chatId, env, client);
  }

  // My Images Command
  if (messageText === '/myimages') {
    return await handleMyImagesCommand(chatId, env, client);
  }

  return new Response('OK');
}

async function sendWelcomeMessage(chatId, env) {
  const welcomeText = `🌟 Welcome to Image Hoster Bot! 🌟\n\n`
    + `Send me images and I'll host them for you!\n\n`
    + `🔹 /myimages - View your uploaded images\n`
    + `Created by: ${env.CREATOR_LINK}`;

  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      photo: env.WELCOME_IMAGE_URL,
      caption: welcomeText
    })
  });
}

async function handleTelegramPhoto(photo, chatId, env, client) {
  try {
    // Get largest photo size
    const largestPhoto = photo.reduce((prev, current) => 
      (prev.file_size > current.file_size) ? prev : current
    );

    // Get file path from Telegram
    const fileResponse = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${largestPhoto.file_id}`
    );
    const fileData = await fileResponse.json();

    // Download the image
    const imageUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${fileData.result.file_path}`;
    const imageResponse = await fetch(imageUrl);
    const imageBuffer = await imageResponse.arrayBuffer();

    // Store in database
    const filename = fileData.result.file_path.split('/').pop();
    await client.query(
      `INSERT INTO images(filename, content_type, data, user_id, telegram_file_id)
       VALUES($1, $2, $3, $4, $5)`,
      [filename, imageResponse.headers.get('content-type'), imageBuffer, chatId.toString(), largestPhoto.file_id]
    );

    // Get the image ID
    const res = await client.query('SELECT lastval() as id');
    const imageLink = `https://${new URL(env.WELCOME_IMAGE_URL).hostname}/image/${res.rows[0].id}`;

    // Send confirmation to user
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `✅ Image hosted successfully!\n\n🔗 Direct link: ${imageLink}`
      })
    });

    return new Response('OK');
  } catch (error) {
    console.error('Photo handling error:', error);
    return new Response('Error processing image', { status: 500 });
  }
}

async function handleMyImagesCommand(chatId, env, client) {
  const result = await client.query(
    `SELECT id, filename, upload_date 
     FROM images 
     WHERE user_id = $1 
     ORDER BY upload_date DESC 
     LIMIT 10`,
    [chatId.toString()]
  );

  let message = result.rows.length > 0 
    ? "📷 Your recently uploaded images:\n\n"
    : "You haven't uploaded any images yet!";

  result.rows.forEach(row => {
    message += `🖼️ ${row.filename}\n`
      + `📅 ${new Date(row.upload_date).toLocaleString()}\n`
      + `🔗 https://${new URL(env.WELCOME_IMAGE_URL).hostname}/image/${row.id}\n\n`;
  });

  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message
    })
  });

  return new Response('OK');
}

async function handleImageUpload(request, client) {
  try {
    await client.connect();
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return new Response('No file uploaded', { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const result = await client.query(
      `INSERT INTO images(filename, content_type, data)
       VALUES($1, $2, $3)
       RETURNING id`,
      [file.name, file.type, buffer]
    );

    return new Response(JSON.stringify({
      id: result.rows[0].id,
      url: `${new URL(request.url).origin}/image/${result.rows[0].id}`
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(error.message, { status: 500 });
  } finally {
    await client.end();
  }
}

async function handleImageRetrieval(url, client) {
  try {
    await client.connect();
    const id = url.pathname.split('/')[2];
    const result = await client.query(
      `SELECT data, content_type 
       FROM images 
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return new Response('Image not found', { status: 404 });
    }

    return new Response(result.rows[0].data, {
      headers: {
        'Content-Type': result.rows[0].content_type,
        'Cache-Control': 'public, max-age=86400'
      }
    });
  } catch (error) {
    return new Response(error.message, { status: 500 });
  } finally {
    await client.end();
  }
}
