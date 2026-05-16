// ─── 2D Transformation Matrix ────────────────────────────────────────────────
//
// We represent a 2D affine transform as a 3×3 column-major matrix:
//
//   | a  c  tx |
//   | b  d  ty |
//   | 0  0   1 |
//
// This matches the DOMMatrix / Canvas2D convention so we can pass it directly
// to ctx.setTransform(a, b, c, d, tx, ty) with zero conversion.
//
// Why a custom matrix class instead of DOMMatrix?
//   • DOMMatrix is not available in Web Workers (future offscreen rendering)
//   • We need to serialize matrices for undo history and future collaborative sync
//   • Explicit implementation makes the WebGL migration path clear (mat3 uniform)
//
// Column-major layout means transforms compose right-to-left when multiplied:
//   M_total = M_parent * M_local
//   (read: "first apply local, then parent")

export class Matrix2D {
  // [ a, b, c, d, tx, ty ]
  //   a = scaleX * cos(r)
  //   b = scaleX * sin(r)
  //   c = -scaleY * sin(r)
  //   d = scaleY * cos(r)
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;

  constructor(a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0) {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.tx = tx;
    this.ty = ty;
  }

  static identity(): Matrix2D {
    return new Matrix2D(1, 0, 0, 1, 0, 0);
  }

  // Build a transform from TRS components (Translation, Rotation, Scale).
  // Order: Scale → Rotate → Translate (SRT) so objects scale/rotate around
  // their own origin before being placed in the world.
  static fromTRS(
    tx: number,
    ty: number,
    rotation: number,
    scaleX: number,
    scaleY: number
  ): Matrix2D {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return new Matrix2D(
      scaleX * cos,
      scaleX * sin,
      -scaleY * sin,
      scaleY * cos,
      tx,
      ty
    );
  }

  // Compose: this * other  (apply 'other' first, then 'this')
  multiply(other: Matrix2D): Matrix2D {
    return new Matrix2D(
      this.a * other.a + this.c * other.b,
      this.b * other.a + this.d * other.b,
      this.a * other.c + this.c * other.d,
      this.b * other.c + this.d * other.d,
      this.a * other.tx + this.c * other.ty + this.tx,
      this.b * other.tx + this.d * other.ty + this.ty
    );
  }

  // Transform a point from local space to the space this matrix represents
  transformPoint(x: number, y: number): { x: number; y: number } {
    return {
      x: this.a * x + this.c * y + this.tx,
      y: this.b * x + this.d * y + this.ty,
    };
  }

  // Inverse: used for hit detection (screen → local object space)
  // Derived from the 2×2 adjugate / determinant formula.
  invert(): Matrix2D | null {
    const det = this.a * this.d - this.b * this.c;
    if (Math.abs(det) < 1e-10) return null; // singular matrix

    const invDet = 1 / det;
    return new Matrix2D(
      this.d * invDet,
      -this.b * invDet,
      -this.c * invDet,
      this.a * invDet,
      (this.c * this.ty - this.d * this.tx) * invDet,
      (this.b * this.tx - this.a * this.ty) * invDet
    );
  }

  // Build the object-to-world transform for a scene object.
  // Rotation pivot = center of the bounding box (not top-left).
  static forObject(
    x: number,
    y: number,
    width: number,
    height: number,
    rotation: number,
    scaleX = 1,
    scaleY = 1
  ): Matrix2D {
    const cx = x + width / 2;
    const cy = y + height / 2;

    // Translate to center → rotate/scale → translate back
    const toCenter = new Matrix2D(1, 0, 0, 1, -cx, -cy);
    const rotate = Matrix2D.fromTRS(0, 0, rotation, scaleX, scaleY);
    const fromCenter = new Matrix2D(1, 0, 0, 1, cx, cy);

    return fromCenter.multiply(rotate).multiply(toCenter);
  }

  // Apply this matrix to a Canvas2D context
  applyToContext(ctx: CanvasRenderingContext2D): void {
    ctx.transform(this.a, this.b, this.c, this.d, this.tx, this.ty);
  }

  clone(): Matrix2D {
    return new Matrix2D(this.a, this.b, this.c, this.d, this.tx, this.ty);
  }

  toArray(): [number, number, number, number, number, number] {
    return [this.a, this.b, this.c, this.d, this.tx, this.ty];
  }
}
