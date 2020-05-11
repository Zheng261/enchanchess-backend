var express = require('express');
var app = express();
const http = require('http');
const server = http.createServer(app);
const io = require('socket.io')(server);

const uuidv4 = require('uuid/v4');

const PORT = process.env.PORT || 8000	// server port

const roomIds = new Set()

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
	socket.on('createRoom', () => {
		const id = uuidv4()
		const [ roomId ] = id.split('-').slice(-1)

		roomIds.add(roomId)
		// sends room id back to client
		socket.emit('dispatchRoomId', roomId)
		joinRoom(socket, roomId)
	})

	// called when a user wants to join a room with specified room id
	socket.on('joinRoom', roomId => {
		joinRoom(socket, roomId)
	})

	// return a list of players connected to the room
	socket.on('getPlayersInRoom', roomId => {
		const players = io.sockets.adapter.rooms[roomId];
		socket.emit('dispatchPlayers', players)
	})

	// called when party leader wants to start game for everyone in the room
	socket.on('startGame', roomId =>{
		io.to(roomId).emit('gameStarted', true)
	})

	// testing disconnection (specifically for chatbox)
	socket.on('disconnect', roomId =>{
		console.log('client disconnected');
	})
	
	// called when user sends a message
	socket.on('sendChatMessage', (msg) => {
		io.emit('RECEIVE_MESSAGE', msg);
		console.log('message: ', msg);
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

