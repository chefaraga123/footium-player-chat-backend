import express from "express";
import cors from "cors";
import { OpenAI } from "openai";
import dotenv from 'dotenv';
import { GraphQLClient, gql } from 'graphql-request';
import axios from 'axios'; // Ensure axios is imported
import { EventSource } from 'eventsource'; // Use named import for EventSource
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

dotenv.config(); // Load environment variables from .env file

const app = express();
const PORT = 5000;
const apiEndpoint = process.env.API_ENDPOINT || "http://localhost:5000"
const graphQLEndpoint = process.env.QRAPHGQL_ENDPOINT || "https://uat-a5c70ab25f1503bd.api.footium.club/api/graphql"
const matchEndpoint = process.env.MATCH_ENDPOINT || "https://uat-a5c70ab25f1503bd.api.footium.club/api/sse"
const JWT_SECRET = process.env.JWT_SECRET

/*
// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, { // Add your MongoDB URI in .env
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB connection error:', err));

// Define a Mongoose schema and model for user inputs
const userInputSchema = new mongoose.Schema({
  walletAddress: { type: String, required: true },
  clubId: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  message: { type: String, required: true },
});

const UserInput = mongoose.model('UserInput', userInputSchema);
*/

app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize GraphQL client
const graphqlClient = new GraphQLClient(`${graphQLEndpoint}`);

// Define a session store at the top level
let sessionData = {
    users: {},
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

// Define personalities
const personalities = [
  {
    id: 1,
    name: "Aggressive",
    description: "You are aggressive and always looking to dominate the game."
  },
  {
    id: 2,
    name: "Calm",
    description: "You remain calm under pressure and make thoughtful decisions."
  },
  {
    id: 3,
    name: "Cheerful",
    description: "You are always cheerful and encourage your teammates."
  },
  // Add more personalities as needed
];

const hash = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
};

const assignPersonality = (playerId) => {
  const index = Math.abs(hash(playerId)) % personalities.length; // Ensure index is within bounds
  return personalities[index];
};

app.post('/api/set-user-id', (req, res) => {
  const { userId } = req.body; // Get the userId from the request body
  sessionData.users[userId] = {
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
  }; // Set the userId in sessionData
  console.log(`sessionData.users[${userId}]`, sessionData.users[userId])
  res.json({ message: 'User ID set successfully' });
});

app.post('/api/authenticate', (req, res) => {
  const { walletAddress } = req.body; // Get the wallet address from the request body

  // Create a token
  const token = jwt.sign({ walletAddress }, JWT_SECRET, { expiresIn: '1h' }); // Token expires in 1 hour
  res.json({ token });
});


app.get('/api/match-done', async (req, res) => {
  const matchId = req.query.matchId;

  
  const dynamicQuery = gql`
  query {
    match(where: {id:"${matchId}"}) {
      id
    }
  }
  `;

  const matchDone = await graphqlClient.request(dynamicQuery);
  res.json(matchDone);
});

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
  const { id, userId } = req.query; // Get user input for ID from query parameters
  console.log("userId inside set-fixture", userId)
  console.log("fixtureId", id);
  sessionData['fixtureId'] = id;
  sessionData.users[userId]['fixtureId'] = id;
  console.log("sessionData", sessionData)
  res.json({ message: 'Fixture ID set successfully' });
});


