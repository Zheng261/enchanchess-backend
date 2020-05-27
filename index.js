var express = require('express');
var cors = require('cors')

var app = express();
app.use(cors());
app.options('*', cors());
const http = require('https');
const server = http.createServer(app);

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

// // these rest api req are what is causing the cors!!!!!!
// app.get('/', cors(), (req, res) => {
// //   res.send('<h1>Hello world</h1>');
// 	res.sendFile(__dirname + '/chatbox_temp.html');	//temp for testing chat
// });


// // joining unique room url
// // debugging purposes
// // use REST api to query data from db (if we even use db in the future, socket for multiplayer logic)?????
// app.get("/rooms/:roomId", cors(), (req, res) => {
//   // res.render("student", {room:req.params.roomId});
//   // res.send(`<h1>Hello room id ${req.params.roomId}</h1>`);
//   res.send(req.params)
//   console.log(req.params)
// })

const io = require('socket.io')(server);


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
		roomIdData[roomId]["PlayersToHands"] = {}
		roomIdData[roomId]["PlayersToPoints"] = {}

		// All cards in center of board right now (player to card dict)
		roomIdData[roomId]["CardsInCenterToPlayers"] = {}

		// Keep track of who is czar
		roomIdData[roomId]["CzarIndex"] = 0

		// Assigns individual deck to room, shuffles decks to begin 
		roomIdData[roomId]["WhiteCardDeck"] = whiteCards
		shuffle(roomIdData[roomId]["WhiteCardDeck"])
		roomIdData[roomId]["BlackCardDeck"] = blackCards
		shuffle(roomIdData[roomId]["BlackCardDeck"])

		// Current black card
		roomIdData[roomId]["CurrBlackCard"] = ""

		// Keep track of how many points to win
		// NOTE: WE MAY CHOOSE TO LET PEOPLE CHANGE THIS
		roomIdData[roomId]["PointsToWin"] = 10
		// Keep track of how many cards to initially draw
		// NOTE: WE MAY CHOOSE TO LET PEOPLE CHANGE THIS
		roomIdData[roomId]["CardsToDraw"] = 7

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
	})

	// called when party leader wants to start game for everyone in the room
	// NOTE: ONE ISSUE IS THAT A LOT OF THESE DON'T REACH OTHER PLAYERS
	// BECAUSE THEIR COMPONENTS ARE NOT LOADED UNTIL AFTER THEY START THE GAME
	socket.on('startGame', roomId =>{
		// Adding condition in case two players try to start at the same time
		console.log(roomIdData[roomId]["Started"])
		if (!roomIdData[roomId]["Started"]) {
			console.log('Signalling start game to ', roomId)
			console.log('Players in room :', roomIdData[roomId]["Players"])
			roomIdData[roomId]["Started"] = true
			shuffle(roomIdData[roomId]["Players"])

			// Draw a first black card and fix it for the room
			const randomBlackCard = blackCards[Math.floor(Math.random() * blackCards.length)];
			roomIdData[roomId]["CurrBlackCard"] = randomBlackCard

			// Draw white cards and initialize hand state
			for (const player of roomIdData[roomId]["Players"]) {
	
				roomIdData[roomId]["PlayersToHands"][player] = []
				// Draw some number of cards for each player to start with 
				for (cardDrawNum = 0; cardDrawNum < roomIdData[roomId]["CardsToDraw"]; cardDrawNum++) {
					drawCard(roomId, player)
				}
				console.log("Sending ", ('drawCardReply').concat(player))
				io.to(roomId).emit(('drawCardReply').concat(player), roomIdData[roomId]["PlayersToHands"][player])
			}
			// Tell everyone in our room there's a black card
			io.to(roomId).emit('drawBlackCardReply', roomIdData[roomId]["CurrBlackCard"])
			handleBlackCardMaybePickMany(roomId, roomIdData[roomId]["CurrBlackCard"].pick)
			io.to(roomId).emit('allowChooseCards', roomIdData[roomId]["CurrBlackCard"].pick)
		}
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

	// Called when a user wants to find out what cards they've drawn
	socket.on('getDrawnCards', data => {
		roomId = data.roomId
		user = data.user
		// Replies with player's new hand 
		io.to(roomId).emit(('drawCardReply').concat(user), roomIdData[roomId]["PlayersToHands"][user])
	})

	// Called when a user wants to draw a card
	// (Not used right now)
	socket.on('drawCard', data => {
		roomId = data.roomId
		user = data.user
		// Draw white card
		drawCard(roomId, user)
		// Replies with player's new hand 
		io.to(roomId).emit(('drawCardReply').concat(user), roomIdData[roomId]["PlayersToHands"][user])
	})

	// Called when any user plays a card 
	socket.on('playCard', msg => {
		roomId = msg.roomId
		user = msg.user
		card = msg.card
		console.log("Played card ", card, " for ", roomId, " with user ", user)
		var data={  
			message : {author: "", 
						message: user + " played a card.",
						roomID: msg.roomId},  
			isUserUpdate : false  
		};  
		io.emit(('RECEIVE_MESSAGE').concat(roomId), data);

		// Adds card to center, keeps track of which card is played by which user
		roomIdData[roomId]["CardsInCenterToPlayers"][card] = user

		// Removes card from player's hand by value
		roomIdData[roomId]["PlayersToHands"][user] = 
			roomIdData[roomId]["PlayersToHands"][user].filter(function(value, index, arr){ return value != card;})

		// Array of cards players have played so far this round
		// Currently do not distinguish which cards were played by which players before czar is picked
		// even for pick-2's -- may need future fix for this!
		cardsSoFar = Object.keys(roomIdData[roomId]["CardsInCenterToPlayers"])

		// Make it not predictable which cards are whose
		shuffle(cardsSoFar)

		// If we've hit the number of cards picked * number of cards allowed to pick, let czar pick cards
		if (cardsSoFar.length >= 
			((roomIdData[roomId]["Players"]).length-1)*roomIdData[roomId]["CurrBlackCard"].pick)	{

			// Returns array of cards instead so peoples' cards are paired. Our goal is just to put
			// players cards next to each other. The front-end will assume every n conseq. cards
			// are mapped to the same player, where n is the # of cards to pick.
			let cardsSoFarPlayerGrouped = [];
			
			// O(n^2 because 10^2 is only 100 and who plays CAH with more than 10 people)
			// Keeps track of which players we've seen so far for pairing
			let playersSeenSoFar = [];
			// Cards so far just got shuffled, so user order is random
			for(card of cardsSoFar) {
				player =  roomIdData[roomId]["CardsInCenterToPlayers"][card]
				// If we've seen this player already, ignores the card
				if (!playersSeenSoFar.includes(player)) {
					for(card of cardsSoFar) {
						if (roomIdData[roomId]["CardsInCenterToPlayers"][card] == player) {
							cardsSoFarPlayerGrouped.push(card);
						}
					}
				    playersSeenSoFar.push(player);
				}
			}
			// If we have enough cards in the center, automatically trigger card picking phase.
			// Allows players to see all cards in center 
			io.to(roomId).emit('allowPickCards', {cards : cardsSoFarPlayerGrouped, pick : roomIdData[roomId]["CurrBlackCard"].pick});
		} else {
			io.to(roomId).emit('playCardReply', cardsSoFar);
			// Redundantly reminds people the # cards they can choose. Useful for people who are late to join
			io.to(roomId).emit('allowChooseCards', roomIdData[roomId]["CurrBlackCard"].pick)
		}
	})

	socket.on('getCardCzar', roomId => {
		czarIndex = roomIdData[roomId]["CzarIndex"]
		// Which player is the czar?
		io.to(roomId).emit('getCardCzarReply', roomIdData[roomId]["Players"][czarIndex])
		// Also gets card data for redundancy
		io.to(roomId).emit('drawBlackCardReply', roomIdData[roomId]["CurrBlackCard"])
		// Gets white cards too while we're at it, why not
		for (const player of roomIdData[roomId]["Players"]) {
			io.to(roomId).emit(('drawCardReply').concat(player), roomIdData[roomId]["PlayersToHands"][player])
		}	
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

			// Remove cards in center of board from play (cards in center to players is a dict)
			for (const card in roomIdData[roomId]["CardsInCenterToPlayers"]) {
				roomIdData[roomId]["CardsInHandOrPlay"].delete(card)
				// Adds it back to bottom of deck
				roomIdData[roomId]["WhiteCardDeck"].push(card)
			}

			// Resets cards in center of board 
			roomIdData[roomId]["CardsInCenterToPlayers"] = {}
			
			// Reply to room 
			io.to(roomId).emit('pickCardReply', pickCardData)
			var data={  
				message : {author: "", 
							message: user + ", the czar, picked the card \"" + card +"\" played by " + winner, 
							roomID: msg.roomId},  
				isUserUpdate : false  
			};  
			io.emit(('RECEIVE_MESSAGE').concat(roomId), data);

			// Is the game over? If so, tell the room
			if (roomIdData[roomId]["PlayersToPoints"][winner] >= 

				roomIdData[roomId]["PointsToWin"]) {
				// Sends last round's info: winning card, winner, #points
				// Might have edge case concerns with earlier reply to room thing, we'll see
				io.to(roomId).emit('gameOver', pickCardData)

			} else {
				// Draw a new white card for each player
				for (const player of roomIdData[roomId]["Players"]) {
					// Obviously besides the czar
					if (player != roomIdData[roomId]["Players"][czarIndex]) {
						drawCard(roomId, player)
					}
					io.to(roomId).emit(('drawCardReply').concat(player), roomIdData[roomId]["PlayersToHands"][player])
				}

				// Pushes current black card to end of deck
				roomIdData[roomId]["BlackCardDeck"].push(roomIdData[roomId]["CurrBlackCard"])

				// Draw next black card
				roomIdData[roomId]["CurrBlackCard"] = roomIdData[roomId]["BlackCardDeck"].shift()

				// Tell everyone in our room there's a black card (also done in czar for redundancy lol)
				io.to(roomId).emit('drawBlackCardReply', roomIdData[roomId]["CurrBlackCard"])

				// If we need players to pick a lot of cards, send message about it, make them draw more 
				handleBlackCardMaybePickMany(roomId, roomIdData[roomId]["CurrBlackCard"].pick)

				// Advance who is the Czar
				czarIndex += 1
				// Mod by length of players 
				// For future when we allow players to be kicked: we will need to add edge cases
				// for when players are kicked while being the czar -- currently this would break
				// everything lol
				czarIndex = czarIndex % roomIdData[roomId]["Players"].length
				roomIdData[roomId]["CzarIndex"] = czarIndex

				// Tell everyone in our room to update czar 
				io.to(roomId).emit('getCardCzarReply', roomIdData[roomId]["Players"][czarIndex])
				var data={  
					message : {author: "", 
								message: roomIdData[roomId]["Players"][czarIndex] + " is now czar.",
								roomID: msg.roomId},  
					isUserUpdate : false  
				};  
				io.emit(('RECEIVE_MESSAGE').concat(roomId), data);
				
				io.to(roomId).emit('allowChooseCards', roomIdData[roomId]["CurrBlackCard"].pick)
			}
		}
		
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
	
	// when user wants to leave a room
	socket.on('leaveRoom', ({ user, roomId }) => {
    console.log(`user ${socket.id} username ${user} leaving room`)

    // remove player from player array
    const index = roomIdData[roomId]["Players"].indexOf(user);
		roomIdData[roomId]["Players"].splice(index, 1);

		console.log(roomIdData[roomId]["PlayersToPoints"])

		// if the person who left is the czar, start a new round?
		
		// tell room that player left
	  socket.leave(roomId, () => {
			io.to(roomId).emit('dispatchPlayers', roomIdData[roomId]["Players"])
   		io.to(roomId).emit(`user ${socket.id} has left the room`);
  	});
  });

	// have player rejoin room after quitting one
	socket.on('rejoinRoom', ({ user, roomId }) => {
		console.log("trying to rejoin room as ", user)
		console.log(roomIdData[roomId]["PlayersToPoints"])

		// add player to players list (used for when player rejoins after quitting the game)
		if (!roomIdData[roomId]["Players"].includes(user)) {
			roomIdData[roomId]["Players"].push(user)
			io.to(roomId).emit('dispatchPlayers', roomIdData[roomId]["Players"])

			// redraw white cards 
			roomIdData[roomId]["PlayersToHands"][user] = []

			// Draw some number of cards for each player to start with 
			for (cardDrawNum = 0; cardDrawNum < roomIdData[roomId]["CardsToDraw"]; cardDrawNum++) {
				drawCard(roomId, user)
			}
			console.log("Sending ", ('drawCardReply').concat(user))
			io.to(roomId).emit(('drawCardReply').concat(user), roomIdData[roomId]["PlayersToHands"][user])
		}
	})

	// called when user sends a message
	socket.on('sendChatMessage', (msg) => {
		var data={  
			message : msg,  
			isUserUpdate : true  
		};  
		console.log("BACKEND", data);
		io.emit(('RECEIVE_MESSAGE').concat(msg.roomId), data);
	  });

});

// General card drawing function
const drawCard = (roomId, user) => {
	console.log("Drawn card in ", roomId, " for user ", user)
	let randomCard = roomIdData[roomId]["WhiteCardDeck"].shift()
	// Appends card to cards drawn so far, as well as to end of list of players' hand 
	roomIdData[roomId]["PlayersToHands"][user].push(randomCard)
	roomIdData[roomId]["CardsInHandOrPlay"].add(randomCard)
}

// Draws people cards if black card says pick 2 or more
const handleBlackCardMaybePickMany = (roomId, pick) => {
	if (pick < 2) {
		return
	}
	// Draw (pick - 1) cards before the round starts
	for (const player of roomIdData[roomId]["Players"]) {
		// Obviously besides the czar
		if (player != roomIdData[roomId]["Players"][czarIndex]) {
			for (cardDrawNum = 0; cardDrawNum < pick-1; cardDrawNum++) {
				drawCard(roomId, user)
			}
		}
		io.to(roomId).emit(('drawCardReply').concat(player), roomIdData[roomId]["PlayersToHands"][player])
	}
}

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
	  if (!roomIdData[roomId]["Players"].includes(user) && user !== null) {
			roomIdData[roomId]["Players"].push(user)

			// Initializes points to 0 
			const storedPlayers = Object.keys(roomIdData[roomId]["PlayersToPoints"])
			if (!storedPlayers.includes(user)) {
				roomIdData[roomId]["PlayersToPoints"][user] = 0
			}
			// If game started, we gotta draw this friend some cards!
			if (roomIdData[roomId]["Started"]) {
				roomIdData[roomId]["PlayersToHands"][user] = []
				// Draw some number of cards for each player to start with 
				for (cardDrawNum = 0; cardDrawNum < roomIdData[roomId]["CardsToDraw"]; cardDrawNum++) {
					drawCard(roomId, user)
				}
				io.to(roomId).emit(('drawCardReply').concat(user), roomIdData[roomId]["PlayersToHands"][user])
			}
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

