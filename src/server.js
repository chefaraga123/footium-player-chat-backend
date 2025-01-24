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
    homeTeamId: '',
    awayTeamId: '',
    homeTeamName: '',
    awayTeamName: '',
    goals: [],
    cards: [],
    activePlayers: [],
    matchDigest: '',
    fixtureId: '',
    homeTeamWins: 0,
    awayTeamWins: 0
};

//Get a club by id
app.get('/api/club', async (req, res) => {
    const userId = req.query.id; // Get user input for ID from query parameters

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
        res.json(data);
    } catch (error) {
        console.error('Error querying GraphQL API:', error);
        res.status(500).json({ error: 'Error querying GraphQL API', details: error.message });
    }
});

app.get('/api/set-fixture', async (req, res) => {
  const fixtureId = req.query.id; // Get user input for ID from query parameters
  sessionData['fixtureId'] = fixtureId;
  res.json({ message: 'Fixture ID set successfully' });
});


app.get('/api/match-context', async (req,res) => {
  console.log('match-context')
  try {
    res.json({ message: 'match context set successfully' });
    axios.get(`http://localhost:5000/api/sse-partial`);
    axios.get(`http://localhost:5000/api/sse-frames`);


  } catch (error) {
      console.error('Error fetching match context:', error);
      res.status(500).json({ error: 'Error fetching match context', details: error.message });
  }
});


//Get all players from a club
app.get('/api/club-players', async (req, res) => {
  const userId = req.query.id; // Get user input for ID from query parameters
  const dynamicQuery = gql`
  query {
    clubs(where: {id: {equals: ${userId}}}){ 
        id
        name
				registeredPlayers(skip: 0, take: 6) {
          id
        }
      }
  }
  `; // Use dynamic ID in the query

  try {
      const data = await graphqlClient.request(dynamicQuery); // Use dynamic query
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
    const { goals, cards, activePlayers, matchDigest, homeTeamWins, awayTeamWins } = sessionData;

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
                  The active players are ${activePlayers.map(player => player.playerName).join(', ')}.
                  The match digest is ${matchDigest}
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


    const matchId = sessionData['fixtureId'];
    if (!matchId) {
      return res.status(400).json({ error: 'Match ID is required.' });
    }

    const url_match_frames = `https://uat-a5c70ab25f1503bd.api.footium.club/api/sse/match_frames/${matchId}`;

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
        const teamNames = {
          534: 'Rast Hexbrids',
          8: 'Elsdalling Rovers',
        };
        
        const sequentialEvents = data.map(event => {
          const teamName = teamNames[event.teamInPossession] || 'Unknown Team'; // Get team name or default to 'Unknown Team'
            return `
              Type: ${event.eventTypeAsString}, 
              Team: ${teamName}, 
              Player: ${event.playerInPossession}`;
        }).join('\n'); // Join with newlines for better readability

        console.log("sequentialEvents",sequentialEvents)

        const { homeTeamId, homeTeamName, awayTeamId, awayTeamName, homeTeamWins, awayTeamWins } = sessionData;

        try {
          const completion = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [
                  { role: "system", content: `   
                    digest this passage of play, abstracted from a football match into a coherent narrative:
                    ${sequentialEvents}. Insert the following context into the narrative:
                    The home team is ${homeTeamName} corresponding to id ${homeTeamId}
                    The away team is ${awayTeamName} corresponding to id ${awayTeamId}
                    The home team has ${homeTeamWins} wins.
                    The away team has ${awayTeamWins} wins.
                    The team for which the number of wins is 1 is the winner of the match
                  ` 
                  }
              ],
          });
          sessionData['matchDigest'] = completion.choices[0].message.content;

        } catch (error) {
            console.error('Error querying OpenAI API:', error);
            res.status(500).json({ error: 'Error querying OpenAI API', details: error.message });
        }

        res.write(`data: ${sequentialEvents}\n\n`);
        messageCount++; // Increment the message counter

        // Check if we have received two messages from the first endpoint
        if (messageCount >= 2) {
            eventSource.close(); // Close the EventSource connection
        }
    };

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
  const matchId = sessionData['fixtureId'];

  if (!matchId) {
    return res.status(400).json({ error: 'Match ID is required.' });
}


  const url_partial_match = `https://uat-a5c70ab25f1503bd.api.footium.club/api/sse/partial_match/${matchId}`;

  // Create an EventSource-like connection
  const eventSource = new EventSource(url_partial_match);
  let messageCount = 0; // Initialize a counter for received messages

  // The event source API allows a web applicato to receive real-time updates from a server via HTTP connections.
  eventSource.onmessage = async (event) => {
  const data = JSON.parse(event.data); // Parse the incoming JSON data


      if (data){
        sessionData['homeTeamWins'] = data.state.homeTeam.stats.wins
        sessionData['awayTeamWins'] = data.state.awayTeam.stats.wins

        const homeTeamId = data.state.homeTeam.clubId;
        const awayTeamId = data.state.awayTeam.clubId;

        sessionData['homeTeamId'] = homeTeamId;
        sessionData['awayTeamId'] = awayTeamId;

        const homeTeamResponse = await axios.get(`http://localhost:5000/api/club?id=${homeTeamId}`);
        const homeTeamName = homeTeamResponse.data.clubs[0].name;

        const awayTeamResponse = await axios.get(`http://localhost:5000/api/club?id=${awayTeamId}`);
        const awayTeamName = awayTeamResponse.data.clubs[0].name;

        sessionData['homeTeamName'] = homeTeamName;
        sessionData['awayTeamName'] = awayTeamName;

      }


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
        const response = await axios.get(`http://localhost:5000/api/player?playerId=${playerId}`);
          sessionData['activePlayers'].push(
          {
            "playerName": response.data.players[0].fullName,
          }
        )
      }

      for (const event of data.state.keyEvents) {
        let playerId = '';
        if (event.type == 2) {
          playerId = event.playerId;
          //console.log('carded playerId',playerId)
        } else if (event.type == 0) {
          playerId = event.scorerPlayerId;
          //console.log('scored playerId',playerId)
        }

        const response = await axios.get(`http://localhost:5000/api/player?playerId=${playerId}`);
        //console.log('player response data',response.data)
        const clubId = event.clubId;
        const clubResponse = await axios.get(`http://localhost:5000/api/club?id=${clubId}`);
        //console.log('clubResponse',clubResponse.data)
        const clubName = clubResponse.data.clubs[0].name;
        let playerName = '';
        if (response.data.players[0]) {
          playerName = response.data.players[0].fullName;
          //console.log('playerName',playerName)
        } else {
          //console.log('playerName not found')
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

      // Check if we have received two messages from the first endpoint
      if (messageCount >= 2) {
          console.log('closing')
          eventSource.close(); // Close the EventSource connection
      }

      console.log("homeTeamId",sessionData['homeTeamId'])
      console.log("homeTeamName",sessionData['homeTeamName'])
      console.log("awayTeamId",sessionData['awayTeamId'])
      console.log("awayTeamName",sessionData['awayTeamName'])

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
