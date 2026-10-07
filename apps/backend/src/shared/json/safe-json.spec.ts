import { describe, expect, it } from '@jest/globals';
import {
  AUDIT_METADATA_POLICY,
  JsonPolicy,
  LOGICAL_REQUEST_POLICY,
  OUTBOX_PAYLOAD_POLICY,
  REPLAY_GUARD_POLICY,
  REPLAY_PAYLOAD_POLICY,
  withMaxBytes,
} from './json-policy';
import {
  canonicalJson,
  isSecretKeyName,
  JsonRejectReason,
  JsonValidationError,
  validateJson,
} from './safe-json';

const BIG_BYTES: JsonPolicy = { ...LOGICAL_REQUEST_POLICY, name: 'test-big', maxBytes: 50_000_000 };

function reasonOf(value: unknown, policy: JsonPolicy = LOGICAL_REQUEST_POLICY): JsonRejectReason {
  try {
    validateJson(value, policy);
  } catch (error) {
    if (error instanceof JsonValidationError) {
      return error.reason;
    }
    throw error;
  }
  throw new Error('expected the value to be rejected');
}

function nested(levels: number): unknown {
  let value: unknown = 1;
  for (let level = 0; level < levels; level += 1) {
    value = { a: value };
  }
  return value;
}

describe('Canonical JSON v1 — literal vectors', () => {
  it('sorts object keys by UTF-16 code unit order at every level and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1, 2], c: null }, A: true })).toBe(
      '{"A":true,"a":{"c":null,"d":[3,1,2]},"b":1}',
    );
  });

  it('really emits sorted keys for numeric-looking keys (JSON.stringify would reorder integers first)', () => {
    const value = { b: 1, '10': 1, '2': 2, a: 3, '1': 0 };
    expect(JSON.stringify(value)).toBe('{"1":0,"2":2,"10":1,"b":1,"a":3}');
    expect(canonicalJson(value)).toBe('{"1":0,"10":1,"2":2,"a":3,"b":1}');
  });

  it('orders by UTF-16 code units, not by code points', () => {
    // U+1F600 is the surrogate pair D83D DE00; U+FF5E is a single unit FF5E. D83D < FF5E.
    expect(canonicalJson({ '～': 1, '\u{1F600}': 2 })).toBe('{"\u{1F600}":2,"～":1}');
  });

  it('uses JSON.stringify semantics for primitives and normalizes -0 to 0', () => {
    expect(canonicalJson([0, -0, 1.5, 1e21, -1e-7, true, false, null])).toBe(
      '[0,0,1.5,1e+21,-1e-7,true,false,null]',
    );
    expect(canonicalJson('line\n"quote" é')).toBe('"line\\n\\"quote\\" é"');
  });

  it('does not trim or Unicode-normalize strings', () => {
    expect(canonicalJson(' a ')).toBe('" a "');
    expect(canonicalJson('é')).not.toBe(canonicalJson('é'));
    expect(canonicalJson({ p: ' pass word ' })).toBe('{"p":" pass word "}');
  });

  it('accepts null-prototype objects and shared (non-cyclic) references', () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare.k = 'v';
    const shared = { x: 1 };
    expect(canonicalJson(bare)).toBe('{"k":"v"}');
    expect(canonicalJson({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}');
  });

  it('reports the exact byte length of the canonical text', () => {
    const result = validateJson({ k: 'é\u{1F600}' }, LOGICAL_REQUEST_POLICY);
    expect(result.byteLength).toBe(Buffer.byteLength(result.canonical, 'utf8'));
  });
});

