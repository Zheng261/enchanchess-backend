var express = require('express');
var app = express();
const http = require('http');
const server = http.createServer(app);
const io = require('socket.io')(server);
// For reading JSON
const fs = require('fs');

const uuidv4 = require('uuid/v4');

const PORT = process.env.PORT || 8000	// server port

// Holds rooms
const roomIds = new Set()
// Maps room IDs to players, room creators, start status, etc. 
// Holds a dict for each room. Each dict contains "creators", "rooms","startStatus", etc..
const roomIdData = {}

// Shuffles Array
function shuffle(array) {
	array.sort(() => Math.random() - 0.5);
}

let rawCardData = fs.readFileSync('Cards/baseSet.json');
let cardJSON = JSON.parse(rawCardData);
blackCards = cardJSON["blackCards"]
whiteCards = cardJSON["whiteCards"]

app.get('/', (req, res) => {
//   res.send('<h1>Hello world</h1>');
	res.sendFile(__dirname + '/chatbox_temp.html');	//temp for testing chat
});


// joining unique room url
// debugging purposes
// use REST api to query data from db (if we even use db in the future, socket for multiplayer logic)
app.get("/rooms/:roomId", (req, res) => {
  // res.render("student", {room:req.params.roomId});
  // res.send(`<h1>Hello room id ${req.params.roomId}</h1>`);
  res.send(req.params)
  console.log(req.params)
})

