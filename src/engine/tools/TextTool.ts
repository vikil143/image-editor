// ─── Text Tool ────────────────────────────────────────────────────────────────
// Click to place a text object. Double-click on an existing text starts inline
// editing via a transparent <textarea> overlay positioned over the canvas.

import type { BaseTool, ToolContext } from "./BaseTool";
import { screenToWorld } from "./BaseTool";
import type { Point, ToolType } from "../../types";
import { createText } from "../objects/factories";
import { AddObjectCommand } from "../history/HistoryManager";

export class TextTool implements BaseTool {
  readonly type: ToolType = "text";

  activate(_ctx: ToolContext): void {}
  deactivate(_ctx: ToolContext): void {}

  onPointerDown(_e: PointerEvent, point: Point, ctx: ToolContext): void {
    const world = screenToWorld(point, ctx.camera);
    const obj = createText(world.x, world.y);
    const cmd = new AddObjectCommand(ctx.scene, obj, () => {
      ctx.renderer.markDirty();
      ctx.onObjectsChange();
    });
    ctx.history.execute(cmd);
    ctx.scene.selectOnly(obj.id);
    ctx.onSelectionChange([obj.id]);
    ctx.renderer.markDirty();
  }

  onPointerMove(): void {}
  onPointerUp(): void {}

  getCursor(): string {
    return "text";
  }
}
