const path = require('node:path')

module.exports = {
  apps: [{
    name: 'insider-game',
    script: 'dist/index.js',
    cwd: path.join(__dirname, 'server'),
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
    },
    time: true,
  }],
}
