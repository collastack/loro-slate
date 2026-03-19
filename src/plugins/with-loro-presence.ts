import { Cursor, EphemeralStore, type LoroDoc } from "loro-crdt";
import { getLoroText } from "../utils";
import { type Editor, type BaseSelection, type Path } from "slate";
import type { LoroEditor } from "./with-loro";

// ────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────

export type CursorUser = { name: string; color: string };

/** Decoded presence state exposed to consumers. */
export interface PresenceState {
  anchor?: Cursor;
  focus?: Cursor;
  user?: CursorUser;
}

// ────────────────────────────────────────────────────────────
// EphemeralStore payload (what actually goes over the wire)
// ────────────────────────────────────────────────────────────

// Cursors are serialized to Uint8Array because Cursor objects
// cannot be stored directly in EphemeralStore (which only accepts Value).
export type PresencePayload = {
  anchor: Uint8Array | null;
  focus: Uint8Array | null;
  user: CursorUser | null;
};

export type PresenceMap = Record<string, PresencePayload>;

// ────────────────────────────────────────────────────────────
// Plugin interface
// ────────────────────────────────────────────────────────────

export interface LoroPresenceEditor {
  presence: {
    /** The underlying EphemeralStore. Wire its subscribeLocalUpdates to your transport. */
    store: EphemeralStore<PresenceMap>;
    /** This peer's unique key in the store (e.g. doc.peerIdStr). */
    key: string;
    /** Update local user metadata (display name, cursor color). */
    setUser(user: CursorUser): void;
    /** Get all active peers' decoded presence states. */
    getAll(): Record<string, PresenceState>;
    /** Remove this peer's entry from the store (call on unmount). */
    disconnect(): void;
  };
}

export interface LoroPresenceOptions {
  /** Shared EphemeralStore — the same instance on every peer. */
  store: EphemeralStore<PresenceMap>;
  /**
   * Stable unique string for this peer.
   * Recommended: `doc.peerIdStr` or a user/session ID.
   */
  key: string;
  /** Optional initial user metadata. */
  user?: CursorUser;
}

// ────────────────────────────────────────────────────────────
// Plugin
// ────────────────────────────────────────────────────────────

export function withLoroPresence<T extends LoroEditor & Editor>(
  e: T,
  options: LoroPresenceOptions
): T & LoroPresenceEditor {
  const _e = e as T & LoroPresenceEditor;
  const { store, key } = options;
  let user: CursorUser | null = options.user ?? null;

  const pushToStore = () => {
    const sel: BaseSelection = _e.selection;
    if (!sel) {
      // Clear selection cursors but keep user info if present.
      if (user) {
        store.set(key, { anchor: null, focus: null, user });
      } else {
        store.delete(key);
      }
      return;
    }

    const anchor = slatePointToCursor(_e.doc, sel.anchor.path, sel.anchor.offset);
    const focus =
      sel.focus.path === sel.anchor.path && sel.focus.offset === sel.anchor.offset
        ? anchor
        : slatePointToCursor(_e.doc, sel.focus.path, sel.focus.offset);

    store.set(key, {
      anchor: anchor?.encode() ?? null,
      focus: focus?.encode() ?? null,
      user,
    });
  };

  const { apply } = e;
  _e.apply = (op) => {
    apply(op);
    if (op.type === "set_selection") {
      pushToStore();
    }
  };

  // Publish initial presence immediately.
  pushToStore();

  _e.presence = {
    store,
    key,

    setUser(newUser: CursorUser) {
      user = newUser;
      pushToStore();
    },

    getAll(): Record<string, PresenceState> {
      const raw = store.getAllStates();
      const result: Record<string, PresenceState> = {};
      for (const [peer, payload] of Object.entries(raw)) {
        if (!payload) continue;
        result[peer] = {
          anchor: payload.anchor ? Cursor.decode(payload.anchor) : undefined,
          focus: payload.focus ? Cursor.decode(payload.focus) : undefined,
          user: payload.user ?? undefined,
        };
      }
      return result;
    },

    disconnect() {
      store.delete(key);
    },
  };

  return _e;
}

// ────────────────────────────────────────────────────────────
// Cursor ↔ Slate Point conversion utilities
// ────────────────────────────────────────────────────────────

/**
 * Convert a Slate Point (path + offset) to a Loro Cursor.
 *
 * The cursor is stable across remote edits — when the document is modified
 * by other peers, `doc.getCursorPos` will return the updated position.
 */
export function slatePointToCursor(
  doc: LoroDoc,
  path: Path,
  offset: number
): Cursor | undefined {
  try {
    const lt = getLoroText(doc, path);
    return lt.getCursor(offset) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Convert a Loro Cursor back to a Slate Point.
 *
 * Returns `undefined` if the cursor's container no longer exists.
 * When the cursor position has shifted (due to remote edits), `update`
 * contains the new canonical cursor — store it back in the EphemeralStore
 * to avoid drift.
 */
export function cursorToSlatePoint(
  doc: LoroDoc,
  cursor: Cursor
): { path: Path; offset: number; update?: Cursor } | undefined {
  const pos = doc.getCursorPos(cursor);
  if (!pos) return undefined;

  const containerId = cursor.containerId();
  const loroPath = doc.getPathToContainer(containerId);
  if (!loroPath) return undefined;

  // The Loro path for a text node looks like:
  //   ["children", 0, "children", 1, "text"]
  // Extracting numeric indices yields the Slate path: [0, 1]
  const slatePath = loroPath.filter((x): x is number => typeof x === "number");

  return {
    path: slatePath,
    offset: pos.offset,
    update: pos.update,
  };
}

