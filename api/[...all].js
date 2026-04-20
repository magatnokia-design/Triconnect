const app = require('../server/src/app')
const createRealtimeServer = require('../server/src/sockets/createRealtimeServer')

const SOCKET_IO_PATH = process.env.SOCKET_IO_PATH || '/api/socket.io'
const SOCKET_CORS_ORIGIN = process.env.SOCKET_CORS_ORIGIN || '*'

module.exports = (req, res) => {
	const httpServer = res?.socket?.server

	if (httpServer && !httpServer.__triconnectRealtime) {
		httpServer.__triconnectRealtime = createRealtimeServer(httpServer, {
			corsOrigin: SOCKET_CORS_ORIGIN,
			path: SOCKET_IO_PATH,
		})
	}

	return app(req, res)
}
