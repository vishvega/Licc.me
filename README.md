# Licc.me

Lightweight chat website 👅

## Screenshots

![Licc.me](public/images/light.jpg)
![Licc.me](public/images/dark.jpg)
![Licc.me](public/images/community.jpg)

Try it here [Licc.me](https://licc.me). Since I cannot guarantee the domain or server will still be used to host this project in the future, screenshots above are provided.

## Setup

### Setup for Linux

Install NGINX

``sudo apt-get install nginx``  

Setup NGINX using the file in ``nginx.conf``. This assumes you have an SSL certificate in ``/etc/ssl/certs/cert.pem`` and the key in ``/etc/ssl/certs/private.key`` and DH parameters in ``/etc/ssl/certs/dhparam.pem``.

You can generate DH parameters with:

``sudo openssl dhparam -out /etc/ssl/certs/dhparam.pem 2048``

Then move the nginx config file:

``sudo mv nginx.conf /etc/nginx/nginx.conf``

Install MongoDB

``sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv 2930ADAE8CAF5059EE73BB4B58712A2291FA4AD5``

``echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu xenial/mongodb-org/3.6 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-3.6.list``

``sudo apt-get update``

``sudo apt-get install -y mongodb-org``

``sudo service mongod start``

Then open a new mongo shell:

``mongo``

Use a database name of your choice:

``use database``

Then create collections and their indexes in MongoDB using the lines in ``DATABASE.js``. Paste this in the mongo shell.

Install Node.js

``curl -sL https://deb.nodesource.com/setup_10.x -o nodesource_setup.sh && sudo bash nodesource_setup.sh && rm nodesource_setup.sh``

``sudo apt-get install -y nodejs``

Install NPM packages

``npm install ws mongodb sharp bcryptjs``

Install pm3

``sudo npm install pm2 -g``

Now clone the repository

``git clone https://github.com/panterito/Licc.me``

``cd Licc.me``

``sudo pm2 start server.js``

## Built with

* [ws](https://github.com/websockets/ws) - WebSockets
* [mongodb](https://github.com/mongodb/node-mongodb-native) - MongoDB Driver
* [sharp](https://github.com/lovell/sharp) - Image utility
* [bcryptjs](https://github.com/dcodeIO/bcrypt.js) - bcrypt

## Status

Discontinued. Releasing the source.
