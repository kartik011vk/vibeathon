import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { io as connect } from 'socket.io-client';
import { createSocketServer } from '../src/sockets/index.js';
import { app, createRequest, prisma, setup, verify } from './helpers.js';

let f;
let server;
let ioServer;
let url;
const clients = [];

beforeAll(async () => {
  f = await setup();
  server = createServer(app);
  ioServer = createSocketServer(server);
  await new Promise((resolve) => server.listen(0, resolve));
  url = `http://localhost:${server.address().port}`;
});

afterAll(async () => {
  clients.forEach((c) => c.close());
  ioServer.close();
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
});

function client(token) {
  const c = connect(url, { auth: token ? { token } : {}, transports: ['websocket'], reconnection: false, forceNew: true });
  clients.push(c);
  return c;
}

const connected = (c) =>
  new Promise((resolve, reject) => {
    c.once('connect', resolve);
    c.once('connect_error', reject);
  });

const subscribe = (c, payload) => new Promise((resolve) => c.emit('subscribe', payload, resolve));

describe('socket authentication and room authorization', () => {
  it('rejects connections without a valid access token', async () => {
    await expect(connected(client())).rejects.toThrow('UNAUTHORIZED');
    await expect(connected(client('not.a.jwt'))).rejects.toThrow('UNAUTHORIZED');
  });

  it("lets owners watch their request but not another citizen's", async () => {
    const own = await createRequest(f.tokens.citizen, {}, f);
    const other = await createRequest(f.tokens.citizen2, {}, f);
    const c = client(f.tokens.citizen);
    await connected(c);
    expect(await subscribe(c, { type: 'request', id: own.id })).toEqual({ ok: true });
    expect(await subscribe(c, { type: 'request', id: other.id })).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(await subscribe(c, { type: 'ops', id: own.id })).toEqual({ ok: false, error: 'VALIDATION_ERROR' });
    expect(await subscribe(c, 'ops')).toEqual({ ok: false, error: 'VALIDATION_ERROR' });
  });

  it('delivers events only to authorized subscribers (no cross-user leakage)', async () => {
    const own = await createRequest(f.tokens.citizen, {}, f);
    const owner = client(f.tokens.citizen);
    const stranger = client(f.tokens.citizen2);
    await Promise.all([connected(owner), connected(stranger)]);
    await subscribe(owner, { type: 'request', id: own.id });
    await subscribe(stranger, { type: 'request', id: own.id }); // denied

    const strangerEvents = [];
    stranger.onAny((event, payload) => strangerEvents.push({ event, payload }));
    const ownerGot = new Promise((resolve) => owner.on('request:verified', resolve));

    await verify(f, own.id);
    const payload = await ownerGot;
    expect(payload).toMatchObject({ id: own.id, status: 'VERIFIED' });
    expect(Object.keys(payload).sort()).toEqual(['emittedAt', 'id', 'status']);

    await new Promise((r) => setTimeout(r, 300));
    expect(strangerEvents.filter((e) => e.payload?.id === own.id || e.payload?.requestId === own.id)).toHaveLength(0);
  });

  it('pushes personal notifications only to their recipient', async () => {
    const owner = client(f.tokens.citizen);
    const stranger = client(f.tokens.citizen2);
    await Promise.all([connected(owner), connected(stranger)]);
    const strangerNotes = [];
    stranger.on('notification:created', (n) => strangerNotes.push(n));
    const got = new Promise((resolve) => owner.on('notification:created', resolve));
    await createRequest(f.tokens.citizen, {}, f);
    const note = await got;
    expect(note.type).toBe('REQUEST_RECEIVED');
    await new Promise((r) => setTimeout(r, 300));
    expect(strangerNotes).toHaveLength(0);
  });

  it('coordinators join the operations room automatically', async () => {
    const coord = client(f.tokens.coord);
    await connected(coord);
    const got = new Promise((resolve) => coord.on('request:created', resolve));
    const r = await createRequest(f.tokens.citizen, {}, f);
    expect((await got).id).toBe(r.id);
  });
});
