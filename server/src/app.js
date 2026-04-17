const express = require('express')
const cors = require('cors')
const meetingsRoutes = require('./features/meetings/meetingsRoutes')
const adminRoutes = require('./features/admin/adminRoutes')

const app = express()

app.use(cors())
app.use(express.json())
app.use('/api/meetings', meetingsRoutes)
app.use('/api/admin', adminRoutes)

module.exports = app