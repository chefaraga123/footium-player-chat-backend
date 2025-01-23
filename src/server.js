import express from "express";
import cors from "cors";
import { OpenAI } from "openai";
import dotenv from 'dotenv';
import { GraphQLClient, gql } from 'graphql-request';
import axios from 'axios'; // Ensure axios is imported
import { EventSource } from 'eventsource'; // Use named import for EventSource

dotenv.config(); // Load environment variables from .env file

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize GraphQL client
const graphqlClient = new GraphQLClient('https://uat-a5c70ab25f1503bd.api.footium.club/api/graphql');

// Define a session store at the top level
let sessionData = {
    goals: [],
    cards: []
};

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
    clubs(where: {id: {equals: ${userId}}}){ 
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
        console.log('GraphQL Player Response:', data);
        res.json(data);
    } catch (error) {
        console.error('Error querying GraphQL API for player:', error);
        res.status(500).json({ error: 'Error querying GraphQL API for player', details: error.message });
    }
});

// Define the /api/query route
app.post('/api/query', async (req, res) => {
    const { playerName, chatInput } = req.body; // Destructure playerName and chatInput from the request body
    const { goals, cards } = sessionData;

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: ` 
                  You are a football player named ${playerName} and you have just finished a match. You are now going to answer a series of questions about the match.
                  Your personality is like Wayne Rooney, or Marcus Rashford
                  You are extremely irritable.
                  There are ${goals.length} goals in the match.
                  There are ${cards.length} cards in the match.
                  The goals were scored by ${goals.map(goal => goal.goal_scorer_name).join(', ')}.
                  The cards were given to ${cards.map(card => card.card_receiver_name).join(', ')}.
                  ` 
                },
                { role: "user", content: chatInput }, // Use chatInput for the user's question
            ],
        });
        res.json({ output: completion.choices[0].message.content });
    } catch (error) {
        console.error('Error querying OpenAI API:', error);
        res.status(500).json({ error: 'Error querying OpenAI API', details: error.message });
    }
});

// Define the /api/sse endpoint
app.get('/api/sse-frames', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    //const url_partial_match = 'https://uat-a5c70ab25f1503bd.api.footium.club/api/sse/partial_match/2314-2-4';
    const url_match_frames = 'https://uat-a5c70ab25f1503bd.api.footium.club/api/sse/match_frames/2314-2-4';

    // Create an EventSource-like connection
    const eventSource = new EventSource(url_match_frames);
    let messageCount = 0; // Initialize a counter for received messages

    eventSource.onmessage = async (event) => {
        const data = JSON.parse(event.data); // Parse the incoming JSON data

        // Check if the received data is an empty array
        if (Array.isArray(data) && data.length === 0) {
            console.log('Received an empty list, disregarding it.');
            return; // Exit the function if the data is an empty array
        }

        // Send the received data to the client
        res.write(`data: ${JSON.stringify(data)}\n\n`); // Send valid data to the client

        // Handle the received data if it's not an empty list
        await handleData(data); // Example async function to process the data

        messageCount++; // Increment the message counter

        // Check if we have received two messages from the first endpoint
        if (messageCount >= 2) {
            eventSource.close(); // Close the EventSource connection
        }
    };

    // Example async function to handle data
    async function handleData(data) {
        // Check if data is not empty
        if (data.length > 0) {
            // Loop over all objects in the list
            data.forEach(async (event, index) => {
                const eventDescription = event.eventTypeAsString;
                const teamInPossession = event.teamInPossession; //returns the clubId
                const playerInPossession = event.playerInPossession; //returns the playerId
                // Function to get player data
                async function getPlayerData(playerId) {
                    try {
                        const response = await axios.get(`http://localhost:5000/api/player?playerId=${playerId}`);
                        //console.log('Player Data:', response.data);
                        return response.data; // Return the player data
                    } catch (error) {
                        //console.error('Error fetching player data:', error);
                        return null; // Return null in case of error
                    }
                }

                async function getPlayerInPossesionEvent() {
                    const playerData = await getPlayerData(playerInPossession);
                    //console.log('Player Data:', playerData);
                    
                    if (playerData && playerData.players && playerData.players.length > 0) { // Check if playerData is valid
                        const playerName = playerData.players[0].fullName; // Safely access fullName
                        console.log(`Event Type of event ${index}:
                              ${eventDescription}
                              the team in possession is ${teamInPossession} 
                              and the player in possession is ${playerName}`
                          );
                        
                        // Send the player name to the client
                        res.write(`The player in possession is ${playerName}`); // Send valid data to the client
                    } else {
                        console.error('Player data is undefined or empty.');
                        res.write('Player data is not available.'); // Send a message to the client
                    }

                    // Call res.end() after all data has been sent
                    res.end(); // End the response to the client
                }
                // Example usage within your event handling logic
                //const clubData = await getClubData(teamInPossession);
                //const playerData = await getPlayerData(playerInPossession);
                getPlayerInPossesionEvent()


                // Log the retrieved data
                //console.log('Club Data:', clubData);
                //console.log('Player Data:', playerData);
            });
        } else {
            console.log('No data available.');
        }
    }

    eventSource.onerror = (error) => {
        console.error('EventSource failed:', error);
        eventSource.close(); // Close the connection on error
        res.end(); // End the response to the client
    };

    // Clean up when the client disconnects
    req.on('close', () => {
        eventSource.close();
        res.end();
    });
});

