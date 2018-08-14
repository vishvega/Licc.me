const fs = require("fs");
const http = require("http");
const path = require("path");
const url = require("url");
const querystring = require("querystring");
const mimes = require("mimes.js");
const channel = require("class/channel.js");
const cookie = require("class/cookie.js");
const log = require("class/log.js");
const Session = require("class/session.js");
const WebSocket = require("ws");
WebSocket.prototype.rateLimit = function() {
    if (!this.date || Math.floor((Date.now() - this.date) / 1000) > 10) {
        this.date = Date.now();
        this.count = 1;
    } else {
        this.count++;
    }

    return this.count <= 10;
}

const channels = {
    dm: new Map(),
    pending: new Map(),
    guild: new Map()
}
const users = new Map();
channels.dm.set(channel.EVERYONE, new Set());

const chat = new WebSocket.Server({
    host: "127.0.0.1",
    port: 3333,
    maxPayload: 8192
});

http.createServer(async (req, res) => {
    const parsedURL = url.parse(path.normalize(req.url).replace(/^(\.\.[\/\\]+)/, ""));

    if (req.method === "GET") {
        if (parsedURL.pathname === "/") {
            const session = new Session(cookie.parse(req.headers.cookie, "token"));
            res.writeHead(200, {
                "Content-Type": "text/html"
            });

            if (await session.set()) {
                fs.createReadStream("index.html", "utf8").pipe(res);
            } else {
                fs.createReadStream("login.html", "utf8").pipe(res);
            }
        } else if (parsedURL.pathname === "/messages/channels") {
            const session = new Session(cookie.parse(req.headers.cookie, "token"));

            res.writeHead(200, {
                "Content-Type": "application/json"
            });
            res.end(JSON.stringify(await require("messages/channels.js")(session, querystring.parse(parsedURL.query))));
        } else if (parsedURL.pathname === "/messages/guilds") {
            const session = new Session(cookie.parse(req.headers.cookie, "token"));

            res.writeHead(200, {
                "Content-Type": "application/json"
            });
            res.end(JSON.stringify(await require("messages/guilds.js")(session, querystring.parse(parsedURL.query))));
        } else if (parsedURL.pathname === "/logout") {
            const token = cookie.parse(req.headers.cookie, "token");

            if (token !== null) {
                const session = new Session(token);
                await session.set();
                await session.destroy();

                res.writeHead(200, {
                    "Content-Type": "application/json",
                    "Set-Cookie": `token=; Max-Age=-1; Path=/; HttpOnly`
                });
                res.end(JSON.stringify({
                    status: true
                }));
            } else {
                res.writeHead(404, {
                    "Content-Type": "text/html"
                });
                fs.createReadStream("404.html", "utf8").pipe(res);
            }
        } else {
            try {
                const pathname = `public/${parsedURL.pathname.substr(1)}`;
                const stats = fs.statSync(pathname);
                if (stats.isFile()) {
                    const extension = parsedURL.pathname.substr(parsedURL.pathname.lastIndexOf(".") + 1);
                    const range = req.headers.range;

                    if (range) {
                        const filesize = stats.size;
                        const parts = range.replace(/bytes=/, "").split("-");
                        const start = parseInt(parts[0], 10);
                        const end = parts[1] ? parseInt(parts[1], 10) : filesize - 1;
                        const chunksize = (end - start) + 1;
                        res.writeHead(206, {
                            "Content-Range": `bytes ${start}-${end}/${filesize}`,
                            "Accept-Ranges": "bytes",
                            "Content-Length": chunksize,
                            "Content-Type": mimes[extension],
                        });
                        fs.createReadStream(pathname, {start, end}).pipe(res);
                    } else {
                        res.writeHead(200, {
                            "Content-Type": mimes[extension] || "application/octet-stream",
                            "Cache-Control": "max-age=3600"
                        });
                        fs.createReadStream(pathname).pipe(res);
                    }
                } else {
                    res.writeHead(404, {
                        "Content-Type": "text/html"
                    });
                    fs.createReadStream("404.html", "utf8").pipe(res);
                }
            } catch (error) {
                res.writeHead(404, {
                    "Content-Type": "text/html"
                });
                fs.createReadStream("404.html", "utf8").pipe(res);
            }
        }
    } else if (req.method === "POST") {
        let message = "";
        req.setEncoding("utf8");
        req.on("data", chunk => {
            message += chunk;
        });

        req.on("end", async () => {
            try {
                if (message !== "") {
                    message = JSON.parse(message);
                }

                const pathname = parsedURL.pathname.substr(1).split("/");
                const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
                const session = new Session(cookie.parse(req.headers.cookie, "token"));

                switch (pathname[0]) {
                    case "attachment":
                    {
                        if (pathname[1] === "channels") {
                            let response = await require("attachment/channels.js")(session, querystring.parse(parsedURL.query), message);

                            if (response.status) {
                                const set = channels.dm.get(response.channel_id);

                                if (set !== undefined) {
                                    response = JSON.stringify(response);

                                    for (const client of set) {
                                        if (client.readyState === WebSocket.OPEN) {
                                            client.send(response);
                                        } else {
                                            set.delete(client);
                                        }
                                    }
                                }

                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify({
                                    status: true
                                }));
                            } else {
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify(response));
                            }
                        } else if (pathname[1] === "guilds") {
                            let response = await require("attachment/guilds.js")(session, querystring.parse(parsedURL.query), message);

                            if (response.status) {
                                const set = channels.guild.get(response.channel_id);

                                if (set !== undefined) {
                                    response = JSON.stringify(response);

                                    for (const client of set) {
                                        if (client.readyState === WebSocket.OPEN) {
                                            client.send(response);
                                        } else {
                                            set.delete(client);
                                        }
                                    }
                                }

                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify({
                                    status: true
                                }));
                            } else {
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify(response));
                            }
                        } else {
                            res.writeHead(404, {
                                "Content-Type": "application/json"
                            });
                            fs.createReadStream("404.html", "utf8").pipe(res);
                        }
                    }
                    break;
                    case "auth":
                    {
                        if (pathname[1] === "login") {
                            if (await log.read(ip, "login")) {
                                let response = await require("auth/login.js")(session, message);

                                if (!response.status) {
                                    log.write(ip, "login");
                                }
                                if (response.token) {
                                    res.setHeader("Set-Cookie", `token=${response.token}; Max-Age=604800; Path=/; HttpOnly`);
                                    delete response.token;
                                }

                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify(response));
                            } else {
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify({
                                    status: false,
                                    error: "Too many attempts! Try again later"
                                }));
                            }
                        } else if (pathname[1] === "signup") {
                            if (await log.read(ip, "signup")) {
                                let response = await require("auth/signup.js")(session, message);

                                if (response.status) {
                                    log.write(ip, "signup");
                                }
                                if (response.token) {
                                    res.setHeader("Set-Cookie", `token=${response.token}; Max-Age=604800; Path=/; HttpOnly`);
                                    delete response.token;
                                }
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify(response));
                            } else {
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify({
                                    status: false,
                                    error: "Account limit reached! Try again later"
                                }));
                            }
                        } else {
                            res.writeHead(404, {
                                "Content-Type": "application/json"
                            });
                            fs.createReadStream("404.html", "utf8").pipe(res);
                        }
                    }
                    break;
                    case "change":
                    {
                        if (pathname[1] === "password" || pathname[1] === "username") {
                            res.writeHead(200, {
                                "Content-Type": "application/json"
                            });
                            res.end(JSON.stringify(await require(`change/${pathname[1]}.js`)(session, message)));
                        } else {
                            res.writeHead(404, {
                                "Content-Type": "text/html"
                            });
                            fs.createReadStream("404.html", "utf8").pipe(res);
                        }
                    }
                    break;
                    case "delete":
                    {
                        if (pathname[1] === "guild") {
                            let response = await require("delete/guild.js")(session, querystring.parse(parsedURL.query));

                            if (response.status) {
                                const set = channels.guild.get(response.channels[0]);

                                for (const channel_id of response.channels) {
                                    channels.guild.delete(channel_id);
                                }

                                delete response.channels;

                                if (set !== undefined) {
                                    response = JSON.stringify(response);
                                    for (const client of set) {
                                        if (client.readyState === WebSocket.OPEN) {
                                            client.send(response);
                                        }
                                    }
                                }

                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify({
                                    status: true
                                }));
                            } else {
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify(response));
                            }
                        } else if (pathname[1] === "channel") {
                            let response = await require("delete/channel.js")(session, querystring.parse(parsedURL.query));

                            if (response.status) {
                                const set = channels.guild.get(response.channel_id);

                                if (set !== undefined) {
                                    response = JSON.stringify(response);

                                    for (const client of set) {
                                        if (client.readyState === WebSocket.OPEN) {
                                            client.send(response);
                                        } else {
                                            set.delete(client);
                                        }
                                    }
                                    channels.guild.delete(response.channel_id);
                                }

                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify({
                                    status: true
                                }));
                            } else {
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify(response));
                            }
                        } else if (pathname[1] === "emoji") {
                            let response = await require("delete/emoji.js")(session, querystring.parse(parsedURL.query));

                            if (response.access) {
                                const set = channels.guild.get(response.access);
                                delete response.access;

                                if (set !== undefined) {
                                    response = JSON.stringify(response);

                                    for (const client of set) {
                                        if (client.readyState === WebSocket.OPEN) {
                                            client.send(response);
                                        } else {
                                            set.delete(client);
                                        }
                                    }

                                    res.writeHead(200, {
                                        "Content-Type": "application/json"
                                    });
                                    res.end(response);
                                } else {
                                    res.writeHead(200, {
                                        "Content-Type": "application/json"
                                    });
                                    res.end(JSON.stringify(response));
                                }
                            } else {
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify(response));
                            }
                        } else {
                            res.writeHead(404, {
                                "Content-Type": "text/html"
                            });
                            fs.createReadStream("404.html", "utf8").pipe(res);
                        }
                    }
                    break;
                    case "invites":
                    {
                        if (pathname[1] === "join") {
                            let response = await require("invites/join.js")(session, message);

                            if (response.status) {
                                const set = users.get(session.user_id);

                                if (set !== undefined) {
                                    const guild_channels = response.guild.channels;
                                    response = JSON.stringify(response);

                                    for (const client of set) {
                                        if (client.readyState === WebSocket.OPEN) {
                                            for (const guild_channel of guild_channels) {
                                                if (!channels.guild.has(guild_channel.id)) {
                                                    channels.guild.set(guild_channel.id, new Set());
                                                }
                                                channels.guild.get(guild_channel.id).add(client);
                                            }
                                            client.send(response);
                                        } else {
                                            set.delete(client);
                                        }
                                    }
                                }

                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify({
                                    status: true
                                }));
                            } else {
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify(response));
                            }
                        } else if (pathname[1] === "delete" || pathname[1] === "get" || pathname[1] === "join" || pathname[1] === "new") {
                            res.writeHead(200, {
                                "Content-Type": "application/json"
                            });
                            res.end(JSON.stringify(await require(`invites/${pathname[1]}.js`)(session, message)));
                        } else {
                            res.writeHead(404, {
                                "Content-Type": "text/html"
                            });
                            fs.createReadStream("404.html", "utf8").pipe(res);
                        }
                    }
                    break;
                    case "leave":
                    {
                        if (pathname[1] === "guild") {
                            let response = await require("leave/guild.js")(session, querystring.parse(parsedURL.query));

                            if (response.status) {
                                const set = users.get(session.user_id);

                                if (set !== undefined) {
                                    const channel_ids = response.channels;
                                    delete response.channels;
                                    response = JSON.stringify(response);

                                    for (const client of set) {
                                        for (const channel_id of channel_ids) {
                                            channels.guild.get(channel_id).delete(client);
                                        }
                                        if (client.readyState === WebSocket.OPEN) {
                                            client.send(response);
                                        } else {
                                            set.delete(client);
                                        }
                                    }
                                }

                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify({
                                    status: true
                                }));
                            } else {
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify(response));
                            }
                        } else {
                            res.writeHead(404, {
                                "Content-Type": "text/html"
                            });
                            fs.createReadStream("404.html", "utf8").pipe(res);
                        }
                    }
                    break;
                    case "new":
                    {
                        if (pathname[1] === "guild") {
                            let response = await require("new/guild.js")(session, message);

                            if (response.status) {
                                channels.guild.set(response.guild.channels[0].id, new Set());
                                const set = users.get(session.user_id);

                                if (set !== undefined) {
                                    const substitute = channels.guild.get(response.guild.channels[0].id);
                                    response = JSON.stringify(response);

                                    for (const client of set) {
                                        if (client.readyState === WebSocket.OPEN) {
                                            substitute.add(client);
                                            client.send(response);
                                        } else {
                                            set.delete(client);
                                        }
                                    }
                                }

                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify({
                                    status: true
                                }));
                            } else {
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify(response));
                            }
                        } else if (pathname[1] === "channel") {
                            let response = await require("new/channel.js")(session, querystring.parse(parsedURL.query), message);

                            if (response.status) {
                                channels.guild.set(response.channel.id, new Set());
                                const substitute = channels.guild.get(response.channel.id);
                                const set = channels.guild.get(response.access);
                                delete response.access;

                                if (set !== undefined) {
                                    response = JSON.stringify(response);

                                    for (const client of set) {
                                        if (client.readyState === WebSocket.OPEN) {
                                            substitute.add(client);
                                            client.send(response);
                                        } else {
                                            set.delete(client);
                                        }
                                    }
                                }

                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify({
                                    status: true
                                }));
                            } else {
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify(response));
                            }
                        } else if (pathname[1] === "emoji") {
                            let response = await require("new/emoji.js")(session, querystring.parse(parsedURL.query), message);

                            if (response.status) {
                                if (response.access) {
                                    const set = channels.guild.get(response.access);
                                    delete response.access;

                                    if (set !== undefined) {
                                        response = JSON.stringify(response);

                                        for (const client of set) {
                                            if (client.readyState === WebSocket.OPEN) {
                                                client.send(response);
                                            } else {
                                                set.delete(client);
                                            }
                                        }

                                        res.writeHead(200, {
                                            "Content-Type": "application/json"
                                        });
                                        res.end(response);
                                    } else {
                                        res.writeHead(200, {
                                            "Content-Type": "application/json"
                                        });
                                        res.end(JSON.stringify(response));
                                    }
                                } else {
                                    res.writeHead(200, {
                                        "Content-Type": "application/json"
                                    });
                                    res.end(JSON.stringify(response));
                                }
                            } else {
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify(response));
                            }
                        } else {
                            res.writeHead(404, {
                                "Content-Type": "text/html"
                            });
                            fs.createReadStream("404.html", "utf8").pipe(res);
                        }
                    }
                    break;
                    case "update":
                    {
                        if (pathname[1] === "guild") {
                            let response = await require("update/guild.js")(session, querystring.parse(parsedURL.query), message);

                            if (response.status) {
                                const set = channels.guild.get(response.access);
                                const icon = response.guild.icon;
                                delete response.access;

                                if (set !== undefined) {
                                    response = JSON.stringify(response);

                                    for (const client of set) {
                                        if (client.readyState === WebSocket.OPEN) {
                                            client.send(response);
                                        } else {
                                            set.delete(client);
                                        }
                                    }
                                }

                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify({
                                    status: true,
                                    icon: icon
                                }));
                            } else {
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify(response));
                            }
                        } else if (pathname[1] === "channel") {
                            let response = await require("update/channel.js")(session, querystring.parse(parsedURL.query), message);

                            if (response.status) {
                                const set = channels.guild.get(response.channel.id);

                                if (set !== undefined) {
                                    response = JSON.stringify(response);

                                    for (const client of set) {
                                        if (client.readyState === WebSocket.OPEN) {
                                            client.send(response);
                                        } else {
                                            set.delete(client);
                                        }
                                    }
                                }

                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify({
                                    status: true
                                }));
                            } else {
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify(response));
                            }
                        } else if (pathname[1] === "emoji") {
                            let response = await require("update/emoji.js")(session, querystring.parse(parsedURL.query), message);

                            res.writeHead(200, {
                                "Content-Type": "application/json"
                            });
                            res.end(JSON.stringify(response));
                        } else {
                            res.writeHead(404, {
                                "Content-Type": "text/html"
                            });
                            fs.createReadStream("404.html", "utf8").pipe(res);
                        }
                    }
                    break;
                    case "upload":
                    {
                        if (pathname[1] === "avatar") {
                            res.writeHead(200, {
                                "Content-Type": "application/json"
                            });
                            res.end(JSON.stringify(await require("upload/avatar.js")(session, message)));
                        } else {
                            res.writeHead(404, {
                                "Content-Type": "text/html"
                            });
                            fs.createReadStream("404.html", "utf8").pipe(res);
                        }
                    }
                    break;
                    case "users":
                    {
                        if (pathname[1] === "accept") {
                            let response = await require("users/accept.js")(session, querystring.parse(parsedURL.query));

                            if (response.status) {
                                const { channel_id } = response;
                                channels.dm.set(channel_id, new Set());

                                const substitute = channels.dm.get(channel_id);
                                const set = channels.pending.get(channel_id);

                                if (set !== undefined) {
                                    response = JSON.stringify(response);

                                    for (const client of set) {
                                        if (client.readyState === WebSocket.OPEN) {
                                            substitute.add(client);
                                            client.send(response);
                                        } else {
                                            set.delete(client);
                                        }
                                    }
                                    channels.pending.delete(channel_id);
                                }

                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify({
                                    status: true
                                }));
                            } else {
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify(response));
                            }
                        } else if (pathname[1] === "cancel") {
                            let response = await require("users/cancel.js")(session, querystring.parse(parsedURL.query));

                            if (response.status) {
                                const { channel_id } = response;
                                const set = channels.pending.get(channel_id);

                                if (set !== undefined) {
                                    response = JSON.stringify(response);

                                    for (const client of set) {
                                        if (client.readyState === WebSocket.OPEN) {
                                            client.send(response);
                                        } else {
                                            set.delete(client);
                                        }
                                    }
                                    channels.pending.delete(channel_id);
                                }

                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify({
                                    status: true
                                }));
                            } else {
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify(response));
                            }
                        } else if (pathname[1] === "friend") {
                            let response = await require("users/friend.js")(session, message);

                            if (response.status) {
                                if (!channels.pending.has(response.client.channel.id)) {
                                    channels.pending.set(response.client.channel.id, new Set());
                                }
                                const pending = channels.pending.get(response.client.channel.id);
                                const clients = users.get(session.user_id);
                                const recipients = users.get(response.client.channel.recipient.id);

                                if (clients) {
                                    response.client = JSON.stringify(response.client);

                                    for (const client of clients) {
                                        if (client.readyState === WebSocket.OPEN) {
                                            pending.add(client);
                                            client.send(response.client);
                                        } else {
                                            clients.delete(client);
                                        }
                                    }
                                }

                                if (recipients) {
                                    response.recipient = JSON.stringify(response.recipient);

                                    for (const client of recipients) {
                                        if (client.readyState === WebSocket.OPEN) {
                                            pending.add(client);
                                            client.send(response.recipient);
                                        } else {
                                            recipients.delete(client);
                                        }
                                    }
                                }

                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify({
                                    status: true
                                }));
                            } else {
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify(response));
                            }
                        } else {
                            res.writeHead(404, {
                                "Content-Type": "text/html"
                            });
                            fs.createReadStream("404.html", "utf8").pipe(res);
                        }
                    }
                    break;
                    default:
                    {
                        res.writeHead(404, {
                            "Content-Type": "text/html"
                        });
                        fs.createReadStream("404.html", "utf8").pipe(res);
                    }
                }
            } catch (error) {
                res.writeHead(404, {
                    "Content-Type": "text/html"
                });
                fs.createReadStream("404.html", "utf8").pipe(res);
            }
        });
    } else {
        res.end();
    }
}).listen(1337, "127.0.0.1");

