import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

const connectionString = process.env.DATABASE_URL;

if(!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
}

export const pool = new Pool({
    connectionString,
    ssl: {
        rejectUnauthorized: false,
    },
});

export const db = drizzle(pool);