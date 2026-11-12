import { MongoClient, type Collection } from 'mongodb';
import type { ScrapedHackathon } from './models/hackathon';

export type StoredHackathon = ScrapedHackathon & {
  fetchedAt: string;
  sourceUrl: string;
  updatedAt: string;
};

const DATABASE_NAME = process.env.MONGODB_DATABASE_NAME?.trim() || 'hackathon-opportunity-research';
const HACKATHONS_COLLECTION = process.env.MONGODB_COLLECTION_NAME?.trim() || 'hackathons';

let clientConnection: Promise<MongoClient> | null = null;

const getMongoClient = async (): Promise<MongoClient> => {
  if (clientConnection) {
    return clientConnection;
  }

  const connectionString = process.env.MONGODB_CONNECTION_STRING?.trim();

  if (!connectionString) {
    throw new Error(
      'MongoDB is not configured. Set MONGODB_CONNECTION_STRING in the scraper .env file.',
    );
  }

  const candidate = new MongoClient(connectionString);
  clientConnection = (async () => {
    try {
      await candidate.connect();
      return candidate;
    } catch (error) {
      clientConnection = null;
      await candidate.close();
      throw error;
    }
  })();
  return clientConnection;
};

export const getHackathonsCollection = async (): Promise<Collection<StoredHackathon>> => {
  const mongoClient = await getMongoClient();

  return mongoClient
    .db(DATABASE_NAME)
    .collection<StoredHackathon>(HACKATHONS_COLLECTION);
};
