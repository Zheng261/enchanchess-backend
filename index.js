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
// Maps room IDs to players
const roomIdToPlayers = {}
// Maps room IDs to room creators (to track who can start game)
const roomIdToRoomCreators = {}

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

		roomIds.add(roomId)
		roomIdToPlayers[roomId] = new Set()
		roomIdToRoomCreators[roomId] = new Set()
		roomIdToRoomCreators[roomId].add(gameCreatorUser)

		// sends room id back to client
		socket.emit('dispatchRoomId', roomId)
		// Room creator now joins room at the same time as everyone else

		//joinRoom(socket, roomId)
	})

	// called when a user wants to join a room with specified room id
	socket.on('joinRoom', roomId => {
		joinRoom(socket, roomId)
	})

	// called when a user wants to draw a card
	socket.on('drawCard', roomId => {
		console.log("Drawn card for ", roomId)
		const randomCard = whiteCards[Math.floor(Math.random() * whiteCards.length)];
		socket.emit(('drawCardReply').concat(roomId), randomCard)
	})

	// called at the start of a new round to draw new black card
	socket.on('drawBlackCard', roomId => {
		console.log("Black card drawn for ", roomId)
		const randomBlackCard = blackCards[Math.floor(Math.random() * blackCards.length)];
		socket.emit(('drawBlackCardReply').concat(roomId), randomBlackCard)
	})

	// return a list of players connected to the room
	socket.on('getPlayersInRoom', roomId => {
		const players = io.sockets.adapter.rooms[roomId];
		socket.emit('dispatchPlayers', players)
	})

	// called when party leader wants to start game for everyone in the room
	socket.on('startGame', roomId =>{
		console.log('signalling start game to ', roomId)
		io.to(roomId).emit('gameStarted', true)
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
const joinRoom = (socket, roomId) => {
  socket.join(roomId, () => {
    console.log(`player ${socket.id} joined room ${roomId}`);
  });
  var room = io.sockets.adapter.rooms[roomId];
  // Add player to ongoing list of players in this room
  
  if (roomId in roomIdToPlayers) {
  	roomIdToPlayers[roomId].add(socket.id)
  }

  console.log("# ppl in room: ", room.length)
}

// todo: testing purposes delete after backend is setup
const testAPI = socket => {
  const response = "hello world";
  // Emitting a new message. Will be consumed by the client
  socket.emit("test", response);
};

server.listen(PORT, () => {
	console.log(`Server is live on PORT:${PORT}`);
});

