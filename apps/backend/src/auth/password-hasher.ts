import { OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

// Password hashing (ADR-002, task section 3). Argon2id with the locked parameters. They are constants here
// on purpose: a weaker setting must not be reachable through an environment variable.
//
// The password is hashed exactly as the client sent it (UTF-8): never trimmed, never Unicode-normalized.
// Hashing is CPU and memory work, so callers run it OUTSIDE any database transaction.

export const ARGON2_MEMORY_COST_KIB = 19_456;
export const ARGON2_TIME_COST = 2;
export const ARGON2_PARALLELISM = 1;

export interface PasswordHasher {
  /** Argon2id PHC string. */
  hash(password: string): Promise<string>;
  /** True when the password matches the stored PHC string. */
  verify(passwordHash: string, password: string): Promise<boolean>;
  /**
   * Spends the same work as a real verification against a throwaway hash. Used when the account does not
   * exist, so a missing phone number is not obvious from the response time.
   */
  verifyAgainstDummy(password: string): Promise<void>;
}

const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: ARGON2_MEMORY_COST_KIB,
  timeCost: ARGON2_TIME_COST,
  parallelism: ARGON2_PARALLELISM,
} as const;

export class Argon2idPasswordHasher implements PasswordHasher, OnModuleInit {
  // The throwaway hash is created EAGERLY, when the hasher is built, from random input nobody knows (it is not a credential of any account). Application
  // startup waits for it (onModuleInit), so no request is ever the one that pays for creating it: every branch that answers "no such credentials" does exactly
  // ONE verification and zero hashing, the first request after a start included.
  readonly #dummy: Promise<string> = argon2.hash(randomBytes(32).toString('base64url'), OPTIONS);

  constructor() {
    // Never an unhandled rejection from a promise nobody awaited yet; the failure surfaces at onModuleInit (startup) and at the first use.
    this.#dummy.catch(() => undefined);
  }

  async onModuleInit(): Promise<void> {
    await this.#dummy;
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, OPTIONS);
  }

  verify(passwordHash: string, password: string): Promise<boolean> {
    return argon2.verify(passwordHash, password);
  }

  async verifyAgainstDummy(password: string): Promise<void> {
    await argon2.verify(await this.#dummy, password);
  }
}

/** Injection token of the hasher binding. */
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
