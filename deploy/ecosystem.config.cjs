module.exports = {
  apps: [
    {
      name: 'kurs-ai',
      script: 'server.js',
      cwd: '/var/www/kurs.neeklo.ru',
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3210,
      },
    },
  ],
};
