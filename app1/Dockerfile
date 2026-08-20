FROM amazonlinux:2023

# Install Node.js
RUN dnf install -y nodejs npm && dnf clean all

WORKDIR /app

COPY package.json .
RUN npm install --production

COPY server.js .

ENV PORT=3001
ENV SITE_NAME="Site 1"

EXPOSE 3001

CMD ["node", "server.js"]