// SSE endpoint handler
app.get('/api/sse-partial', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const url_partial_match = 'https://uat-a5c70ab25f1503bd.api.footium.club/api/sse/partial_match/2314-14-1';
  //const url_match_frames = 'https://uat-a5c70ab25f1503bd.api.footium.club/api/sse/match_frames/2314-2-4';

  // Create an EventSource-like connection
  const eventSource = new EventSource(url_partial_match);
  let messageCount = 0; // Initialize a counter for received messages

  // The event source API allows a web applicato to receive real-time updates from a server via HTTP connections.
  eventSource.onmessage = async (event) => {
      const data = JSON.parse(event.data); // Parse the incoming JSON data

      if (!data) {  // Check if the received data is falsey 
        messageCount++; // Increment the message counter
        return; // Exit the function if the data is an empty array
      }
      messageCount++; // Increment the message counter

      // record the number of goals and cards in the match
      let goals = [];
      let cards = [];

      //console.log("data.state.players",data.state.players)

      // Assuming data.state.players is an array of player objects
      const players = data.state.players;
      for (const playerId of Object.keys(players)){
        console.log("playerId",playerId)
        const response = await axios.get(`http://localhost:5000/api/player?playerId=${playerId}`);
        console.log("player response",response.data)
      }


      // Extracting current position and ID for each player
      //const playerPositions = players.map(player => ({
      //    id: player.id, // Assuming the player object has an 'id' property
      //    position: player.currentPosition // Assuming the player object has a 'position' property
      //}));

      //console.log("Player Positions:", playerPositions);

      for (const event of data.state.keyEvents) {
        let playerId = '';
        if (event.type == 2) {
          playerId = event.playerId;
          console.log('carded playerId',playerId)
        } else if (event.type == 0) {
          playerId = event.scorerPlayerId;
          console.log('scored playerId',playerId)
        }

        const response = await axios.get(`http://localhost:5000/api/player?playerId=${playerId}`);
        console.log('player response data',response.data)
        const clubId = event.clubId;
        const clubResponse = await axios.get(`http://localhost:5000/api/club?id=${clubId}`);
        console.log('clubResponse',clubResponse.data)
        const clubName = clubResponse.data.clubs[0].name;
        let playerName = '';
        if (response.data.players[0]) {
          playerName = response.data.players[0].fullName;
          console.log('playerName',playerName)
        } else {
          console.log('playerName not found')
        }

        if (event.type == 2) {
          cards.push(
            {
              "team": event.clubId,
              "team_name": clubName,
              "card_receiver": event.playerId,
              "card_receiver_name": playerName,
              "card_time": event.timestamp
            }
          );
        } else if (event.type == 0) {
          goals.push(
            {
              "team": event.clubId,
              "team_name": clubName,
              "goal_scorer": event.scorerPlayerId,
              "goal_scorer_name": playerName,
              "goal_time": event.timestamp
            }
          );
        }
      }

      sessionData['goals'] = goals;
      sessionData['cards'] = cards;

      // Send the received data to the client, which is part of the node.js response object
      res.write(`data: goals:\n\n ${JSON.stringify(goals)}\n\ncards:\n ${JSON.stringify(cards)}`); // Send valid data to the client

      //res.write(`data: ${JSON.stringify(data.state.keyEvents)}\n\n`); // Send valid data to the client


      // Check if we have received two messages from the first endpoint
      if (messageCount >= 2) {
          console.log('closing')
          eventSource.close(); // Close the EventSource connection
      }
  };

  // Example async function to handle data

  eventSource.onerror = (error) => {
      console.error('EventSource failed:', error);
      eventSource.close(); // Close the connection on error
      res.end(); // End the response to the client
  };

  // Clean up when the client disconnects
  req.on('close', () => {
      eventSource.close();
      res.end();
  });
});


// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
