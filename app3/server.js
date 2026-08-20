const express = require('express');
const app = express();
const PORT = process.env.PORT || 3003;
const SITE_NAME = process.env.SITE_NAME || 'Site 3';

app.use(express.json());

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head><title>${SITE_NAME}</title></head>
      <body>
        <h1>Welcome to ${SITE_NAME}</h1>
        <p>This is subdomain site 3</p>
      </body>
    </html>
  `);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', site: SITE_NAME, port: PORT });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`${SITE_NAME} running on port ${PORT}`);
});
