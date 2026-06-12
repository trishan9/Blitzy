import { hash as argonHash, verify as argonVerify, Algorithm } from "@node-rs/argon2";

const ARGON2ID_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const passwordHasher = {
  hash: async (password: string): Promise<string> => argonHash(password, ARGON2ID_OPTIONS),
  verify: async ({ hash, password }: { hash: string; password: string }): Promise<boolean> => {
    try {
      return await argonVerify(hash, password);
    } catch {
      return false;
    }
  },
};

const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$3s1Z0m1x2b3n4v5c6x7z8a9s0d1f2g3h4j5k6l7q8w9e";

export async function dummyVerify(password: string): Promise<void> {
  try {
    await argonVerify(DUMMY_HASH, password);
  } catch {
  }
}
