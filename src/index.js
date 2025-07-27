import { Client } from '@neondatabase/serverless';

// Initialize KV namespace for rate limiting
let rateLimit = {};

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const client = new Client(env.NEON_CONNECTION_STRING);
        
        // Telegram bot webhook handler
        if (url.pathname === '/telegram-webhook' && request.method === 'POST') {
            return handleTelegramUpdate(await request.json(), env, client);
        }
        
        // Image upload endpoint
        if (request.method === 'POST' && url.pathname === '/upload') {
            return handleImageUpload(request, client);
        }
        
        // Image retrieval endpoint
        if (request.method === 'GET' && url.pathname.startsWith('/image/')) {
            return handleImageRetrieval(url, client);
        }
        
        return new Response('Not found', { status: 404 });
    }
};

async function handleTelegramUpdate(update, env, client) {
    try {
        await client.connect();
        const chatId = update.message?.chat.id;
        const message = update.message?.text;
        const photo = update.message?.photo;
        
        if (message === '/start') {
            await sendWelcomeMessage(chatId, env);
            return new Response('OK');
        }
        
        if (photo) {
            return await handleTelegramPhoto(photo, chatId, env, client);
        }
        
        if (message === '/myimages') {
            return await handleMyImagesCommand(chatId, env, client);
        }
        
        return new Response('OK');
    } catch (err) {
        console.error('Telegram handler error:', err);
        return new Response('Error processing request', { status: 500 });
    } finally {
        await client.end();
    }
}

async function sendWelcomeMessage(chatId, env) {
    const welcomeMessage = `🌟 Welcome to Image Hoster Bot! 🌟\n\n` +
                         `Send me any image and I'll host it for you!\n\n` +
                         `🔹 /myimages - View your uploaded images\n` +
                         `Created by: ${env.CREATOR_LINK}`;
    
    const payload = {
        chat_id: chatId,
        photo: env.WELCOME_IMAGE_URL,
        caption: welcomeMessage
    };
    
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
}

async function handleTelegramPhoto(photo, chatId, env, client) {
    // Get the largest available photo size
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
    const contentType = imageResponse.headers.get('content-type');
    
    await client.query(
        'INSERT INTO images(filename, content_type, data, user_id) VALUES($1, $2, $3, $4)',
        [filename, contentType, imageBuffer, chatId.toString()]
    );
    
    // Send confirmation to user
    const imageId = await client.query('SELECT lastval()');
    const imageLink = `https://${new URL(env.WELCOME_IMAGE_URL).hostname}/image/${imageId.rows[0].lastval}`;
    
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            text: `✅ Image hosted successfully!\n\n🔗 Direct link: ${imageLink}\n\nShare this link with anyone!`
        })
    });
    
    return new Response('OK');
}

async function handleMyImagesCommand(chatId, env, client) {
    const result = await client.query(
        'SELECT id, filename, upload_date FROM images WHERE user_id = $1 ORDER BY upload_date DESC LIMIT 10',
        [chatId.toString()]
    );
    
    if (result.rows.length === 0) {
        await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: "You haven't uploaded any images yet!"
            })
        });
        return new Response('OK');
    }
    
    let message = "📷 Your recently uploaded images:\n\n";
    result.rows.forEach(row => {
        message += `🖼️ ${row.filename}\n` +
                  `📅 Uploaded: ${new Date(row.upload_date).toLocaleString()}\n` +
                  `🔗 https://${new URL(env.WELCOME_IMAGE_URL).hostname}/image/${row.id}\n\n`;
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
            'INSERT INTO images(filename, content_type, data) VALUES($1, $2, $3) RETURNING id',
            [file.name, file.type, buffer]
        );
        
        return new Response(JSON.stringify({
            id: result.rows[0].id,
            filename: file.name,
            url: `${new URL(request.url).origin}/image/${result.rows[0].id}`
        }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err) {
        return new Response(err.message, { status: 500 });
    } finally {
        await client.end();
    }
}

async function handleImageRetrieval(url, client) {
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
                'Cache-Control': 'public, max-age=86400'
            }
        });
    } catch (err) {
        return new Response(err.message, { status: 500 });
    } finally {
        await client.end();
    }
}
