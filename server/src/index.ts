import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import app from './app';
import pool, { runMigrations } from './db';
import logger from './lib/logger';
import { clients, broadcast } from './lib/broadcaster';
import { startReminderScheduler } from './lib/reminderScheduler';
import { startCalendarSubscriptionScheduler } from './lib/calendarSources';
import { getJwtSecret } from './config/loadEnv';

export { broadcast };

const PORT = process.env.SERVER_PORT || 3001;

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws: WebSocket) => {
    logger.info('ws.connection_open');

    let userId: string | null = null;
    // Every key this socket is registered under: the account itself and, for a
    // family member, the family owner. Routes broadcast to the family scope
    // (req.userId = owner), so a member's socket must sit under the owner's id
    // too or members never see live updates. Per-account events still reach it
    // through its own id.
    let keys: string[] = [];

    const unregister = () => {
        for (const key of keys) {
            const set = clients.get(key);
            if (!set) continue;
            set.delete(ws);
            if (set.size === 0) clients.delete(key);
        }
        keys = [];
    };

    ws.on('message', (message: string) => {
        try {
            const data = JSON.parse(message.toString());

            if (data.type === 'auth' && typeof data.token === 'string') {
                const fail = () => {
                    logger.warn('ws.auth_failed');
                    ws.send(JSON.stringify({ type: 'auth', success: false }));
                    ws.close(4001, 'Unauthorized');
                };

                let decoded: { userId: string };
                try {
                    decoded = jwt.verify(data.token, getJwtSecret()) as { userId: string };
                } catch {
                    fail();
                    return;
                }

                // Same rule as authMiddleware: the family comes from the database,
                // so a member removed from a family stops hearing about it at once.
                void pool
                    .query('SELECT family_owner_id FROM users WHERE id = $1', [decoded.userId])
                    .then((result) => {
                        const row = result.rows[0] as { family_owner_id: string | null } | undefined;
                        if (!row || ws.readyState !== WebSocket.OPEN) {
                            if (!row) fail();
                            return;
                        }
                        userId = decoded.userId;

                        // A re-auth on the same socket replaces its registration.
                        unregister();
                        keys = Array.from(new Set([decoded.userId, row.family_owner_id ?? decoded.userId]));
                        for (const key of keys) {
                            if (!clients.has(key)) {
                                clients.set(key, new Set());
                            }
                            clients.get(key)!.add(ws);
                        }

                        logger.info('ws.authenticated', { userId });
                        ws.send(JSON.stringify({ type: 'auth', success: true }));
                    })
                    .catch((error) => {
                        logger.warn('ws.auth_lookup_failed', {
                            error: error instanceof Error ? error.message : String(error),
                        });
                        ws.close(1011, 'Server error');
                    });
            }
            // ping/pong for keepalive — no response needed, TCP layer handles it
        } catch (error) {
            logger.warn('ws.message_error', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });

    ws.on('close', () => {
        if (userId) {
            unregister();
            logger.info('ws.connection_closed', { userId });
        }
    });

    ws.on('error', (error) => {
        logger.warn('ws.error', {
            error: error instanceof Error ? error.message : String(error),
        });
    });
});

// Start server
const startServer = async () => {
    try {
        await runMigrations();
        // Test database connection
        await pool.query('SELECT NOW()');
        logger.info('server.database_connected');

        startReminderScheduler();
        startCalendarSubscriptionScheduler();

        server.listen(PORT, () => {
            logger.info('server.started', {
                port: Number(PORT),
                httpUrl: `http://localhost:${PORT}`,
                wsUrl: `ws://localhost:${PORT}/ws`,
            });
        });
    } catch (error) {
        logger.error('server.start_failed', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error && process.env.NODE_ENV !== 'production' ? error.stack : undefined,
        });
        process.exit(1);
    }
};

// Handle graceful shutdown
process.on('SIGTERM', () => {
    logger.info('server.sigterm_received');
    server.close(() => {
        logger.info('server.closed');
        pool.end();
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    logger.info('server.sigint_received');
    server.close(() => {
        logger.info('server.closed');
        pool.end();
        process.exit(0);
    });
});

startServer();
