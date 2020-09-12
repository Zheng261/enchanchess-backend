
// For reading JSON
const fs = require('fs');

const uuidv4 = require('uuid/v4');

const PORT = process.env.PORT || 8000	// server port

var express = require('express');
var cors = require('cors')

var app = express();
app.use(cors());
// app.options('*', cors());
const http = require('http');

// // these rest api req are what is causing the cors!!!!!!
//app.get('/', cors(), (req, res) => {
//   res.send('<h1>Hello world</h1>');
   //res.sendFile(__dirname + '/chatbox_temp.html');	//temp for testing chat
//});
// // 
// // debugging purposes -- joining unique room url -- mostly legacy code
// // use REST api to query data from db (if we even use db in the future, socket for multiplayer logic)?????
// app.get("/rooms/:roomId", cors(), (req, res) => {
//   // res.render("student", {room:req.params.roomId});
//   // res.send(`<h1>Hello room id ${req.params.roomId}</h1>`);
//   res.send(req.params)
//   console.log(req.params)
// })
// var allowedOrigins = "http://localhost:3000:*, https://bestcah-web.herokuapp.com/:*, https://cahtime.com/:*, http://localhost:8000:*";
// const io = require('socket.io')(server, {origins: allowedOrigins});

const server = http.createServer(app);
const io = require('socket.io')(server)
const WHITE = "white";
const BLACK = "black";
// Holds rooms
const roomIds = new Set()
// Maps room IDs to players, room creators, start status, etc. 
// Holds a dict for each room. Each dict contains "creators", "rooms","startStatus", etc..
const roomIdData = {}

// Shuffles Array
function shuffle(array) {
	array.sort(() => Math.random() - 0.5);
}

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
		roomIdData[roomId]["Players"] = [];

		roomIdData[roomId]["PlayerToColor"] = {};
		roomIdData[roomId]["PlayerToRegArtifacts"] = {}
		roomIdData[roomId]["PlayerToQuestArtifacts"] = {}

		// Creator will store one username -- we will make sure users can't enter duplicate ones
		roomIdData[roomId]["Creator"] = new Set();
		roomIdData[roomId]["Creator"].add(gameCreatorUser);

		// Game has not started
		roomIdData[roomId]["Started"] = false

		// Adds in dummy user to save time for testing
		joinRoom(socket, roomId, "Boop");

		// sends room id back to client
		socket.emit('dispatchRoomId', roomId)
		// Room creator now joins room at the same time as everyone else, don't uncomment
		//joinRoom(socket, roomId)
	})

	// called when a user wants to join a room with specified room id
	// only allow 2 players
	socket.on('joinRoom', msg => {
		if (msg.roomId in roomIdData) {
			joinRoom(socket, msg.roomId, msg.user);
		}
	})

	// Called when party leader wants to start game for everyone in the room. Can only start with 2 people
	socket.on('startGame', roomId =>{
		if (roomId in roomIdData && !roomIdData[roomId]["Started"]) {
			if (roomIdData[roomId]["Players"].length < 2) {
				console.log("Room ", roomId, "has too few people to start.")
				return;
			}

			if (roomIdData[roomId]["Players"].length > 2) {
				console.log("Room ", roomId, "has too many people to start.")
				return;
			}

			if (Math.random() > 0.5) {
				roomIdData[roomId]["PlayerToColor"][roomIdData[roomId]["Players"][0]] = BLACK
				roomIdData[roomId]["PlayerToColor"][roomIdData[roomId]["Players"][1]] = WHITE
			} else {
				roomIdData[roomId]["PlayerToColor"][roomIdData[roomId]["Players"][0]] = BLACK
				roomIdData[roomId]["PlayerToColor"][roomIdData[roomId]["Players"][1]] = WHITE
			}

			roomIdData[roomId]["Started"] = true;
			console.log("Players in room : ", roomIdData[roomId]["Players"]);
			io.to(roomId).emit('gameStarted', roomIdData[roomId]["Started"])
		}
	})

	// Has the game started yet? This is a check that people do when they
	// enter a room for the first time, in case they arrived after game starting
	socket.on('checkStartGame', roomId =>{
		if (roomId in roomIdData) {
			console.log(roomId, 'room is checking to see if game started. Status: ', roomIdData[roomId]["Started"])
			io.to(roomId).emit('gameStarted', roomIdData[roomId]["Started"])
		} else {
			console.log("Want to send, but ", roomId, " roomId does not exist!")
		}
	})

	socket.on('checkIsPlayerInRoom', ({user, roomId}) => {
		if (roomIdData[roomId]["Players"].includes(user)) {
			console.log("emitting player IS IN ROOM");
			io.to(socket.id).emit('checkIsPlayerInRoom', {user:user});
		}
	});

	// return a list of players connected to the room
	socket.on('getPlayersInRoom', roomId => {
		const players = roomIdData[roomId]["Players"]
		io.to(roomId).emit('dispatchPlayers', players)
	}) 

	// testing disconnection (specifically for chatbox)
	socket.on('disconnect', roomId =>{
		console.log('client ', socket.id , ' disconnected from ', roomId);
	})
	
	// When user wants to leave a room
	socket.on('leaveRoom', ({ user, roomId }) => {
		console.log(`user ${socket.id} username ${user} leaving room`)

		// remove player from player array
		const index = roomIdData[roomId]["Players"].indexOf(user);
			roomIdData[roomId]["Players"].splice(index, 1);
			// tell room that player left
		socket.leave(roomId, () => {
				io.to(roomId).emit('dispatchPlayers', roomIdData[roomId]["Players"])
			io.to(roomId).emit(`user ${socket.id} has left the room`);
		});
	});

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

/**
 * connects a socket to a specified room
 * @param {object} [socket] [a connected socket]
 * @param {object} [room] [object representing a room]
 */
const TOO_MANY_PLAYERS_IN_ROOM = "2 players have already joined the room.";
const joinRoom = (socket, roomId, user) => {
	// User already in room
	if (roomIdData[roomId]["Players"].includes(user)) {
		// If a user keeps the same but uses a different tab (socket), this will be fine
		socket.join(roomId, () => {
			console.log(`player ${socket.id} with username ${user} rejoined room ${roomId}`);
		  });
		io.to(socket.id).emit("joinRoom", {user: user, errorMessage:""});
		return;
	}
	// Too many people in room
   if (roomIdData[roomId]["Players"].length > 2) {
		console.log("There are too many people in the room.");
		io.to(socket.id).emit("joinRoom", {user: user, errorMessage:TOO_MANY_PLAYERS_IN_ROOM});
		return;
    }

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
	  }

	// Update number of players whenever someone joins!
	io.to(roomId).emit('dispatchPlayers', roomIdData[roomId]["Players"])
	io.to(socket.id).emit("joinRoom", {user: user, errorMessage:""});
	// Logs data
	console.log("# ppl in room: ", roomIdData[roomId]["Players"].length)
  }
}

server.listen(PORT, () => {
	console.log(`Server is live on PORT:${PORT}`);
});