chat.on("connection", (ws, req) => {
    ws.session = new Session(cookie.parse(req.headers.cookie, "token"));
    ws.on("message", async message => {
        try {
            message = JSON.parse(message);

            switch (message.type) {
                case "DM_MESSAGE":
                {
                    if (ws.hello && ws.rateLimit()) {
                        let response = await require("send/channels.js")(ws.session, message);

                        if (response.status) {
                            const set = channels.dm.get(response.channel_id);
                            response = JSON.stringify(response);

                            for (const client of set) {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(response);
                                } else {
                                    set.delete(client);
                                }
                            }
                        } else {
                            ws.send(JSON.stringify(response));
                        }
                    } else {
                        ws.terminate();
                    }
                }
                break;
                case "TEXT_MESSAGE":
                {
                    if (ws.hello && ws.rateLimit()) {
                        let response = await require("send/guilds.js")(ws.session, message);

                        if (response.status) {
                            const set = channels.guild.get(response.channel_id);
                            response = JSON.stringify(response);

                            for (const client of set) {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(response);
                                } else {
                                    set.delete(client);
                                }
                            }
                        } else {
                            ws.send(JSON.stringify(response));
                        }
                    } else {
                        ws.terminate();
                    }
                }
                break;
                case "TYPING":
                {
                    if (ws.hello && channel.isValidId(message.channel_id)) {
                        const set = channels.dm.get(message.channel_id) || channels.guild.get(message.channel_id);

                        if (set !== undefined && set.has(ws)) {
                            const response = JSON.stringify({
                                status: true,
                                type: "TYPING",
                                channel_id: message.channel_id,
                                username: ws.session.username
                            });

                            for (const client of set) {
                                if (client.readyState === WebSocket.OPEN) {
                                    if (client !== ws) {;
                                        client.send(response);
                                    }
                                } else {
                                    set.delete(client);
                                }
                            }
                        }
                    } else {
                        ws.terminate();
                    }
                }
                break;
                case "ACKNOWLEDGEMENT":
                {
                    if (ws.hello) {
                        channel.markAsRead(message.channel_id, ws.session.user_id);
                    } else {
                        ws.terminate();
                    }
                }
                break;
                case "DM_MESSAGE_DELETE":
                {
                    if (ws.hello) {
                        let response = await require("delete/message.js")(ws.session, message);

                        if (response.status) {
                            const set = channels.dm.get(response.channel_id);

                            if (set !== undefined && set.has(ws)) {
                                response = JSON.stringify(response);

                                for (const client of set) {
                                    if (client.readyState === WebSocket.OPEN) {
                                        client.send(response);
                                    } else {
                                        set.delete(client);
                                    }
                                }
                            }
                        } else {
                            ws.send(JSON.stringify(response));
                        }
                    } else {
                        ws.terminate();
                    }
                }
                break;
                case "TEXT_MESSAGE_DELETE":
                {
                    if (ws.hello) {
                        let response = await require("delete/message.js")(ws.session, message);

                        if (response.status) {
                            const set = channels.guild.get(response.channel_id);

                            if (set !== undefined && set.has(ws)) {
                                response = JSON.stringify(response);

                                for (const client of set) {
                                    if (client.readyState === WebSocket.OPEN) {
                                        client.send(response);
                                    } else {
                                        set.delete(client);
                                    }
                                }
                            }
                        } else {
                            ws.send(JSON.stringify(response));
                        }
                    } else {
                        ws.terminate();
                    }
                }
                break;
                case "ATTACHMENTS":
                {
                    if (ws.hello && ws.rateLimit()) {
                        if (await channel.hasDMPermission(message.channel_id, ws.session.user_id)) {
                            const pathname = `public/attachments/${message.channel_id}`;
                            if (fs.existsSync(pathname)) {
                                const files = fs.readdirSync(pathname);
                                ws.send(JSON.stringify({
                                    status: true,
                                    type: "ATTACHMENTS",
                                    channel_id: message.channel_id,
                                    attachments: files
                                }));
                            }
                        } else {
                            ws.terminate();
                        }
                    } else {
                        ws.terminate();
                    }
                }
                break;
                case "UPDATE":
                {
                    if (ws.hello) {
                        ws.session.update();
                    } else {
                        ws.terminate();
                    }
                }
                break;
                case "HELLO": case "RECONNECT":
                {
                    if (!ws.hello) {
                        if (await ws.session.set()) {
                            ws.hello = true;
                            channels.dm.get(channel.EVERYONE).add(ws);

                            if (!users.has(ws.session.user_id)) {
                                users.set(ws.session.user_id, new Set());
                            }
                            users.get(ws.session.user_id).add(ws);

                            if (message.type === "HELLO") {
                                ws.send(JSON.stringify({
                                    status: true,
                                    type: "HELLO",
                                    email: ws.session.email,
                                    username: ws.session.username,
                                    tag: ws.session.tag,
                                    avatar: ws.session.avatar,
                                    user_id: ws.session.user_id
                                }));
                            }

                            let response = await require("users/channels.js")(ws.session);
                            if (response.status) {
                                for (const channel of response.channels) {
                                    if (!channels.dm.has(channel.id)) {
                                        channels.dm.set(channel.id, new Set());
                                    }
                                    channels.dm.get(channel.id).add(ws);
                                }
                                if (message.type === "HELLO") {
                                    ws.send(JSON.stringify(response));
                                }
                            }

                            response = await require("users/guilds.js")(ws.session);
                            if (response.status) {
                                for (const guild of response.guilds) {
                                    for (const channel of guild.channels) {
                                        if (!channels.guild.has(channel.id)) {
                                            channels.guild.set(channel.id, new Set());
                                        }
                                        channels.guild.get(channel.id).add(ws);
                                    }
                                }
                                if (message.type === "HELLO") {
                                    ws.send(JSON.stringify(response));
                                }
                            }

                            response = await require("users/pending.js")(ws.session);
                            if (response.status) {
                                for (const channel of response.pending) {
                                    if (!channels.pending.has(channel.id)) {
                                        channels.pending.set(channel.id, new Set());
                                    }
                                    channels.pending.get(channel.id).add(ws);
                                }
                                if (message.type === "HELLO") {
                                    ws.send(JSON.stringify(response));
                                }
                            }
                        } else {
                            ws.terminate();
                        }
                    } else {
                        ws.terminate();
                    }
                }
                break;
            }
        } catch (error) {
            ws.terminate();
        }
    });
    ws.on("error", () => {
        ws.terminate();
    });
});

setInterval(() => {
    for (const client of chat.clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.ping();
        }
    }
}, 60000);

setInterval(() => {
    for (const [key, set] of channels.dm) {
        for (const client of set) {
            if (client.readyState !== WebSocket.OPEN) {
                set.delete(client);
            }
        }
        if (set.size === 0 && key !== channel.EVERYONE) {
            channels.dm.delete(key);
        }
    }

    for (const [key, set] of channels.pending) {
        for (const client of set) {
            if (client.readyState !== WebSocket.OPEN) {
                set.delete(client);
            }
        }
        if (set.size === 0) {
            channels.pending.delete(key);
        }
    }

    for (const [key, set] of channels.guild) {
        for (const client of set) {
            if (client.readyState !== WebSocket.OPEN) {
                set.delete(client);
            }
        }
        if (set.size === 0) {
            channels.guild.delete(key);
        }
    }

    for (const [key, set] of users) {
        for (const client of set) {
            if (client.readyState !== WebSocket.OPEN) {
                set.delete(client);
            }
        }
        if (set.size === 0) {
            users.delete(key);
        }
    }
}, 3600000);