app.get('/api/match-context', async (req,res) => {
  const { userId } = req.query; // Get user input for ID from query parameters
  try {
    res.json({ message: 'match context set successfully' });
    axios.get(`${apiEndpoint}/api/sse-partial?userId=${userId}`)
      .then(response => {
        console.log("frames start")
        return axios.get(`${apiEndpoint}/api/sse-frames?userId=${userId}`);
      })
      .then(response => {
      })
      .catch(error => {
        console.error('Error fetching data:', error);
      });
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
    const playerQuery = gql`
    query {
      players(where: {id: {equals: "${playerId}"}}) {
        id
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
        res.json(data);
    } catch (error) {
        console.error('Error querying GraphQL API for player:', error);
        res.status(500).json({ error: 'Error querying GraphQL API for player', details: error.message });
    }
});

// Define the /api/query route
app.post('/api/query', async (req, res) => {
    const { playerName, playerId, chatInput, playerClubId, userId } = req.body; // Destructure playerName and chatInput from the request body
    console.log("userId inside query", userId)

    const userData = sessionData.users[userId];

    const { goals, cards, activePlayers, matchDigest, homeTeamWins, awayTeamWins } = userData;

    const numberOfActivePlayers = activePlayers.length;

    const goalScorers = goals.map(goal => `${goal.goal_scorer_name} from ${goal.team_name}`).join(', ');
    const goalCounts = goals.reduce((acc, goal) => {
        acc[goal.team_name] = (acc[goal.team_name] || 0) + 1; // Increment the count for the team
        return acc;
    }, {});

    // Now you can use goalCounts to get the number of goals for each team
    const scoreGeneration = Object.entries(goalCounts)
        .map(([team, count]) => `${team}: ${count}`)
        .join(', ');

    const card_receivers = cards.map(card => card.card_receiver_name).join(', ');

    //Get the player's context: 
    const playerContext = await axios.get(`${apiEndpoint}/api/player?playerId=${playerId}`);
    //console.log("playerContext", playerContext.data)
    //console.log("assignPersonality(playerId)", assignPersonality(playerId))
    console.log(
      "player club id", playerClubId
    )
    const clubResponse = await axios.get(`${apiEndpoint}/api/club?id=${playerClubId}`);
    const clubName =  clubResponse.data.clubs[0].name

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: ` 
                  You are a football player named ${playerName} and you have just finished a match. 
                  You are now going to answer a series of questions about the match.
                  Your personality is ${assignPersonality(playerId).description}.
                  
                  You play for ${clubName}. Ensure any responses are in view of the fact that you play for this club. 

                  There are ${goals.length} goals in the match.
                  There are ${cards.length} cards in the match.

                  The goals were scored by ${goalScorers}.
                  The score at the end was ${scoreGeneration}.

                  The cards were given to ${card_receivers}.
                  The active players are ${activePlayers.map(player => player.playerName).join(', ')}.
                  The match digest is ${matchDigest}
                  ` 
                },
                { role: "user", content: chatInput }, // Use chatInput for the user's question
            ],
        });
        //console.log("completion.choices[0].message.content", completion.choices[0].message.content)
        res.json({ output: completion.choices[0].message.content });
    } catch (error) {
        console.error('Error querying OpenAI API:', error);
        res.status(500).json({ error: 'Error querying OpenAI API', details: error.message });
    }
});

app.get('/api/match-digest', async (req, res) => {
  res.json({ matchDigest: sessionData['matchDigest'] });
});

// Define the /api/sse endpoint
app.get('/api/sse-frames', (req, res) => {
    const { userId } = req.query; // Get user input for ID from query parameters
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    console.log("userId inside sse-frames", userId)

    const matchId = sessionData.users[userId]['fixtureId'];

    console.log("matchId inside sse-frames", matchId)
    if (!matchId) {
      return res.status(400).json({ error: 'Match ID is required.' });
    }

    // Note: a match-id: tournamentId-roundIndex-fixtureIndex
    const url_match_frames = `${matchEndpoint}/match_frames/${matchId}`;
    console.log("url_match_frames", url_match_frames)
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

        const userData = sessionData.users[userId]
        console.log("userData", userData)

        const { 
          homeTeamId, 
          homeTeamName, 
          awayTeamId, 
          awayTeamName, 
          homeTeamWins, 
          awayTeamWins
        } = userData;

        const teamNames = {
          [homeTeamId]: homeTeamName,
          [awayTeamId]: awayTeamName,
        };

        const sequentialEvents = data.map(event => {
          const teamName = teamNames[`${event.teamInPossession}`] || 'Unknown Team'; // Get team name or default to 'Unknown Team'
          return `
              Type: ${event.eventTypeAsString}, 
              Team: ${teamName}, 
              Player: ${event.playerInPossession}`;
        }).join('\n'); // Join with newlines for better readability

        console.log("sequentialEvents", sequentialEvents)

        const message = `   
                    digest this passage of play, abstracted from a football match into a coherent narrative:
                    ${sequentialEvents}. Insert the following context into the narrative:
                    The home team is ${homeTeamName} 
                    The away team is ${awayTeamName}
                    The home team has ${homeTeamWins} wins.
                    The away team has ${awayTeamWins} wins.
                    The team for which the number of wins is 1 is the winner of the match
                  ` 
        try {
          const completion = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [
                  { role: "system", content: message
                  }
              ],
          });
          console.log("TEST",completion.choices[0].message.content)

          sessionData['matchDigest'] = completion.choices[0].message.content;
          sessionData.users[userId]['matchDigest'] = completion.choices[0].message.content;
          console.log("digest over")
          //console.log("sessionData['matchDigest']", sessionData['matchDigest'])
        } catch (error) {
            console.error('Error querying OpenAI API:', error);
            res.status(500).json({ error: 'Error querying OpenAI API', details: error.message });
        }

        messageCount++; // Increment the message counter

        // Check if we have received two messages from the first endpoint
        if (messageCount >= 2) {
            eventSource.close(); // Close the EventSource connection
            res.end();
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
  const { userId } = req.query; // Get user input for ID from query parameters
  console.log("sse-partial", userId)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const matchId = sessionData['fixtureId'];

  if (!matchId) {
    return res.status(400).json({ error: 'Match ID is required.' });
  }

  const url_partial_match = `${matchEndpoint}/partial_match/${matchId}`;
  console.log("url_partial_match", url_partial_match)
  // Create an EventSource-like connection
  const eventSource = new EventSource(url_partial_match);
  let messageCount = 0; // Initialize a counter for received messages

  // The event source API allows a web applicato to receive real-time updates from a server via HTTP connections.
  eventSource.onmessage = async (event) => {
  const data = JSON.parse(event.data); // Parse the incoming JSON data

      if (data){
        sessionData['homeTeamWins'] = data.state.homeTeam.stats.wins
        //console.log(sessionData.users)
        sessionData.users[userId]['homeTeamWins'] = data.state.homeTeam.stats.wins
        sessionData['awayTeamWins'] = data.state.awayTeam.stats.wins
        sessionData.users[userId]['awayTeamWins'] = data.state.awayTeam.stats.wins

        const homeTeamId = data.state.homeTeam.clubId;
        const awayTeamId = data.state.awayTeam.clubId;

        sessionData['homeTeamId'] = homeTeamId;
        sessionData['awayTeamId'] = awayTeamId;
        sessionData.users[userId]['homeTeamId'] = homeTeamId;
        sessionData.users[userId]['awayTeamId'] = awayTeamId;


        const homeTeamResponse = await axios.get(`${apiEndpoint}/api/club?id=${homeTeamId}`);
        const homeTeamName = homeTeamResponse.data.clubs[0].name;

        const awayTeamResponse = await axios.get(`${apiEndpoint}/api/club?id=${awayTeamId}`);
        const awayTeamName = awayTeamResponse.data.clubs[0].name;

        sessionData['homeTeamName'] = homeTeamName;
        sessionData['awayTeamName'] = awayTeamName;
        sessionData.users[userId]['homeTeamName'] = homeTeamName;
        sessionData.users[userId]['awayTeamName'] = awayTeamName;

      }

      if (!data) {  // Check if the received data is falsey 
        messageCount++; // Increment the message counter
        return; // Exit the function if the data is an empty array
      }
      messageCount++; // Increment the message counter

      // record the number of goals and cards in the match
      let goals = [];
      let cards = [];

      // Assuming data.state.players is an array of player objects
      const players = data.state.players;
      for (const playerId of Object.keys(players)){
          const response = await axios.get(`${apiEndpoint}/api/player?playerId=${playerId}`);

          sessionData['activePlayers'].push(
            {
              "playerName": response.data.players[0].fullName,
              "playerId": playerId,
              "playerClub": response.data.players[0].club.id
            }
          )
          sessionData.users[userId]['activePlayers'].push(
            {
              "playerName": response.data.players[0].fullName,
              "playerId": playerId,
              "playerClub": response.data.players[0].club.id
            }
          )
      }

      for (const event of data.state.keyEvents) {
        let playerId = '';
        if (event.type == 2) {
          playerId = event.playerId;
        } else if (event.type == 0) {
          playerId = event.scorerPlayerId;
        }

        const response = await axios.get(`${apiEndpoint}/api/player?playerId=${playerId}`);
        const clubId = event.clubId;
        const clubResponse = await axios.get(`${apiEndpoint}/api/club?id=${clubId}`);
        const clubName = clubResponse.data.clubs[0].name;
        let playerName = '';
        if (response.data.players[0]) {
          playerName = response.data.players[0].fullName;
        } else {
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
      sessionData.users[userId]['goals'] = goals;
      sessionData.users[userId]['cards'] = cards;
      console.log("partial-end")
      //console.log("sessionData.users[userId]", sessionData.users[userId])
      // Send the received data to the client, which is part of the node.js response object
      res.write(`data: goals:\n\n ${JSON.stringify(goals)}\n\ncards:\n ${JSON.stringify(cards)}`); // Send valid data to the client

      // Check if we have received two messages from the first endpoint
      if (messageCount >= 2) {
          console.log('closing')
          eventSource.close(); // Close the EventSource connection
          res.end();
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

//Get a club by id
app.get('/api/recent-fixture', async (req, res) => {

  const clubId = req.query.clubId;

  const tournamentQuery = gql`
  query {
    clubs(where: {id: {equals: ${clubId}}}) {
      clubFixtures(
        orderBy: { fixtureId: desc }
        take: 23
      ) {
        fixture {
          tournamentId
          roundIndex
          fixtureIndex
        }
      }
    }
  }
  `; // Use dynamic ID in the query

  try {
      const tournamentData = await graphqlClient.request(tournamentQuery); // Use dynamic query    
      console.log("tournamentData", tournamentData.clubs[0].clubFixtures);

      // Loop through each fixture to construct matchId
      const validMatches = []; // Array to store valid matches
      const matchIds = await Promise.all(tournamentData.clubs[0].clubFixtures.map(async (fixture) => {
          const { tournamentId, roundIndex, fixtureIndex } = fixture.fixture; // Destructure the fixture object
          const matchId = `${tournamentId}-${roundIndex}-${fixtureIndex}`; // Construct matchId

          const dynamicQuery = gql`
          query {
            match(where: {id:"${matchId}"}) {
              id
            }
          }
          `;
          
          // Await the request to ensure it resolves before moving forward
          const matchDone = await graphqlClient.request(dynamicQuery);
          
          console.log("matchDone", matchDone);
          
          // Check if matchDone is valid (not null)
          if (matchDone && matchDone.match) {
              validMatches.push({ tournamentId, fixtureIndex, matchId }); // Store valid match details
          }
          
          return matchId; // Return the matchId after the request is resolved
      }));

      // Determine the valid match with the highest tournamentId and fixtureIndex
      if (validMatches.length > 0) {
          const highestMatch = validMatches.reduce((prev, current) => {
              // Compare tournamentId and fixtureIndex
              if (current.tournamentId > prev.tournamentId || 
                  (current.tournamentId === prev.tournamentId && current.fixtureIndex > prev.fixtureIndex)) {
                  return current; // Return the current match if it's higher
              }
              return prev; // Otherwise, return the previous match
          }); 

      console.log("Highest Valid Match:", highestMatch.matchId);
      res.json(`${highestMatch.matchId}`);
    } else {
        console.log("No valid matches found.");
    }
} catch (error) {
    console.error('Error fetching tournament data:', error);
}
});


app.get('/api/club-players-fixture', async (req, res) => {
  console.log("apiEndpoint", apiEndpoint)
  const { clubId, userId } = req.query;
  console.log("userId", userId)

  const matchResponse = await axios.get(`${apiEndpoint}/api/recent-fixture?clubId=${clubId}`);

  const matchId = matchResponse.data; // Adjust based on the actual response structure
  console.log("matchId", matchId)
  const clubPlayers = await axios.get(`${apiEndpoint}/api/club-players?id=${clubId}`);
  
  try {
    await axios.get(`${apiEndpoint}/api/set-fixture?id=${matchId}&userId=${userId}`);
    await axios.get(`${apiEndpoint}/api/match-context?userId=${userId}`);
  } catch (error) {
    console.error('Error querying API for player:', error);
    res.status(500).json({ error: 'Error querying API for player', details: error.message });
  }

  res.json({
    matchId: matchId, 
    clubPlayers: clubPlayers.data.clubs[0].registeredPlayers});
})

const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1]; // Get token from Authorization header
  console.log("TOKEN", token)

  if (!token) return res.sendStatus(401); // No token, unauthorized

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403); // Invalid token, forbidden
    req.user = user; // Save user info to request
    next(); // Proceed to the next middleware or route handler
  });
};

/*
// Endpoint to log user inputs
app.post('/api/log-input', async (req, res) => {
  let walletAddress = req.body.walletAddress
  let clubId = req.body.clubId
  let message = req.body.message

  try {

    const userInput = new UserInput({ walletAddress, clubId, message });
    await userInput.save(); // Save to the database
    console.log('User input logged:', userInput); // Log the saved input
    res.status(201).json({ message: 'User input logged successfully' });
  } catch (error) {
    console.error('Error logging user input:', error);
    res.status(500).json({ error: 'Error logging user input', details: error.message });
  }
});
*/

// Protect your API routes
app.use('/api', authenticateToken); // Apply the middleware to all routes starting with /api


// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