io.on('connection', (socket) => { 
	console.log("client connected", socket.id)
	socket.on('test', test => {
		console.log("test worked!")
	})
	
	// called when a user wants to create a new room
	socket.on('createRoom', gameCreatorUser => {
		const id = uuidv4()
		const [ roomId ] = id.split('-').slice(-1)
		console.log("Room created with room ID ", roomId, " by user ", gameCreatorUser)
		// Adds room Id to array, adds data to stuff being held
		roomIds.add(roomId)
		roomIdData[roomId] = {}

		// Players will store usernames -- we will make sure users can't enter duplicate ones
		roomIdData[roomId]["Players"] = []

		// Creator will store one username -- we will make sure users can't enter duplicate ones
		roomIdData[roomId]["Creator"] = new Set()
		roomIdData[roomId]["PlayersToPoints"] = {}

		// All cards in center of board right now (player to card dict)
		roomIdData[roomId]["CardsInCenterToPlayers"] = {}

		// Keep track of who is czar
		roomIdData[roomId]["CzarIndex"] = 0

		// Current black card
		roomIdData[roomId]["CurrBlackCard"] = ""

		// Keep track of how many points to win
		// NOTE: WE MAY CHOOSE TO LET PEOPLE CHANGE THIS
		roomIdData[roomId]["PointsToWin"] = 10

		// All cards in circulation 
		roomIdData[roomId]["CardsInHandOrPlay"] = new Set()

		// Tracks host
		roomIdData[roomId]["Creator"] .add(gameCreatorUser)

		// Game has not started
		roomIdData[roomId]["Started"] = false

		// sends room id back to client
		socket.emit('dispatchRoomId', roomId)
		// Room creator now joins room at the same time as everyone else, don't uncomment
		//joinRoom(socket, roomId)
	})

	// called when a user wants to join a room with specified room id
	socket.on('joinRoom', msg => {
		joinRoom(socket, msg.roomId, msg.user)
		// THIS IS COMPLETELY REDUNDANT, JUST ADDING HERE IN CASE IT FIXES A DUMB BUG
	})

	// called when party leader wants to start game for everyone in the room
	socket.on('startGame', roomId =>{
		console.log('Signalling start game to ', roomId)
		console.log('Players in room :', roomIdData[roomId]["Players"])
		roomIdData[roomId]["Started"] = true
		shuffle(roomIdData[roomId]["Players"])

		// Draw a first black card and fix it for the room

		// At some point we should make sure that you can't draw the same black card within
		// like... 50 rounds?
		const randomBlackCard = blackCards[Math.floor(Math.random() * blackCards.length)];
		roomIdData[roomId]["CurrBlackCard"] = randomBlackCard
		

		// Tell everyone in our room there's a black card
		io.to(roomId).emit('drawBlackCardReply', roomIdData[roomId]["CurrBlackCard"])

		io.to(roomId).emit('gameStarted', true)
	})

	// Has the game started yet? This is a check that people do when they
	// enter a room for the first time, in case they arrived after game starting
	socket.on('checkStartGame', roomId =>{
		console.log(roomId, 'room is checking to see if game started. Status: ', roomIdData[roomId]["Started"])
		if (roomId in roomIdData) {
			console.log("Sending message to room...")
			io.to(roomId).emit('gameStarted', roomIdData[roomId]["Started"])
		} else {
			console.log("Want to send, but ", roomId, " roomId does not exist!")
		}
	})

	// Called when a user wants to draw a card
	socket.on('drawCard', roomId => {
		console.log("Drawn card for ", roomId)

		let randomCard = whiteCards[Math.floor(Math.random() * whiteCards.length)];

		// Draw again until we find one that's not in someone's hand lol
		while(randomCard in roomIdData[roomId]["CardsInHandOrPlay"]) {
			randomCard = whiteCards[Math.floor(Math.random() * whiteCards.length)];
		}

		// Appends card to cards drawn so far
		roomIdData[roomId]["CardsInHandOrPlay"].add(randomCard)
		socket.emit(('drawCardReply').concat(roomId), randomCard)
	})

	// Called when any user plays a card 
	socket.on('playCard', msg => {
		roomId = msg.roomId
		user = msg.user
		card = msg.card
		console.log("Played card ", card, " for ", roomId, " with user ", user)

		// Adds card to center, keeps track of which card is played by which user
		roomIdData[roomId]["CardsInCenterToPlayers"][card] = user

		// Array of cards players have played so far this round
		cardsSoFar = Object.keys(roomIdData[roomId]["CardsInCenterToPlayers"])

		if (cardsSoFar.length >= 
			roomIdData[roomId]["Players"].length-1)	{
			// Make it not predictable which cards are whose
			shuffle(cardsSoFar)
			// If we have enough cards in the center, automatically trigger card picking phase
			// Allows players to see all cards in center 
			io.to(roomId).emit('allowPickCards', cardsSoFar)
		} else {
			io.to(roomId).emit('playCardReply', cardsSoFar)
		}
	})

	socket.on('getCardCzar', roomId => {
		czarIndex = roomIdData[roomId]["CzarIndex"]
		// Which player is the czar?
		io.to(roomId).emit('getCardCzarReply', roomIdData[roomId]["Players"][czarIndex])
	});

	// Called when the czar picks a card, also contains logic for ending a round
	// and possibly ending the game
	socket.on('pickCard', msg => {
		roomId = msg.roomId
		user = msg.user
		card = msg.card
		czarIndex = roomIdData[roomId]["CzarIndex"]

		// Don't let non-czar pick the cards lol
		if (user != roomIdData[roomId]["Players"][czarIndex]){
			console.log("You are not the card Czar! >:(")
		} else {
			// Make sure that the right user is picking the card
			console.log(user, "Picked card ", card, " for ", roomId)
			
			// Keeps track of which card is played by which user
			winner = roomIdData[roomId]["CardsInCenterToPlayers"][card]
			
			// Keeps track of points
			roomIdData[roomId]["PlayersToPoints"][winner] += 1
			// Someone got a point, so let's tell the scoreboard for everyone to update
			io.to(roomId).emit('dispatchPlayerPoints', roomIdData[roomId]["PlayersToPoints"])

			// Adds info to data: card, winner, new points
			pickCardData = {card: card, winner: winner, newPoints: roomIdData[roomId]["PlayersToPoints"]}

			// Remove cards in center of board from play
			for (card in roomIdData[roomId]["CardsInCenterToPlayers"]) {
				roomIdData[roomId]["CardsInHandOrPlay"].delete(card)
			}

			// Resets cards in center of board 
			roomIdData[roomId]["CardsInCenterToPlayers"] = {}
			
			// Reply to room 
			io.to(roomId).emit('pickCardReply', pickCardData)

			// Is the game over? If so, tell the room
			if (roomIdData[roomId]["PlayersToPoints"][winner] >= 

				roomIdData[roomId]["PointsToWin"]) {
				// Sends last round's info: winning card, winner, #points
				// Might have edge case concerns with earlier reply to room thing, we'll see
				io.to(roomId).emit('gameOver', pickCardData)

			} else {
				// Advance who is the Czar
				czarIndex += 1
				// Mod by length of players 
				// For future when we allow players to be kicked: we will need to add edge cases
				// for when players are kicked while being the czar -- currently this would break
				// everything lol
				czarIndex = czarIndex % roomIdData[roomId]["Players"].length
				roomIdData[roomId]["CzarIndex"] = czarIndex

				// At some point we should make sure that you can't draw the same black card within
				// like... 50 rounds?
				const randomBlackCard = blackCards[Math.floor(Math.random() * blackCards.length)];
				roomIdData[roomId]["CurrBlackCard"] = randomBlackCard

				// Tell everyone in our room there's a new black card
				io.to(roomId).emit('drawBlackCardReply', roomIdData[roomId]["CurrBlackCard"])

				// Tell everyone in our room to update czar 
				io.to(roomId).emit('getCardCzarReply', roomIdData[roomId]["Players"][czarIndex])
			}
		}
		
	})

	// called at the start of a new round to draw new black card
	socket.on('drawBlackCard', roomId => {
		console.log("Black card for the room revealed for ", roomId)
		// reveals fixed black card from room
		io.to(roomId).emit('drawBlackCardReply', roomIdData[roomId]["CurrBlackCard"])
	})

	// return a list of players connected to the room
	socket.on('getPlayersInRoom', roomId => {
		const players = roomIdData[roomId]["Players"]
		io.to(roomId).emit('dispatchPlayers', players)
	})

	// return the list of player:point 
	socket.on('getPlayersPoints', roomId => {
		const playerPoints = roomIdData[roomId]["PlayersToPoints"]
		io.to(roomId).emit('dispatchPlayerPoints', playerPoints)
	})


	// testing disconnection (specifically for chatbox)
	socket.on('disconnect', roomId =>{
		console.log('client disconnected');
	})
	
	// called when user sends a message
	socket.on('sendChatMessage', (msg) => {
		io.emit(('RECEIVE_MESSAGE').concat(msg.roomId), msg);
		console.log('message: ', msg.message);
		console.log('roomId', msg.roomId)
	  });

});

