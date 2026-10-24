import 'dotenv/config';
import express from 'express';
import { registerHackathonRoutes } from './domains/hackathons/routes';

// The entrypoint now focuses on app bootstrap while domain modules own the business logic.
const DEFAULT_PORT = 3000;

const app = express();
const port = Number(process.env.PORT) || DEFAULT_PORT;

app.use(express.json());

// Root and health endpoints stay lightweight so operators can quickly discover and verify the service.
app.get('/', (_request, response) => {
  response.json({
    message: 'Devpost hackathon scraper is running.',
    endpoints: {
      health: '/health',
      scrape: '/hackathons',
      scrapeAndPersist: '/hackathons?persist=true&page=1',
      persistAll: '/hackathons/persist-all?startPage=1',
      cache: '/hackathons/cache',
    },
  });
});

app.get('/health', (_request, response) => {
  response.json({
    status: 'ok',
  });
});

registerHackathonRoutes(app);

app.listen(port, () => {
  console.log(`Scraper is running at http://localhost:${port}`);
});
