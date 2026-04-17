const http = require('http')
const { Server } = require('socket.io')
const app = require('./app')

const server = http.createServer(app)
const io = new Server(server, {
  cors: { origin: '*' }
})

const setupQuizSocket = require('./sockets/quizSocket')
const setupMeetingSocket = require('./sockets/meetingSocket')
setupQuizSocket(io)
setupMeetingSocket(io)

const PORT = process.env.PORT || 5000
server.listen(PORT, () => console.log(`Server running on port ${PORT}`))