/**
 * connects a socket to a specified room
 * @param {object} [socket] [a connected socket]
 * @param {object} [room] [object representing a room]
 */
const joinRoom = (socket, roomId, user) => {
  // If a user keeps the same but uses a different tab (socket), this will be fine
  socket.join(roomId, () => {
    console.log(`player ${socket.id} with username ${user} joined room ${roomId}`);
  });
  //var room = io.sockets.adapter.rooms[roomId];

  // Add player to ongoing list of players in this room -- if player is already in list
  // then this does nothing since it's a set
  if (roomId in roomIdData) {
	  if (!roomIdData[roomId]["Players"].includes(user)) {
		roomIdData[roomId]["Players"].push(user)
		// Initializes points to 0
		roomIdData[roomId]["PlayersToPoints"][user] = 0
	  }

	// Update number of players and player-points whenever someone joins!
	io.to(roomId).emit('dispatchPlayers', roomIdData[roomId]["Players"])
	// How many points do people have?
	io.to(roomId).emit('dispatchPlayerPoints', roomIdData[roomId]["PlayersToPoints"])

	// Logs data
	console.log("# ppl in room: ", roomIdData[roomId]["Players"].length)
  }
}

server.listen(PORT, () => {
	console.log(`Server is live on PORT:${PORT}`);
});

