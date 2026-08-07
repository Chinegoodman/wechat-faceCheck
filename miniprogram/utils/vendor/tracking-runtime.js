const root = typeof globalThis !== 'undefined'
  ? globalThis
  : (typeof global !== 'undefined' ? global : Function('return this')())

if (!root.tracking) {
  root.tracking = {}
}

require('./tracking/tracking.js')
require('./tracking/face.js')

module.exports = root.tracking
