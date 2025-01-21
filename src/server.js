import express from "express";
import cors from "cors";
import { OpenAI } from "openai";
import dotenv from 'dotenv';
import { GraphQLClient, gql } from 'graphql-request';

dotenv.config(); // Load environment variables from .env file

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize GraphQL client
const graphqlClient = new GraphQLClient('https://live.api.footium.club/api/graphql');

//Get a club by id
app.get('/api/club', async (req, res) => {
    const userId = req.query.id; // Get user input for ID from query parameters
    console.log(`Received ID: ${userId}`); // Log the received ID
    const dynamicQuery = gql`
    query {
      clubs(where: {id: {equals: ${userId}}}) {
        id
        name
        description
        owner {
          address
        }
      }
    }
    `; // Use dynamic ID in the query

    try {
        const data = await graphqlClient.request(dynamicQuery); // Use dynamic query
        console.log('GraphQL Query:', dynamicQuery); // Log the query
        console.log('GraphQL Response:', data);
        res.json(data);
    } catch (error) {
        console.error('Error querying GraphQL API:', error);
        res.status(500).json({ error: 'Error querying GraphQL API', details: error.message });
    }
});

//Get all players from a club
app.get('/api/club-players', async (req, res) => {
  const userId = req.query.id; // Get user input for ID from query parameters
  console.log(`Received ID: ${userId}`); // Log the received ID
  const dynamicQuery = gql`
  query {
    clubs(where: {id: {equals: 1123}}){ 
        id
        name
				registeredPlayers(skip: 0, take: 100) {
          id
        }
      }
  }
  `; // Use dynamic ID in the query

  try {
      const data = await graphqlClient.request(dynamicQuery); // Use dynamic query
      console.log('GraphQL Query:', dynamicQuery); // Log the query
      console.log('GraphQL Response:', data);
      res.json(data);
  } catch (error) {
      console.error('Error querying GraphQL API:', error);
      res.status(500).json({ error: 'Error querying GraphQL API', details: error.message });
  }
});

// Define the /api/player route
app.get('/api/player', async (req, res) => {
    const playerId = req.query.playerId; // Get user input for playerId from query parameters
    console.log(`Received Player ID: ${playerId}`); // Log the received Player ID
    const playerQuery = gql`
    query {
      players(where: {id: {equals: "${playerId}"}}) {
        fullName
        club {
          id
        }
        imageUrls {
          player
          card
          thumb
        }
      }
    }
    `; // Use dynamic playerId in the query

    try {
        const data = await graphqlClient.request(playerQuery); // Use dynamic query
        console.log('GraphQL Player Query:', playerQuery); // Log the query
        console.log('GraphQL Player Response:', data);
        res.json(data);
    } catch (error) {
        console.error('Error querying GraphQL API for player:', error);
        res.status(500).json({ error: 'Error querying GraphQL API for player', details: error.message });
    }
});

// Define the /api/query route
app.post('/api/query', async (req, res) => {
    const userInput = req.body.input;
    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: `
                  You are a football player and you have just finished a match. You are now going to answer a series of questions about the match.
                  Your personality is like Wayne Rooney, or Marcus Rashford
                  You are extremely irritable` 
                },
                { role: "user", content: userInput },
            ],
        });
        res.json({ output: completion.choices[0].message.content });
    } catch (error) {
        console.error('Error querying OpenAI API:', error);
        res.status(500).json({ error: 'Error querying OpenAI API', details: error.message });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
