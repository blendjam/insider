module.exports = {
  apps: [
    {
      name: "insider",
      script: "/home/ubuntu/games/insider/index.cjs",
      cwd: "/home/ubuntu/games/insider/",

      instances: 1,
      exec_mode: "fork",

      autorestart: true,
      watch: false,

      max_memory_restart: "500M",

      env: {
        NODE_ENV: "production",
        PORT: 3001,
      },

      error_file: "/home/ubuntu/games/insider/logs/error.log",
      out_file: "/home/ubuntu/games/insider/logs/out.log",

      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
    },
  ],
};
