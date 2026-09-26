module.exports = {
    apps: [
        {
            name: "pulsebot",
            script: "./src/bot.js",
            instances: 1,
            autorestart: true,
            watch: false,
            // 200M used to restart the bot in the middle of normal work:
            // discord.js with its caches, the web API and a log analysis
            // (a whole WCL report is held in memory while it is analysed)
            // together sit well above that. 512M leaves headroom for those
            // peaks and still catches a real leak before it takes the host.
            max_memory_restart: "512M",
            // A plain `pm2 start ecosystem.config.js` (no --env) is how the
            // server gets started by hand, so the default is production. Dev
            // runs locally through `npm run dev` (nodemon) and never reads
            // this file; `--env development` is there for a pm2-managed dev box.
            env: {
                NODE_ENV: "production",
            },
            env_production: {
                NODE_ENV: "production",
            },
            env_development: {
                NODE_ENV: "development",
            },
            log_date_format: "YYYY-MM-DD HH:mm:ss Z",
            error_file: "./logs/error.log",
            out_file: "./logs/out.log",
            merge_logs: true,
            kill_timeout: 5000,
        },
    ],
};
