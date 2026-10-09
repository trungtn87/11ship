import { afterEach, describe, expect, it } from '@jest/globals';
import { createServer as createNetServer, AddressInfo, Server, Socket } from 'node:net';
import { createServer as createTlsServer, TLSSocket } from 'node:tls';
import { Client, PoolConfig } from 'pg';
import { safeErrorCode } from '../common/safe-error';
import { DatabaseConfig, loadConfig } from '../config/app-config';
import { StartupConfigError } from '../config/startup-config-error';
import { buildPoolOptions } from './create-pool';
import { createTestPki, TestPki } from './test-tls.fixture';

const pki = createTestPki();
const PASSWORD = 'SECRET_MARKER_POOL_TLS_91ac';

// ---------------------------------------------------------------------------------------------------------
// A PostgreSQL-shaped server that speaks only the part the TLS decision depends on: the SSLRequest. Either it
// accepts TLS ('S') with a real TLS server, or it refuses ('N') and records whether the client then sent
// anything in plaintext. No database is involved, so these run in the plain unit suite.

interface FakePostgres {
  readonly port: number;
  /** TLS handshakes that completed on the server side (i.e. the client accepted the certificate). */
  handshakes(): number;
  /** Bytes the client sent after the server refused SSL (a plaintext fallback would show up here). */
  bytesAfterRefusal(): number;
  stop(): Promise<void>;
}

