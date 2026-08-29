class SSEManager {
  constructor() {
    this.clients = new Set();
    this.heartbeatInterval = null;
    this.startHeartbeat();
  }

  addClient(res) {
    this.clients.add(res);

    res.on('close', () => {
      this.clients.delete(res);
    });

    // Send initial handshake
    this.sendToClient(res, 'connection:established', {
      connectedAt: new Date().toISOString(),
      activeClients: this.clients.size,
    });
  }

  removeClient(res) {
    this.clients.delete(res);
  }

  sendToClient(res, eventType, data) {
    try {
      res.write(`event: ${eventType}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
      this.clients.delete(res);
    }
  }

  broadcast(eventType, data) {
    const payload = {
      timestamp: new Date().toISOString(),
      ...data,
    };

    const message = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;

    for (const client of this.clients) {
      try {
        client.write(message);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  startHeartbeat() {
    if (this.heartbeatInterval) return;
    this.heartbeatInterval = setInterval(() => {
      for (const client of this.clients) {
        try {
          client.write(`: keep-alive ping ${Date.now()}\n\n`);
        } catch {
          this.clients.delete(client);
        }
      }
    }, 15000);
    if (this.heartbeatInterval.unref) {
      this.heartbeatInterval.unref();
    }
  }

  getClientCount() {
    return this.clients.size;
  }
}

export const sseManager = new SSEManager();
