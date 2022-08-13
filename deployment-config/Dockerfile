
FROM node:16

# Create app directory
WORKDIR /usr/src/app

COPY package*.json ./

RUN npm ci 

# Bundle app source
COPY . .

EXPOSE 8080

CMD ["npm", "start"]