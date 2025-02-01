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
  try {
    res.json({ message: 'match context set successfully' });
    axios.get(`http://localhost:5000/api/sse-partial`)
      .then(response => {
        return axios.get(`http://localhost:5000/api/sse-frames`);
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
    const { playerName, playerId, chatInput } = req.body; // Destructure playerName and chatInput from the request body
    const { goals, cards, activePlayers, matchDigest, homeTeamWins, awayTeamWins } = sessionData;

    const numberOfGoals = goals.length;
    const numberOfCards = cards.length;
    const numberOfActivePlayers = activePlayers.length;
    console.log('activePlayers',activePlayers)

    console.log("numberOfActivePlayers", numberOfActivePlayers)
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
    const playerContext = await axios.get(`http://localhost:5000/api/player?playerId=${playerId}`);
    console.log("playerContext", playerContext.data)


    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: ` 
                  You are a football player named ${playerName} and you have just finished a match. 
                  You are now going to answer a series of questions about the match.
                  You are extremely irritable.

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
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const matchId = sessionData['fixtureId'];
    if (!matchId) {
      return res.status(400).json({ error: 'Match ID is required.' });
    }

    // Note: a match-id: tournamentId-roundIndex-fixtureIndex
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

        const { 
          homeTeamId, 
          homeTeamName, 
          awayTeamId, 
          awayTeamName, 
          homeTeamWins, 
          awayTeamWins
        } = sessionData;

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
          sessionData['matchDigest'] = completion.choices[0].message.content;
          //console.log("sessionData['matchDigest']", sessionData['matchDigest'])
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

      // Assuming data.state.players is an array of player objects
      const players = data.state.players;
      for (const playerId of Object.keys(players)){
        const response = await axios.get(`http://localhost:5000/api/player?playerId=${playerId}`);
        console.log("player-context",response.data.players[0])
          sessionData['activePlayers'].push(
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

        const response = await axios.get(`http://localhost:5000/api/player?playerId=${playerId}`);
        const clubId = event.clubId;
        const clubResponse = await axios.get(`http://localhost:5000/api/club?id=${clubId}`);
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

      // Send the received data to the client, which is part of the node.js response object
      res.write(`data: goals:\n\n ${JSON.stringify(goals)}\n\ncards:\n ${JSON.stringify(cards)}`); // Send valid data to the client

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

//Get a club by id
app.get('/api/recent-fixture', async (req, res) => {

  const clubId = req.query.clubId;

  const tournamentQuery = gql`
  query {
    clubs(where: {id: {equals: ${clubId}}}) {
      clubFixtures(
        orderBy: { fixtureId: desc }
        take: 1
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
      const fixture = tournamentData.clubs[0].clubFixtures[0].fixture
      const tournamentId = fixture.tournamentId
      const roundIndex = fixture.roundIndex
      const fixtureIndex = fixture.fixtureIndex
      const matchId = tournamentId+"-"+roundIndex+"-"+fixtureIndex

      res.json(matchId);
  } catch (error) {
      console.error('Error querying GraphQL API:', error);
      res.status(500).json({ error: 'Error querying GraphQL API', details: error.message });
  }
});


app.get('/api/club-players-fixture', async (req, res) => {
  
  const clubId = req.query.clubId;

  const matchResponse = await axios.get(`http://localhost:5000/api/recent-fixture?clubId=${clubId}`);
  const matchId = matchResponse.data; // Adjust based on the actual response structure

  const clubPlayers = await axios.get(`http://localhost:5000/api/club-players?id=${clubId}`);
  
  await axios.get(`http://localhost:5000/api/set-fixture?id=${matchId}`);

  await axios.get(`http://localhost:5000/api/match-context`);

  res.json({
    matchId: matchId, 
    clubPlayers: clubPlayers.data.clubs[0].registeredPlayers});
})

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
