import { Client } from '@neondatabase/serverless';

export default {
  async fetch(request, env) {
    const client = new Client(env.NEON_CONNECTION_STRING);
    // ... rest of your worker code ...
  }
};
