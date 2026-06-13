module.exports = {
    apps: [
        {
            name: "eventhelper",
            script: "./src/bot.js",
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: "200M",
            env: {
                NODE_ENV: "development",
            },
            env_production: {
                NODE_ENV: "production",
            },
            log_date_format: "YYYY-MM-DD HH:mm:ss Z",
            error_file: "./logs/error.log",
            out_file: "./logs/out.log",
            merge_logs: true,
            kill_timeout: 5000,
        },
    ],
};
