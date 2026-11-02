// Regression tests may replace fetch with fixtures, but may never open a socket.
const net = require('node:net');
net.Socket.prototype.connect = function () {
  throw new Error('Network connections are forbidden in offline regression tests');
};
globalThis.fetch = async () => {
  throw new Error('Unmocked fetch is forbidden in offline regression tests');
};
