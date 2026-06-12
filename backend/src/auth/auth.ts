import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { passkey } from "@better-auth/passkey";
import { twoFactor, admin, jwt, bearer, haveIBeenPwned } from "better-auth/plugins";
import { uuidv7 } from "uuidv7";
import { Redis } from "ioredis";
import { db } from "../db/client";
import * as schema from "../db/schema";
import { passwordHasher } from "./argon2";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

const isProd = process.env.NODE_ENV === "production";
const cookiePrefix = isProd ? "__Host-ecom" : "ecom";

export const auth = betterAuth({
  appName: "ecommerce",
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,

  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      ...schema,
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      passkey: schema.passkeys,
      twoFactor: schema.twoFactors,
      jwks: schema.jwks,
    },
  }),

  secondaryStorage: {
    get: (key) => redis.get(key),
    set: (key, value, ttl) =>
      ttl ? redis.set(key, value, "EX", ttl).then(() => undefined) : redis.set(key, value).then(() => undefined),
    delete: (key) => redis.del(key).then(() => undefined),
  },

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    password: passwordHasher,
  },

  plugins: [
    passkey({
      rpID: process.env.PASSKEY_RP_ID,
      rpName: "ecommerce",
      origin: process.env.APP_URL,
    }),
    twoFactor({ issuer: "ecommerce" }),
    admin({ defaultRole: "USER", adminRoles: ["ADMIN"] }),
    jwt({
      jwt: {
        issuer: process.env.JWT_ISS,
        audience: process.env.JWT_AUD,
        expirationTime: "10m",
        definePayload: ({ user }) => ({ role: (user as { role?: string }).role ?? "USER" }),
      },
    }),
    bearer(),
    haveIBeenPwned({
      customPasswordCompromisedMessage:
        "This password has appeared in a public breach. Please choose a different one.",
    }),
  ],

  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    freshAge: 60 * 15,
    storeSessionInDatabase: true,
  },

  account: {
    accountLinking: { enabled: true, trustedProviders: ["google", "github"] },
  },

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
    },
  },

  trustedOrigins: (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),

  advanced: {
    database: {
      generateId: () => uuidv7(),
    },
    cookiePrefix,
    useSecureCookies: isProd,
    defaultCookieAttributes: {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
    },
  },

  rateLimit: {
    enabled: true,
    storage: "secondary-storage",
    window: 60,
    max: 20,
  },

  databaseHooks: {
    user: {
      create: {
        before: async (user: { email?: string }) => {
          return { data: user };
        },
      },
    },
  },
});

export type AuthSession = typeof auth.$Infer.Session;