async function startFakePostgres(mode: 'tls' | 'refuse-ssl', material: TestPki): Promise<FakePostgres> {
  const sockets = new Set<Socket>();
  let handshakes = 0;
  let bytesAfterRefusal = 0;

  const tlsServer = createTlsServer({ key: material.serverKeyPem, cert: material.serverCertPem });
  tlsServer.on('secureConnection', (socket: TLSSocket) => {
    handshakes += 1;
    // The test only needs to know the handshake completed; the client then sees a dropped connection.
    socket.destroy();
  });
  tlsServer.on('tlsClientError', () => undefined);

  const server: Server = createNetServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    socket.once('data', (first) => {
      const isSslRequest = first.length >= 8 && first.readInt32BE(4) === 80877103;
      if (!isSslRequest) {
        socket.destroy();
        return;
      }
      if (mode === 'tls') {
        socket.write('S');
        // Hand the raw socket to the TLS server: the same upgrade a real PostgreSQL performs after 'S'.
        tlsServer.emit('connection', socket);
      } else {
        socket.on('data', (rest) => {
          bytesAfterRefusal += rest.length;
        });
        socket.write('N');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    port: (server.address() as AddressInfo).port,
    handshakes: () => handshakes,
    bytesAfterRefusal: () => bytesAfterRefusal,
    stop: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

const running: FakePostgres[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((fake) => fake.stop()));
});

async function fakePostgres(mode: 'tls' | 'refuse-ssl'): Promise<FakePostgres> {
  const fake = await startFakePostgres(mode, pki);
  running.push(fake);
  return fake;
}

/** The staging configuration exactly as startup builds it: loadConfig, then buildPoolOptions. */
function stagingPoolOptions(databaseUrl: string, ca: string): PoolConfig {
  const result = loadConfig({
    APP_ENV: 'staging',
    NODE_ENV: 'production',
    DATABASE_URL: databaseUrl,
    DB_SSL_CA: ca,
  });
  if (!result.ok) {
    throw new Error(`expected a valid staging configuration, got: ${result.invalid.join(',')}`);
  }
  return buildPoolOptions(result.config.database);
}

async function attemptConnect(options: PoolConfig): Promise<Error | undefined> {
  const client = new Client(options);
  client.on('error', () => undefined);
  try {
    await client.connect();
    return undefined;
  } catch (error) {
    return error as Error;
  }
}

function effectiveSsl(options: PoolConfig): unknown {
  // The merged result node-postgres will really use (explicit options + URL query).
  return (new Client(options) as unknown as { connectionParameters: { ssl: unknown } })
    .connectionParameters.ssl;
}

// ---------------------------------------------------------------------------------------------------------

const BASE_URL = `postgres://ship11_app.projref:${PASSWORD}@pooler.example.test:5432/postgres`;

function databaseConfig(overrides: Partial<DatabaseConfig> = {}): DatabaseConfig {
  return {
    url: BASE_URL,
    poolMax: 2,
    connectTimeoutMs: 5000,
    queryTimeoutMs: 1000,
    statementTimeoutMs: 800,
    ...overrides,
  };
}

describe('buildPoolOptions', () => {
  it('sets no ssl option without TLS configuration, so local PostgreSQL and CI behave as before', () => {
    const options = buildPoolOptions(databaseConfig());
    expect('ssl' in options).toBe(false);
    expect(options.connectionString).toBe(BASE_URL);
    expect(options.max).toBe(2);
    expect(options.connectionTimeoutMillis).toBe(5000);
    expect(options.query_timeout).toBe(1000);
    expect(options.statement_timeout).toBe(800);
  });

  it('sets exactly { ca, rejectUnauthorized: true } with TLS configuration', () => {
    const options = buildPoolOptions(
      databaseConfig({ tls: { ca: pki.caPem, rejectUnauthorized: true } }),
    );
    expect(options.ssl).toEqual({ ca: pki.caPem, rejectUnauthorized: true });
    expect(options.connectionString).toBe(BASE_URL);
  });

  it('refuses to build from a URL with a query when TLS is configured, naming only DATABASE_URL', () => {
    const config = databaseConfig({
      url: `${BASE_URL}?sslmode=no-verify`,
      tls: { ca: pki.caPem, rejectUnauthorized: true },
    });
    let thrown: unknown;
    try {
      buildPoolOptions(config);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StartupConfigError);
    expect((thrown as StartupConfigError).invalid).toEqual(['DATABASE_URL']);
    expect((thrown as StartupConfigError).message).not.toContain(PASSWORD);
    expect((thrown as StartupConfigError).message).not.toContain('no-verify');
  });
});

describe('why the URL query is refused: node-postgres lets it override explicit ssl (canary)', () => {
  it('replaces a verified ssl object when the URL carries sslmode=no-verify', () => {
    // If this ever stops being true (a node-postgres change), the query-string rule can be revisited on
    // purpose. Until then it is the reason loadConfig and buildPoolOptions refuse any URL query.
    const unsafe = effectiveSsl({
      connectionString: `${BASE_URL}?sslmode=no-verify`,
      ssl: { ca: pki.caPem, rejectUnauthorized: true },
    });
    expect(unsafe).toEqual({ rejectUnauthorized: false });
  });

  it('keeps the verified ssl object for the options the application really builds', () => {
    expect(effectiveSsl(stagingPoolOptions(BASE_URL, pki.caPem))).toEqual({
      ca: pki.caPem.trim() + '\n',
      rejectUnauthorized: true,
    });
  });
});

describe('a real TLS handshake with the staging pool options', () => {
  it('connects when the server certificate verifies against the supplied CA and the host name', async () => {
    const fake = await fakePostgres('tls');
    const error = await attemptConnect(
      stagingPoolOptions(`postgres://u:${PASSWORD}@localhost:${fake.port}/postgres`, pki.caPem),
    );
    // The fake server drops the connection after the handshake, so connect() itself ends in an error; what
    // matters is that the TLS handshake completed, i.e. the client accepted the certificate.
    expect(fake.handshakes()).toBe(1);
    expect(String(error?.message ?? '')).not.toContain(PASSWORD);
  });

  it('refuses a server whose certificate does not verify against the supplied CA', async () => {
    const fake = await fakePostgres('tls');
    const error = await attemptConnect(
      stagingPoolOptions(`postgres://u:${PASSWORD}@localhost:${fake.port}/postgres`, pki.otherCaPem),
    );
    expect(error).toBeDefined();
    expect((error as { code?: string }).code).toBe('UNABLE_TO_VERIFY_LEAF_SIGNATURE');
    // Readiness logs only safeErrorCode(error): the failure stays diagnosable without leaking anything.
    expect(safeErrorCode(error)).toBe('UNABLE_TO_VERIFY_LEAF_SIGNATURE');
    expect(fake.handshakes()).toBe(0);
  });

  it('refuses a certificate that is valid for another host name even though the CA is right', async () => {
    const fake = await fakePostgres('tls');
    // The test certificate is valid for DNS:localhost only. Reaching the same server as 127.0.0.1 must fail.
    const error = await attemptConnect(
      stagingPoolOptions(`postgres://u:${PASSWORD}@127.0.0.1:${fake.port}/postgres`, pki.caPem),
    );
    expect((error as { code?: string } | undefined)?.code).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
    expect(safeErrorCode(error)).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
    expect(fake.handshakes()).toBe(0);
  });

  it('never falls back to plaintext when the server refuses SSL', async () => {
    const fake = await fakePostgres('refuse-ssl');
    const error = await attemptConnect(
      stagingPoolOptions(`postgres://u:${PASSWORD}@localhost:${fake.port}/postgres`, pki.caPem),
    );
    expect(error).toBeDefined();
    expect(fake.bytesAfterRefusal()).toBe(0);
    expect(fake.handshakes()).toBe(0);
  });
});
