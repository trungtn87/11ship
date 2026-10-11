import { Inject, Injectable } from '@nestjs/common';
import { PASSWORD_HASHER, PasswordHasher } from './password-hasher';

/**
 * The only way the administration module touches password hashing (M01-D-LOGIN). It is a thin, Auth-owned port over
 * the existing Argon2id hasher: the administration module never implements, configures or imports a second hasher.
 * Hashing and verification are CPU/memory work, so callers run them OUTSIDE any transaction.
 */
@Injectable()
export class AdminPasswordVerifier {
  constructor(@Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher) {}

  /** True when the password matches the stored PHC string. */
  verify(passwordHash: string, password: string): Promise<boolean> {
    return this.hasher.verify(passwordHash, password);
  }

  /** Same work as verify() against a throwaway hash, for a phone that has no usable account. */
  verifyAgainstDummy(password: string): Promise<void> {
    return this.hasher.verifyAgainstDummy(password);
  }

  /** Argon2id PHC string of a new password (operator bootstrap only). */
  hash(password: string): Promise<string> {
    return this.hasher.hash(password);
  }
}
