const http = require('http')
const app = require('./app')
const createRealtimeServer = require('./sockets/createRealtimeServer')

const server = http.createServer(app)
createRealtimeServer(server, {
  corsOrigin: process.env.SOCKET_CORS_ORIGIN || '*',
  path: process.env.SOCKET_IO_PATH || '/socket.io',
})

const PORT = process.env.PORT || 5000
server.listen(PORT, () => console.log(`Server running on port ${PORT}`))