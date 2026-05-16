// ─── History Manager (Command Pattern) ────────────────────────────────────────
//
// Implements undo/redo using the Command pattern.
//
// ── Why Command pattern vs. state snapshots? ──────────────────────────────────
//
//   State snapshots are simpler but expensive: a full scene snapshot on every
//   drag event would allocate a new array every frame. Commands are cheap —
//   they store only the minimal delta needed to reverse the operation.
//
//   Exception: for operations that are hard to express as deltas (e.g., complex
//   filter resets), we store before/after snapshots of the specific field.
//
// ── pushExecuted() ────────────────────────────────────────────────────────────
//
//   Tools apply changes live during drag (pointerMove), then push a command on
//   pointerUp so undo reverses the full drag, not each individual frame.
//   pushExecuted() adds the already-executed command without calling execute().
//
// ── erasableSyntaxOnly compatibility ─────────────────────────────────────────
//
//   TypeScript 5.8+ `erasableSyntaxOnly` disallows "parameter properties"
//   (constructor(private x: T)) because they emit runtime code (not just types).
//   All command classes below use explicit field declarations + manual assignment.

import type { Command } from "../../types";
import type { SceneGraph } from "../scene/SceneGraph";
import type { AnySceneObject, FilterState } from "../../types";

const MAX_HISTORY = 100;

export class HistoryManager {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  execute(command: Command): void {
    command.execute();
    this.undoStack.push(command);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(): void {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.undo();
    this.redoStack.push(cmd);
  }

  redo(): void {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.execute();
    this.undoStack.push(cmd);
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  pushExecuted(command: Command): void {
    this.undoStack.push(command);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }

  get undoDepth(): number { return this.undoStack.length; }

  get nextUndoDescription(): string {
    return this.undoStack[this.undoStack.length - 1]?.description ?? "";
  }
}

// ─── Concrete Commands ────────────────────────────────────────────────────────
// All use explicit field declarations instead of parameter properties to comply
// with `erasableSyntaxOnly`. The semantics are identical.

export class AddObjectCommand implements Command {
  readonly description: string;
  private scene: SceneGraph;
  private object: AnySceneObject;
  private onUpdate: () => void;

  constructor(scene: SceneGraph, object: AnySceneObject, onUpdate: () => void) {
    this.scene    = scene;
    this.object   = object;
    this.onUpdate = onUpdate;
    this.description = `Add ${object.type}`;
  }

  execute(): void { this.scene.add(this.object);       this.onUpdate(); }
  undo():    void { this.scene.remove(this.object.id); this.onUpdate(); }
}

export class RemoveObjectCommand implements Command {
  readonly description = "Remove object";
  private scene: SceneGraph;
  private objectId: string;
  private onUpdate: () => void;
  private removed: AnySceneObject | undefined;

  constructor(scene: SceneGraph, objectId: string, onUpdate: () => void) {
    this.scene    = scene;
    this.objectId = objectId;
    this.onUpdate = onUpdate;
  }

  execute(): void { this.removed = this.scene.remove(this.objectId); this.onUpdate(); }
  undo():    void { if (this.removed) { this.scene.add(this.removed); this.onUpdate(); } }
}

export class MoveObjectCommand implements Command {
  readonly description = "Move object";
  private scene: SceneGraph;
  private objectId: string;
  private from: { x: number; y: number };
  private to: { x: number; y: number };
  private onUpdate: () => void;

  constructor(
    scene: SceneGraph,
    objectId: string,
    from: { x: number; y: number },
    to: { x: number; y: number },
    onUpdate: () => void
  ) {
    this.scene    = scene;
    this.objectId = objectId;
    this.from     = from;
    this.to       = to;
    this.onUpdate = onUpdate;
  }

  execute(): void { this.scene.update(this.objectId, this.to);   this.onUpdate(); }
  undo():    void { this.scene.update(this.objectId, this.from); this.onUpdate(); }
}

export class TransformObjectCommand implements Command {
  readonly description = "Transform object";
  private scene: SceneGraph;
  private objectId: string;
  private before: Partial<AnySceneObject>;
  private after: Partial<AnySceneObject>;
  private onUpdate: () => void;

  constructor(
    scene: SceneGraph,
    objectId: string,
    before: Partial<AnySceneObject>,
    after: Partial<AnySceneObject>,
    onUpdate: () => void
  ) {
    this.scene    = scene;
    this.objectId = objectId;
    this.before   = before;
    this.after    = after;
    this.onUpdate = onUpdate;
  }

  execute(): void { this.scene.update(this.objectId, this.after);  this.onUpdate(); }
  undo():    void { this.scene.update(this.objectId, this.before); this.onUpdate(); }
}

// ── FilterCommand ─────────────────────────────────────────────────────────────
// Stores before/after FilterState for non-destructive filter undo/redo.
export class FilterCommand implements Command {
  readonly description = "Apply filter";
  private scene: SceneGraph;
  private objectId: string;
  private before: FilterState | undefined;
  private after: FilterState | undefined;
  private onUpdate: () => void;

  constructor(
    scene: SceneGraph,
    objectId: string,
    before: FilterState | undefined,
    after: FilterState | undefined,
    onUpdate: () => void
  ) {
    this.scene    = scene;
    this.objectId = objectId;
    this.before   = before;
    this.after    = after;
    this.onUpdate = onUpdate;
  }

  execute(): void {
    this.scene.update(this.objectId, { filters: this.after } as Partial<AnySceneObject>);
    this.onUpdate();
  }

  undo(): void {
    this.scene.update(this.objectId, { filters: this.before } as Partial<AnySceneObject>);
    this.onUpdate();
  }
}

// ── BatchCommand ──────────────────────────────────────────────────────────────
// Groups multiple commands into a single undoable unit.
// undo() reverses in reverse order — critical for correct semantics.
export class BatchCommand implements Command {
  readonly description: string;
  private commands: Command[];

  constructor(commands: Command[], desc?: string) {
    this.commands    = commands;
    this.description = desc ?? `Batch (${commands.length})`;
  }

  execute(): void {
    for (const cmd of this.commands) cmd.execute();
  }

  undo(): void {
    for (let i = this.commands.length - 1; i >= 0; i--) {
      this.commands[i].undo();
    }
  }
}

// ── DuplicateObjectCommand ─────────────────────────────────────────────────────
export class DuplicateObjectCommand implements Command {
  readonly description = "Duplicate object";
  private scene: SceneGraph;
  private clone: AnySceneObject;
  private onUpdate: (id: string) => void;

  constructor(scene: SceneGraph, original: AnySceneObject, onUpdate: (id: string) => void) {
    this.scene    = scene;
    this.onUpdate = onUpdate;
    this.clone    = {
      ...original,
      id: crypto.randomUUID(),
      x: original.x + 16,
      y: original.y + 16,
      selected: true,
    } as AnySceneObject;
  }

  execute(): void {
    this.scene.add(this.clone);
    this.scene.selectOnly(this.clone.id);
    this.onUpdate(this.clone.id);
  }

  undo(): void {
    this.scene.remove(this.clone.id);
    this.onUpdate("");
  }
}
