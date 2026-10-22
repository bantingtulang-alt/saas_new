// Event bus sederhana. Nanti Automation Engine cukup mendengarkan event di sini,
// mis. events.on('sale.created', handler).
const { EventEmitter } = require('events');
module.exports = new EventEmitter();