describe('JSON validator — rejected shapes (C26)', () => {
  it.each<[string, () => unknown, JsonRejectReason]>([
    ['undefined', () => undefined, 'undefined'],
    ['nested undefined', () => ({ a: undefined }), 'undefined'],
    ['NaN', () => ({ a: NaN }), 'non_finite_number'],
    ['Infinity', () => [Infinity], 'non_finite_number'],
    ['-Infinity', () => -Infinity, 'non_finite_number'],
    ['bigint', () => ({ a: 1n }), 'non_json_type'],
    ['symbol', () => Symbol('x'), 'non_json_type'],
    ['function', () => ({ a: () => 1 }), 'non_json_type'],
    ['own toJSON function', () => ({ toJSON: () => 'x' }), 'non_json_type'],
    ['Date', () => new Date(0), 'custom_prototype'],
    ['Map', () => new Map(), 'custom_prototype'],
    ['Set', () => new Set(), 'custom_prototype'],
    ['Buffer', () => Buffer.from('x'), 'custom_prototype'],
    ['Uint8Array', () => new Uint8Array(2), 'custom_prototype'],
    ['class instance', () => new (class Custom { value = 1; })(), 'custom_prototype'],
    ['array subclass', () => new (class Sub extends Array<number> {})(), 'custom_prototype'],
    ['sparse array', () => [1, , 3], 'sparse_array'],
    ['array with extra property', () => Object.assign([1, 2], { extra: 1 }), 'hidden_property'],
    ['symbol key', () => ({ [Symbol('k')]: 1 }), 'symbol_key'],
    ['symbol key on array', () => Object.assign([1], { [Symbol('k')]: 1 }), 'symbol_key'],
  ])('rejects %s', (_label, make, reason) => {
    expect(reasonOf(make())).toBe(reason);
  });

  it('rejects non-enumerable own properties', () => {
    const hidden = {};
    Object.defineProperty(hidden, 'secret', { value: 1, enumerable: false });
    expect(reasonOf(hidden)).toBe('hidden_property');
  });

  it('rejects accessors WITHOUT ever invoking the getter', () => {
    let called = false;
    const withGetter = {};
    Object.defineProperty(withGetter, 'a', {
      enumerable: true,
      get() {
        called = true;
        return 1;
      },
    });
    const arrayWithGetter = [1];
    Object.defineProperty(arrayWithGetter, 0, {
      enumerable: true,
      get() {
        called = true;
        return 1;
      },
    });
    expect(reasonOf(withGetter)).toBe('accessor');
    expect(reasonOf(arrayWithGetter)).toBe('accessor');
    expect(called).toBe(false);
  });

  it('rejects a class with toJSON on its prototype WITHOUT calling it', () => {
    let called = false;
    class WithToJson {
      toJSON(): string {
        called = true;
        return 'x';
      }
    }
    expect(reasonOf(new WithToJson())).toBe('custom_prototype');
    expect(called).toBe(false);
  });

  it('rejects a Proxy WITHOUT triggering any trap', () => {
    const hits: string[] = [];
    const handler: ProxyHandler<object> = {
      get: (target, key) => {
        hits.push(`get:${String(key)}`);
        return Reflect.get(target, key);
      },
      ownKeys: (target) => {
        hits.push('ownKeys');
        return Reflect.ownKeys(target);
      },
      getPrototypeOf: (target) => {
        hits.push('getPrototypeOf');
        return Reflect.getPrototypeOf(target);
      },
      getOwnPropertyDescriptor: (target, key) => {
        hits.push('descriptor');
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    };
    expect(reasonOf(new Proxy({ a: 1 }, handler))).toBe('proxy');
    expect(reasonOf([new Proxy([1], handler)])).toBe('proxy');
    expect(hits).toEqual([]);
  });

  it('rejects cycles through objects, arrays and mixtures', () => {
    const self: Record<string, unknown> = {};
    self.me = self;
    const a: Record<string, unknown> = {};
    const b: Record<string, unknown> = { a };
    a.b = b;
    const list: unknown[] = [];
    list.push(list);
    const mixed: Record<string, unknown> = {};
    mixed.items = [mixed];
    expect(reasonOf(self)).toBe('cycle');
    expect(reasonOf(a)).toBe('cycle');
    expect(reasonOf(list)).toBe('cycle');
    expect(reasonOf(mixed)).toBe('cycle');
  });

  it('never leaks a key name, a value or a path in the error', () => {
    const marker = 'SECRET_MARKER_JSON_5d1e';
    let message = '';
    try {
      validateJson({ [`x_${marker}_password`]: marker }, AUDIT_METADATA_POLICY);
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toBe('Invalid JSON value (secret_key)');
    expect(message).not.toContain(marker);
  });
});

describe('JSON validator — bounds (C26)', () => {
  it('allows 8 nested containers and rejects the 9th', () => {
    expect(() => validateJson(nested(8), LOGICAL_REQUEST_POLICY)).not.toThrow();
    expect(reasonOf(nested(9))).toBe('depth');
    // Arrays count as containers too.
    expect(reasonOf([[[[[[[[[1]]]]]]]]])).toBe('depth');
    expect(() => validateJson([[[[[[[[1]]]]]]]], LOGICAL_REQUEST_POLICY)).not.toThrow();
  });

  it('stops at the 65536-node cap before building any large text', () => {
    // 1 array node + 65535 elements = 65536 visited values: allowed.
    expect(() => validateJson(new Array<number>(65_535).fill(0), BIG_BYTES)).not.toThrow();
    // One more value is over the cap.
    expect(reasonOf(new Array<number>(65_536).fill(0), BIG_BYTES)).toBe('node_cap');
    // A shared reference visited many times counts every visit.
    const shared = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(reasonOf(new Array<unknown>(7_000).fill(shared), BIG_BYTES)).toBe('node_cap');
  });

  it('refuses a huge sparse array without iterating it', () => {
    const huge = new Array<number>(2 ** 31);
    expect(reasonOf(huge, BIG_BYTES)).toBe('node_cap');
  });

  it('counts UTF-8 BYTES, not characters, against the cap', () => {
    // {"a":"..."} is 8 bytes of framing plus the string; "é" is 2 bytes.
    const atCap = { a: 'é'.repeat(4_092) };
    expect(validateJson(atCap, AUDIT_METADATA_POLICY).byteLength).toBe(8 * 1024);
    expect(reasonOf({ a: 'é'.repeat(4_093) }, AUDIT_METADATA_POLICY)).toBe('size');

    // 2049 emoji are only 2049 * 2 = 4098 UTF-16 units (< 8192) but 8196 UTF-8 bytes.
    const emoji = { a: '\u{1F600}'.repeat(2_049) };
    expect(emoji.a.length).toBeLessThan(8 * 1024);
    expect(reasonOf(emoji, AUDIT_METADATA_POLICY)).toBe('size');
  });

  it('applies the ADR hard caps per policy', () => {
    expect(AUDIT_METADATA_POLICY.maxBytes).toBe(8 * 1024);
    expect(REPLAY_GUARD_POLICY.maxBytes).toBe(4 * 1024);
    expect(OUTBOX_PAYLOAD_POLICY.maxBytes).toBe(64 * 1024);
    expect(REPLAY_PAYLOAD_POLICY.maxBytes).toBe(64 * 1024);
    for (const policy of [
      AUDIT_METADATA_POLICY,
      REPLAY_GUARD_POLICY,
      OUTBOX_PAYLOAD_POLICY,
      REPLAY_PAYLOAD_POLICY,
      LOGICAL_REQUEST_POLICY,
    ]) {
      expect(policy.maxDepth).toBe(8);
      expect(policy.maxNodes).toBe(65_536);
    }
    expect(reasonOf({ a: 'x'.repeat(4_096) }, REPLAY_GUARD_POLICY)).toBe('size');
    expect(reasonOf({ a: 'x'.repeat(64 * 1024) }, REPLAY_PAYLOAD_POLICY)).toBe('size');
  });

  it('lets a module choose a smaller cap but never a larger one', () => {
    const small = withMaxBytes(AUDIT_METADATA_POLICY, 100);
    expect(small.maxBytes).toBe(100);
    expect(reasonOf({ a: 'x'.repeat(100) }, small)).toBe('size');
    expect(() => withMaxBytes(AUDIT_METADATA_POLICY, 8 * 1024 + 1)).toThrow(RangeError);
    expect(() => withMaxBytes(AUDIT_METADATA_POLICY, 0)).toThrow(RangeError);
  });
});

describe('JSON validator — secret key policy is separate per mode (C26)', () => {
  const secretNames = [
    'password',
    'Password',
    'accessToken',
    'access_token',
    'ACCESS-TOKEN',
    'refresh.token',
    'verification_token',
    'verificationToken',
    'authorization',
    'Authorization',
    'cookie',
    'set-cookie',
    'otp',
    'otp_code',
    'proof',
    'verification_proof',
    'database_url',
    'DATABASE_URL',
    'api_key',
    'client_secret',
    'ｐassword',
  ];

  it.each(secretNames)('safe-metadata modes reject the nested key %s', (name) => {
    for (const policy of [AUDIT_METADATA_POLICY, REPLAY_GUARD_POLICY, OUTBOX_PAYLOAD_POLICY]) {
      expect(reasonOf({ meta: { list: [{ [name]: 'x' }] } }, policy)).toBe('secret_key');
    }
  });

  it('does not reject ordinary key names', () => {
    const ordinary = {
      user_id: 'u',
      session_id: 's',
      status: 'ok',
      password_changed_at: '2026-10-07',
      tokens_issued: 1,
      device: { os: 'android' },
    };
    for (const policy of [AUDIT_METADATA_POLICY, REPLAY_GUARD_POLICY, OUTBOX_PAYLOAD_POLICY]) {
      expect(() => validateJson(ordinary, policy)).not.toThrow();
    }
    expect(isSecretKeyName('')).toBe(false);
    expect(isSecretKeyName('密码')).toBe(false);
  });

  it('replay and logical-request modes accept password/proof/token keys (needed for HMAC and replay)', () => {
    const logical = {
      phone: '+84901234567',
      password: ' pass word ',
      verification_token: 'opaque',
      access_token: 'tok',
    };
    for (const policy of [LOGICAL_REQUEST_POLICY, REPLAY_PAYLOAD_POLICY]) {
      expect(validateJson(logical, policy).canonical).toBe(
        '{"access_token":"tok","password":" pass word ","phone":"+84901234567","verification_token":"opaque"}',
      );
    }
    // The very same object is refused as metadata.
    expect(reasonOf(logical, AUDIT_METADATA_POLICY)).toBe('secret_key');
  });
});
