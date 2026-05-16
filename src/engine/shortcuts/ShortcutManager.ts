// ─── Shortcut Manager ─────────────────────────────────────────────────────────
//
// Centralized keyboard shortcut registry. All shortcuts — global and tool-level
// — are registered here, providing a single place to inspect and modify them.
//
// ── Design Decisions ──────────────────────────────────────────────────────────
//
//   • Registry pattern: O(N) lookup on each keydown, acceptable for N < 100.
//   • First match wins: higher-priority shortcuts registered first take precedence.
//   • Input-field guard: non-Ctrl shortcuts are suppressed when an <input>,
//     <textarea>, or <select> is focused — prevents V keypress from switching to
//     Select tool while the user is typing a label.
//   • Meta = Ctrl normalization: metaKey (Cmd on macOS) is treated identically
//     to ctrlKey so the same shortcut works cross-platform.
//
// ── Future: Shortcut Discovery ────────────────────────────────────────────────
//
//   getAll() returns all registered defs. A "Keyboard Shortcuts" help modal
//   can call this to build a table without any coupling to the actual handlers.
//
// ── Future: Plugin Shortcuts ──────────────────────────────────────────────────
//
//   Plugins register via register() and automatically get conflict detection.
//   Unregister by storing the returned handle and calling unregister(handle).

export interface ShortcutDef {
  key: string;                 // e.g. "z", "Delete", " " (spacebar)
  ctrl?: boolean;              // true = require Ctrl/Cmd; false = require no Ctrl; undefined = ignore
  shift?: boolean;             // same semantics as ctrl
  alt?: boolean;
  description: string;
  action: (e: KeyboardEvent) => void;
}

function isInputFocused(): boolean {
  const el = document.activeElement;
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  );
}

export class ShortcutManager {
  private defs: ShortcutDef[] = [];
  private handler: ((e: KeyboardEvent) => void) | null = null;

  register(def: ShortcutDef): void {
    this.defs.push(def);
  }

  registerAll(defs: ShortcutDef[]): void {
    for (const d of defs) this.register(d);
  }

  // Attach the keydown listener to window
  mount(): void {
    this.handler = this.onKeyDown.bind(this);
    window.addEventListener("keydown", this.handler);
  }

  // Remove listener and clear registry (call on unmount)
  dispose(): void {
    if (this.handler) window.removeEventListener("keydown", this.handler);
    this.handler = null;
    this.defs = [];
  }

  private onKeyDown(e: KeyboardEvent): void {
    const ctrl  = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    const alt   = e.altKey;

    for (const def of this.defs) {
      // Key match (case-insensitive for letter keys)
      if (def.key !== e.key && def.key.toLowerCase() !== e.key.toLowerCase()) continue;

      // Modifier match
      if (def.ctrl  !== undefined && def.ctrl  !== ctrl)  continue;
      if (def.shift !== undefined && def.shift !== shift) continue;
      if (def.alt   !== undefined && def.alt   !== alt)   continue;

      // Suppress non-Ctrl shortcuts when typing in an input
      if (!ctrl && isInputFocused()) continue;

      e.preventDefault();
      def.action(e);
      return; // first match wins — no fall-through
    }
  }

  // For a help modal / shortcut discovery panel
  getAll(): ReadonlyArray<ShortcutDef> {
    return this.defs;
  }
}
