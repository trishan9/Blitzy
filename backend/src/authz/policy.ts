export type Role = "USER" | "ADMIN";

export type Actor = { id: string; role: Role } | null;

export type Action =
  | "read"
  | "list"
  | "create"
  | "update"
  | "delete"
  | "order:transition"
  | "order:cancel"
  | "review:create"
  | "admin:access"
  | "wishlist:view-shared";

export type Resource =
  | { kind: "product"; ownerId?: string }
  | { kind: "category" }
  | { kind: "order"; ownerId: string }
  | { kind: "orderItem"; ownerId: string }
  | { kind: "cart"; ownerId: string | null }
  | { kind: "address"; ownerId: string }
  | { kind: "payment"; ownerId: string }
  | { kind: "review"; ownerId: string }
  | { kind: "wishlist"; ownerId: string; isPublic?: boolean; hasValidShareToken?: boolean }
  | { kind: "user"; ownerId: string }
  | { kind: "coupon" }
  | { kind: "adminPanel" }
  | { kind: "auditLog" }
  | { kind: "webhookEndpoint"; ownerId: string };

const isAdmin = (a: Actor): a is { id: string; role: "ADMIN" } => a?.role === "ADMIN";
const isOwner = (a: Actor, ownerId: string | null): boolean =>
  a != null && ownerId != null && a.id === ownerId;
const ownerOrAdmin = (a: Actor, ownerId: string | null): boolean =>
  isAdmin(a) || isOwner(a, ownerId);

export function can(actor: Actor, action: Action, resource: Resource): boolean {
  switch (resource.kind) {
    case "product":
    case "category": {
      if (action === "read" || action === "list") return true;
      if (action === "create" || action === "update" || action === "delete") return isAdmin(actor);
      return false;
    }

    case "order": {
      if (action === "read") return ownerOrAdmin(actor, resource.ownerId);
      if (action === "list") return actor != null;
      if (action === "create") return actor != null;
      if (action === "order:cancel") return isOwner(actor, resource.ownerId);
      if (action === "order:transition") return isAdmin(actor);
      return false;
    }

    case "orderItem": {
      if (action === "read") return ownerOrAdmin(actor, resource.ownerId);
      return false;
    }
    case "payment": {
      if (action === "read") return ownerOrAdmin(actor, resource.ownerId);
      return false;
    }
    case "cart": {
      if (resource.ownerId === null) return false;
      if (action === "read" || action === "update" || action === "create" || action === "delete") {
        return ownerOrAdmin(actor, resource.ownerId);
      }
      return false;
    }

    case "address": {
      if (action === "read" || action === "list") return ownerOrAdmin(actor, resource.ownerId);
      if (action === "create" || action === "update" || action === "delete")
        return isOwner(actor, resource.ownerId);
      return false;
    }

    case "review": {
      if (action === "read" || action === "list") return true;
      if (action === "review:create" || action === "create") return actor != null;
      if (action === "update" || action === "delete")
        return isOwner(actor, resource.ownerId) || isAdmin(actor);
      return false;
    }

    case "wishlist": {
      if (action === "wishlist:view-shared")
        return resource.isPublic === true && resource.hasValidShareToken === true;
      if (action === "read" || action === "list" || action === "create" || action === "update" || action === "delete")
        return isOwner(actor, resource.ownerId);
      return false;
    }

    case "user": {
      if (action === "read") return ownerOrAdmin(actor, resource.ownerId);
      if (action === "update" || action === "delete") return isOwner(actor, resource.ownerId);
      return false;
    }

    case "webhookEndpoint": {
      if (action === "read" || action === "list" || action === "create" || action === "update" || action === "delete")
        return isOwner(actor, resource.ownerId);
      return false;
    }

    case "coupon": {
      return isAdmin(actor);
    }
    case "adminPanel": {
      return action === "admin:access" && isAdmin(actor);
    }
    case "auditLog": {
      if (action === "read" || action === "list") return isAdmin(actor);
      return false;
    }

    default:
      return false;
  }
}

export class AuthzDenied extends Error {
  readonly httpStatus = 404;
  constructor(action: Action, kind: Resource["kind"]) {
    super(`not found`);
    this.name = "AuthzDenied";
    (this as unknown as { authzContext: string }).authzContext = `${action}:${kind}`;
  }
}

export function assertCan(actor: Actor, action: Action, resource: Resource): void {
  if (!can(actor, action, resource)) throw new AuthzDenied(action, resource.kind);
}
